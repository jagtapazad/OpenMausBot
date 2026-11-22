// Agents get stuck on different things at different times; the person hears about it once. Open questions from every
// agent are merged into one short check-in, sent by text or call, and each answer goes back to the agents that asked.
import type { Deps } from "./orchestrator.ts";
import { JayaStore } from "./store.ts";
import { CheckInDraft, type CheckIn } from "../../shared/jaya.ts";

export const MAX_QUESTIONS = 6;

const SYSTEM = `You prepare a check-in for a busy person. Several AI agents working on their outcomes are blocked on questions only the person can answer. Merge them into as few clear questions as possible (at most ${MAX_QUESTIONS}): combine duplicates and overlapping questions, drop anything one answer already covers, order by what unblocks the most work, and keep each question short enough to answer in one sentence on the phone. Every input question id must appear in exactly one output question's "answers". intro: one friendly sentence saying how many agents are waiting.`;

export interface Delivery {
  /** Sends the check-in to the person; returns the channel it went out on. */
  deliver(checkIn: CheckIn, phone: string | null): Promise<CheckIn["channel"]>;
}

export const webInbox: Delivery = { deliver: async () => "web" };

export async function batchCheckIn(deps: Deps & { delivery?: Delivery }, engagementId: string): Promise<CheckIn | null> {
  const { store, brain } = deps;
  const open = store.list("clarifications", (row) => row.engagementId === engagementId && row.status === "open");
  if (!open.length) return null;
  const outcomes = new Map(store.list("outcomes", (row) => row.engagementId === engagementId).map((row) => [row.id, row]));
  let draft: CheckInDraft;
  try {
    draft = await brain.structured({
      purpose: "checkin",
      system: SYSTEM,
      effort: "low",
      messages: [{ role: "user", content: JSON.stringify(open.map((row) => ({ id: row.id, outcome: outcomes.get(row.outcomeId)?.spec.title, question: row.question }))) }],
      schema: CheckInDraft,
    });
  } catch {
    draft = { intro: `${new Set(open.map((row) => row.outcomeId)).size} of your agents have questions.`, questions: open.map((row) => ({ text: row.question, answers: [row.id] })) };
  }
  // Whatever the merge dropped is still asked, on its own.
  const covered = new Set(draft.questions.flatMap((question) => question.answers));
  const known = new Set(open.map((row) => row.id));
  const questions = [
    ...draft.questions.map((question) => ({ text: question.text, answers: question.answers.filter((id) => known.has(id)) })).filter((question) => question.answers.length),
    ...open.filter((row) => !covered.has(row.id)).map((row) => ({ text: row.question, answers: [row.id] })),
  ];
  const engagement = store.must("engagements", engagementId);
  const checkIn = store.put("checkins", {
    id: JayaStore.newId(), engagementId, createdAt: new Date().toISOString(), channel: "web", intro: draft.intro, status: "sent",
    questions: questions.map((question) => ({ id: JayaStore.newId(), text: question.text, answers: question.answers, reply: null })),
  });
  for (const row of open) store.put("clarifications", { ...row, status: "asked", checkInId: checkIn.id });
  const channel = await (deps.delivery ?? webInbox).deliver(checkIn, engagement.phone);
  return store.put("checkins", { ...checkIn, channel });
}

/** The person's replies, by check-in question id. Unanswered questions stay open for the next check-in. */
export async function answerCheckIn(deps: Deps, checkInId: string, replies: Record<string, string>): Promise<CheckIn> {
  const { store, harness } = deps;
  const checkIn = store.must("checkins", checkInId);
  const perOutcome = new Map<string, string[]>();
  const questions = checkIn.questions.map((question) => {
    const reply = replies[question.id]?.trim();
    if (!reply) return question;
    for (const id of question.answers) {
      const clarification = store.update("clarifications", id, (row) => ({ ...row, status: "answered", answer: reply }));
      perOutcome.set(clarification.outcomeId, [...(perOutcome.get(clarification.outcomeId) ?? []), `Q: ${clarification.question}\nA: ${reply}`]);
    }
    return { ...question, reply };
  });
  for (const question of questions.filter((q) => !q.reply)) {
    for (const id of question.answers) store.update("clarifications", id, (row) => ({ ...row, status: "open", checkInId: null }));
  }
  for (const [outcomeId, lines] of perOutcome) {
    const outcome = store.must("outcomes", outcomeId);
    await harness.send({ botId: outcome.botId, threadId: outcome.threadId }, `The person answered your questions:\n\n${lines.join("\n\n")}\n\nCarry on.`);
    const stillOpen = store.list("clarifications", (row) => row.outcomeId === outcomeId && row.status !== "answered").length;
    if (!stillOpen && outcome.status === "needs-input") store.put("outcomes", { ...outcome, status: "working" });
  }
  return store.put("checkins", { ...checkIn, questions, status: questions.every((q) => q.reply) ? "answered" : "sent" });
}
