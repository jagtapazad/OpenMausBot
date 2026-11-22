import { describe, expect, it } from "vitest";

import { scriptedBrain } from "./brain.ts";
import { answerCheckIn, batchCheckIn } from "./checkins.ts";
import { JayaStore } from "./store.ts";
import type { Brief, OutcomeSpec, Plan } from "../../shared/jaya.ts";
import { claim, GigError, registerWorker, startSession, workerAct } from "./gig.ts";
import { SimulatedHarness } from "./simulated-harness.ts";
import { intakeTurn, OPENING, startIntake } from "./intake.ts";
import { launch, poll } from "./orchestrator.ts";
import { MAX_AGENT_LOOPS, review } from "./reviews.ts";

const outcome = (title: string): OutcomeSpec => ({
  title, why: "saves time", deliverable: `${title} document`, successCriteria: [`${title} is complete`], cadence: "once", deadline: null, constraints: [],
});
const brief = (outcomes: OutcomeSpec[]): Brief => ({
  personName: "Sam", summary: "Sam runs a small bakery.", context: ["Two shops in Pune"], outcomes, toolsAndAccounts: ["Gmail"], preferences: ["short answers"],
  contactPreferences: outcomes.length ? "text, 9am-6pm" : null, openQuestions: [],
});
const plan: Plan = {
  teamName: "Sam's team",
  agents: [0, 1].map((index) => ({
    outcomeIndex: index, name: index ? "Ivy" : "Max", role: "does the work", instructions: `You own outcome ${index}.`, kickoff: "Start now.",
    schedule: { type: "once", time: null, weekdays: [], everyMinutes: null }, handback: "the document",
  })),
};
const packet = { title: "Fix the menu", situation: "agents missed the tone", outcome: "a menu", successCriteria: ["on brand"], whatWasTried: ["three drafts"],
  whyItFellShort: ["tone"], suggestedApproach: ["rewrite instructions"], estimatedHours: 2, skills: ["copywriting"] };

function setup() {
  const store = new JayaStore(":memory:");
  const harness = new SimulatedHarness();
  const brain = scriptedBrain({
    intake: [
      { reply: "What should the menu say?", brief: brief([outcome("Menu")]), ready: false },
      { reply: "Great, setting up your team.", brief: brief([outcome("Menu"), outcome("Newsletter")]), ready: true },
    ],
    plan: [plan],
    checkin: [(task) => {
      const asked = JSON.parse(task.messages[0]!.content) as Array<{ id: string }>;
      return { intro: "Two agents need you.", questions: [{ text: "How do you like things done?", answers: asked.map((row) => row.id) }] };
    }],
    packet: [packet],
  });
  return { store, harness, brain, deps: { store, harness, brain } };
}

describe("an engagement from intake to a paid gig worker", () => {
  it("runs the whole loop", async () => {
    const { store, harness, brain, deps } = setup();

    // Intake: a conversation that ends when every outcome is pinned down.
    const engagement = startIntake(store, "+15550100");
    expect(engagement.transcript[0]!.text).toBe(OPENING);
    expect((await intakeTurn(store, brain, engagement.id, "I need a menu")).ready).toBe(false);
    const done = await intakeTurn(store, brain, engagement.id, "And a weekly newsletter");
    expect(done.ready).toBe(true);
    expect(done.engagement.status).toBe("planning");
    expect(brain.calls[1]!.messages.at(-1)!.content).toContain("Brief so far");

    // Launch: one agent per outcome, each with the brief in its memory and a kickoff.
    const running = await launch(deps, engagement.id);
    expect(running.status).toBe("running");
    const outcomes = store.list("outcomes").sort((a, b) => a.index - b.index);
    expect(outcomes.map((row) => row.agentId)).toEqual(["Max", "Ivy"]);
    expect(harness.bots.get(outcomes[0]!.botId)!.memory.get("memory/brief.md")).toContain("Menu document");

    // Both agents ask on the kickoff; the person gets one merged question.
    expect((await poll(deps, engagement.id)).questions).toHaveLength(2);
    const checkIn = (await batchCheckIn(deps, engagement.id))!;
    expect(checkIn.questions).toHaveLength(1);
    await answerCheckIn(deps, checkIn.id, { [checkIn.questions[0]!.id]: "Keep it warm and short." });
    expect(store.list("clarifications").every((row) => row.status === "answered")).toBe(true);
    expect(harness.bots.get(outcomes[1]!.botId)!.messages.some((m) => m.role === "person" && m.text.includes("Keep it warm and short."))).toBe(true);

    // Their deliverables come back for review.
    const first = await poll(deps, engagement.id);
    expect(first.attempts).toHaveLength(2);
    const menu = first.attempts.find((a) => a.outcomeId === outcomes[0]!.id)!;
    const news = first.attempts.find((a) => a.outcomeId === outcomes[1]!.id)!;
    const instructions = () => "You own the newsletter.";
    expect((await review(deps, menu.id, "accepted", null, instructions)).outcome.status).toBe("accepted");

    // The newsletter is turned down until the agents' loops run out, then it goes to a gig worker.
    let attempt = news;
    for (let loop = 1; loop < MAX_AGENT_LOOPS; loop++) {
      expect((await review(deps, attempt.id, "rejected", "Too formal.", instructions)).outcome.status).toBe("working");
      attempt = (await poll(deps, engagement.id)).attempts[0]!;
    }
    expect((await review(deps, attempt.id, "rejected", "Still too formal.", instructions)).outcome.status).toBe("escalated");
    const [work] = store.list("packets");
    expect(work).toMatchObject({ status: "open", hourlyRate: 18, agentSetup: { instructions: "You own the newsletter." } });
    expect(JSON.parse(brain.calls.find((call) => call.purpose === "packet")!.messages[0]!.content).attempts).toHaveLength(3);

    // A worker claims it, has to start the timer, then steers the person's agent.
    const worker = registerWorker(store, { name: "Ana", skills: ["copywriting"], hourlyRate: 20 });
    expect(() => registerWorker(store, { name: "Too much", skills: [], hourlyRate: 40 })).toThrow(GigError);
    claim(store, work!.id, worker.id);
    await expect(workerAct(deps, work!.id, worker.id, { kind: "prompt", text: "Rewrite it casually." })).rejects.toThrow("start the timer");
    startSession(store, work!.id, worker.id);
    await workerAct(deps, work!.id, worker.id, { kind: "instructions", text: "Write like a friend." });
    await workerAct(deps, work!.id, worker.id, { kind: "prompt", text: "Rewrite it casually." });
    expect(harness.bots.get(outcomes[1]!.botId)!.instructions).toBe("Write like a friend.");

    // The worker's result is reviewed like any other; a rejection keeps it with the worker.
    const byWorker = (await poll(deps, engagement.id)).attempts[0]!;
    expect(byWorker.by).toBe("worker");
    expect(store.must("packets", work!.id).status).toBe("submitted");
    expect((await review(deps, byWorker.id, "rejected", "Shorter.", instructions)).outcome.status).toBe("escalated");
    expect(store.must("packets", work!.id).status).toBe("claimed");
    await workerAct(deps, work!.id, worker.id, { kind: "prompt", text: "Cut it in half." });
    const final = (await poll(deps, engagement.id)).attempts[0]!;
    expect((await review(deps, final.id, "accepted", null, instructions)).outcome.status).toBe("accepted");

    // Accepting settles the worker's pay at their rate; every change they made to the agent is on record.
    const [payout] = store.list("payouts");
    expect(payout).toMatchObject({ workerId: worker.id, status: "owed" });
    expect(payout!.amountCents).toBe(Math.round(payout!.hours * 20 * 100));
    expect(store.list("actions").map((row) => row.kind)).toEqual(["instructions", "prompt", "prompt"]);
    expect(store.must("packets", work!.id).status).toBe("accepted");
  });

  it("asks a merged-away question on its own, and leaves unanswered ones for the next check-in", async () => {
    const { store, deps } = setup();
    const engagement = startIntake(store);
    store.put("engagements", { ...engagement, status: "planning", brief: brief([outcome("Menu"), outcome("Newsletter")]) });
    await launch(deps, engagement.id);
    await poll(deps, engagement.id);
    const checkIn = (await batchCheckIn(deps, engagement.id))!;
    await answerCheckIn(deps, checkIn.id, {});
    expect(store.list("clarifications").every((row) => row.status === "open")).toBe(true);
    expect((await batchCheckIn(deps, engagement.id))!.questions).toHaveLength(1);
  });
});
