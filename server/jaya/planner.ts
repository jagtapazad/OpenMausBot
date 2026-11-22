// Turns the brief into a team: one agent per outcome, each with instructions, a schedule, a first message and a
// clear hand-back, so the work can run on the harness without anyone in the loop.
import type { Brain } from "./brain.ts";
import { Plan, type Brief } from "../../shared/jaya.ts";

export const QUESTION_TAG = "[QUESTION]";
export const DELIVERABLE_TAG = "[DELIVERABLE]";

const SYSTEM = `You design a team of AI agents from a brief. Each agent runs on an agent harness with its own conversation, memory, tools and schedules.

For every outcome in the brief, make exactly one agent (outcomeIndex = the outcome's position, starting at 0):
- name: a short first name that fits its job.
- role: one line.
- instructions: complete standing instructions in the second person. Include the person's context and preferences from the brief, the outcome's deliverable, success criteria, cadence, deadline and constraints, and how to work: plan first, do the work with the tools it has, check the result against every success criterion before handing it back.
- Two rules every agent's instructions must contain word for word:
  1. "When you are blocked on something only the person can answer, write one line that starts with ${QUESTION_TAG} followed by the question, then stop and wait. Ask everything you need in one go; never guess about the person's accounts, money or identity."
  2. "When the deliverable is ready, write a message that starts with ${DELIVERABLE_TAG} followed by the deliverable itself (or where to find it) and one line per success criterion saying how it is met."
- kickoff: the first message the agent receives, telling it to start.
- schedule: "once" for one-off outcomes; otherwise the cadence (daily/weekly with time and weekdays, or interval in minutes).
- handback: what the person will review.

teamName: a short name for the team.`;

export async function planTeam(brain: Brain, brief: Brief): Promise<Plan> {
  const plan = await brain.structured({
    purpose: "plan",
    system: SYSTEM,
    effort: "high",
    messages: [{ role: "user", content: `Brief:\n${JSON.stringify(brief, null, 2)}` }],
    schema: Plan,
  });
  const covered = new Set(plan.agents.map((agent) => agent.outcomeIndex));
  const missing = brief.outcomes.map((_, index) => index).filter((index) => !covered.has(index));
  if (missing.length) throw new Error(`the plan left outcomes without an agent: ${missing.join(", ")}`);
  if (plan.agents.some((agent) => agent.outcomeIndex >= brief.outcomes.length)) throw new Error("the plan names an outcome the brief does not have");
  return plan;
}
