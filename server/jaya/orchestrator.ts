// Runs an engagement after intake: sets the team up on the harness, then keeps reading what each agent says,
// turning its questions into check-ins and its deliverables into reviews.
import type { Brain } from "./brain.ts";
import { JayaStore } from "./store.ts";
import type { Attempt, Clarification, Engagement, Outcome } from "../../shared/jaya.ts";
import type { Harness } from "./harness.ts";
import { DELIVERABLE_TAG, planTeam, QUESTION_TAG } from "./planner.ts";

export interface Deps {
  store: JayaStore;
  brain: Brain;
  harness: Harness;
}

const briefNote = (engagement: Engagement, outcome: Outcome) => [
  "# What this person wants",
  engagement.brief.summary,
  "",
  "## Your outcome",
  `${outcome.spec.title}: ${outcome.spec.deliverable}`,
  ...outcome.spec.successCriteria.map((criterion) => `- ${criterion}`),
  "",
  "## Context",
  ...engagement.brief.context.map((line) => `- ${line}`),
  ...(engagement.brief.preferences.length ? ["", "## Preferences", ...engagement.brief.preferences.map((line) => `- ${line}`)] : []),
].join("\n");

export async function launch(deps: Deps, engagementId: string): Promise<Engagement> {
  const { store, brain, harness } = deps;
  const engagement = store.must("engagements", engagementId);
  if (engagement.status !== "planning") throw new Error(`engagement is ${engagement.status}, not ready to launch`);
  const plan = await planTeam(brain, engagement.brief);
  const { departmentId } = await harness.createTeam(plan.teamName);
  for (const agent of plan.agents) {
    const spec = engagement.brief.outcomes[agent.outcomeIndex]!;
    const bot = await harness.createAgent({ departmentId, name: agent.name, role: agent.role, instructions: agent.instructions });
    const outcome = store.put("outcomes", {
      id: JayaStore.newId(), engagementId, index: agent.outcomeIndex, spec, status: "working", agentId: agent.name,
      botId: bot.botId, threadId: bot.threadId, rejections: 0, seenUntil: 0,
    });
    await harness.writeMemory(bot.botId, "memory/brief.md", briefNote(engagement, outcome));
    if (agent.schedule.type !== "once") await harness.schedule({ botId: bot.botId, name: spec.title, prompt: agent.kickoff, schedule: agent.schedule });
    await harness.send(bot, agent.kickoff);
  }
  return store.put("engagements", { ...engagement, status: "running", plan, departmentId });
}

/** Lines that start with the tag, without it; a tag may also open a message whose body follows. */
function tagged(text: string, tag: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith(tag)).map((line) => line.slice(tag.length).trim()).filter(Boolean);
}

/** Reads every agent's new messages once. Returns what it found, for the caller to act on. */
export async function poll(deps: Deps, engagementId: string): Promise<{ questions: Clarification[]; attempts: Attempt[] }> {
  const { store, harness } = deps;
  const questions: Clarification[] = [];
  const attempts: Attempt[] = [];
  for (const outcome of store.list("outcomes", (row) => row.engagementId === engagementId && row.status !== "accepted")) {
    const messages = await harness.messagesSince({ botId: outcome.botId, threadId: outcome.threadId }, outcome.seenUntil);
    if (!messages.length) continue;
    let status = outcome.status;
    const claimed = store.list("packets", (packet) => packet.outcomeId === outcome.id && packet.status === "claimed")[0];
    // An escalated outcome waiting for a worker stays escalated until something is delivered.
    if (status === "escalated" && !claimed) {
      store.put("outcomes", { ...outcome, seenUntil: Math.max(...messages.map((message) => message.at)) });
      continue;
    }
    for (const message of messages) {
      const deliverableAt = message.text.indexOf(DELIVERABLE_TAG);
      if (deliverableAt >= 0) {
        attempts.push(store.put("attempts", {
          id: JayaStore.newId(), outcomeId: outcome.id, by: claimed ? "worker" : "agent",
          deliverable: message.text.slice(deliverableAt + DELIVERABLE_TAG.length).trim(), verdict: "pending", feedback: null, createdAt: new Date(message.at).toISOString(),
        }));
        status = "in-review";
        if (claimed) store.put("packets", { ...claimed, status: "submitted" });
        continue;
      }
      // While a worker holds the outcome, the agent's questions are theirs to answer, not the person's.
      if (claimed) continue;
      for (const question of tagged(message.text, QUESTION_TAG)) {
        questions.push(store.put("clarifications", {
          id: JayaStore.newId(), engagementId, outcomeId: outcome.id, question, status: "open", answer: null, checkInId: null, createdAt: new Date(message.at).toISOString(),
        }));
        if (status === "working") status = "needs-input";
      }
    }
    store.put("outcomes", { ...outcome, status, seenUntil: Math.max(...messages.map((message) => message.at)) });
  }
  return { questions, attempts };
}
