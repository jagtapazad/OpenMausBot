// The person judges each deliverable. A rejection goes back to the agent with their feedback; after too many, the
// outcome is escalated to a gig worker. Accepting a worker's result settles their pay.
import type { Deps } from "./orchestrator.ts";
import type { Attempt, Outcome } from "./domain.ts";
import { createPacket, settle } from "./gig.ts";

/** Rejections the agents get before a person steps in. */
export const MAX_AGENT_LOOPS = 3;

export class ReviewError extends Error {}

export async function review(deps: Deps, attemptId: string, verdict: "accepted" | "rejected", feedback: string | null, instructions: (outcome: Outcome) => string): Promise<{ attempt: Attempt; outcome: Outcome }> {
  const { store, harness } = deps;
  const attempt = store.must("attempts", attemptId);
  if (attempt.verdict !== "pending") throw new ReviewError("this deliverable was already reviewed");
  const note = feedback?.trim() || null;
  if (verdict === "rejected" && !note) throw new ReviewError("say what is wrong, so the work can improve");
  const reviewed = store.put("attempts", { ...attempt, verdict, feedback: note });
  const outcome = store.must("outcomes", attempt.outcomeId);
  const packet = store.list("packets", (row) => row.outcomeId === outcome.id && (row.status === "claimed" || row.status === "submitted"))[0];
  const bot = { botId: outcome.botId, threadId: outcome.threadId };

  if (verdict === "accepted") {
    if (packet) settle(store, packet.id);
    return { attempt: reviewed, outcome: store.put("outcomes", { ...outcome, status: "accepted" }) };
  }
  if (packet) {
    // The worker keeps the outcome: the feedback is theirs to act on, through the agent.
    store.put("packets", { ...packet, status: "claimed" });
    await harness.send(bot, `The person reviewed this and it is not right yet:\n\n${note}`);
    return { attempt: reviewed, outcome: store.put("outcomes", { ...outcome, status: "escalated" }) };
  }
  const rejections = outcome.rejections + 1;
  if (rejections >= MAX_AGENT_LOOPS) {
    const escalated = store.put("outcomes", { ...outcome, rejections, status: "escalated" });
    await createPacket(deps, outcome.id, instructions(escalated));
    return { attempt: reviewed, outcome: escalated };
  }
  await harness.send(bot, `The person reviewed your deliverable and wants changes:\n\n${note}\n\nRevise it and hand it back when every success criterion is met.`);
  return { attempt: reviewed, outcome: store.put("outcomes", { ...outcome, rejections, status: "working" }) };
}
