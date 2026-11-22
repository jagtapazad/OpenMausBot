// A brain that needs no API key, for clicking through the product: the intake asks a fixed run of questions and
// builds the brief from the answers. Not a model; only a stand-in so nothing is spent while trying things out.
import { scriptedBrain, type Brain } from "./brain.ts";
import type { Brief, CheckInDraft, IntakeTurn, Plan, WorkPacketDraft } from "./domain.ts";
import { DELIVERABLE_TAG, QUESTION_TAG } from "./planner.ts";

const QUESTIONS = [
  "Got it. What exactly should you get back, so you'd know it's done?",
  "How often should this happen, and is there a deadline?",
  "Anything the agents must never do, or tools and accounts they'll need? And is texting you fine for questions?",
];

const said = (content: string) => content.trim();

export function demoBrain(): Brain {
  return scriptedBrain({
    intake: [(task) => {
      const person = task.messages.filter((m) => m.role === "user" && !m.content.startsWith("(Brief so far")).map((m) => said(m.content));
      const step = person.length;
      const brief: Brief = {
        personName: null,
        summary: person[0] ?? "",
        context: person.slice(3),
        outcomes: person.length >= 2 ? [{
          title: (person[0] ?? "Your outcome").slice(0, 60), why: person[0] ?? "", deliverable: person[1] ?? "",
          successCriteria: [person[1] ?? "Delivered as described"], cadence: person[2] ?? "once", deadline: null, constraints: person[3] ? [person[3]] : [],
        }] : [],
        toolsAndAccounts: [], preferences: [], contactPreferences: step >= 4 ? "text" : null, openQuestions: [],
      };
      const ready = step >= 4;
      const turn: IntakeTurn = { reply: ready ? "Thanks, that's everything. I'm setting up your team now; agents will text you with batched questions." : QUESTIONS[step - 1]!, brief, ready };
      return turn;
    }],
    plan: [(task) => {
      const brief = JSON.parse(task.messages[0]!.content.replace(/^Brief:\n/, "")) as Brief;
      const plan: Plan = {
        teamName: "Your team",
        agents: brief.outcomes.map((outcome, index) => ({
          outcomeIndex: index, name: ["Max", "Ivy", "Ren", "Ada"][index % 4]!, role: `Delivers: ${outcome.title}`,
          instructions: `You deliver "${outcome.deliverable}". Success: ${outcome.successCriteria.join("; ")}. Ask with ${QUESTION_TAG}; hand back with ${DELIVERABLE_TAG}.`,
          kickoff: "Start on your outcome now.", schedule: { type: "once", time: null, weekdays: [], everyMinutes: null }, handback: outcome.deliverable,
        })),
      };
      return plan;
    }],
    checkin: [(task) => {
      const asked = JSON.parse(task.messages[0]!.content) as Array<{ id: string; question: string }>;
      const draft: CheckInDraft = { intro: `${asked.length} question${asked.length === 1 ? "" : "s"} from your agents.`, questions: asked.map((row) => ({ text: row.question, answers: [row.id] })) };
      return draft;
    }],
    packet: [(task) => {
      const input = JSON.parse(task.messages[0]!.content) as { outcome: { title: string; deliverable: string; successCriteria: string[] }; attempts: Array<{ feedback: string | null }> };
      const draft: WorkPacketDraft = {
        title: input.outcome.title, situation: "The agent's drafts were turned down.", outcome: input.outcome.deliverable, successCriteria: input.outcome.successCriteria,
        whatWasTried: input.attempts.map((_, index) => `Draft ${index + 1}`), whyItFellShort: input.attempts.flatMap((a) => (a.feedback ? [a.feedback] : [])),
        suggestedApproach: ["Read the feedback", "Rewrite the agent's instructions", "Prompt it for a new draft"], estimatedHours: 1.5, skills: ["prompting"],
      };
      return draft;
    }],
  });
}
