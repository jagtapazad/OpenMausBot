// What runs on its own between people's actions: read every running engagement's agents, and once questions have
// waited a little (so several agents' questions go out together), send one check-in.
import { batchCheckIn, type Delivery } from "./checkins.ts";
import { poll, type Deps } from "./orchestrator.ts";

/** How long the first open question waits for others before the person is asked. */
export const BATCH_WINDOW_MS = 2 * 60_000;

export async function autopilot(deps: Deps & { delivery?: Delivery }, now = Date.now()): Promise<void> {
  for (const engagement of deps.store.list("engagements", (row) => row.status === "running")) {
    await poll(deps, engagement.id);
    const open = deps.store.list("clarifications", (row) => row.engagementId === engagement.id && row.status === "open");
    const waiting = deps.store.list("checkins", (row) => row.engagementId === engagement.id && row.status === "sent").length > 0;
    const oldest = Math.min(...open.map((row) => Date.parse(row.createdAt)));
    if (open.length && !waiting && now - oldest >= BATCH_WINDOW_MS) await batchCheckIn(deps, engagement.id);
    const outcomes = deps.store.list("outcomes", (row) => row.engagementId === engagement.id);
    if (outcomes.length && outcomes.every((row) => row.status === "accepted")) deps.store.put("engagements", { ...engagement, status: "done" });
  }
}
