// When the agents can't reach an outcome the person accepts, a technical gig worker takes it over: they get a packet
// with everything that was tried, prompt the person's own agent and reshape its instructions and memory, and are paid
// by the hour once the person accepts the result.
import type { Deps } from "./orchestrator.ts";
import { JayaStore } from "./store.ts";
import { WorkPacketDraft, type Payout, type WorkPacket, type WorkSession } from "../../shared/jaya.ts";

export const DEFAULT_HOURLY_RATE = 18;
export const RATE_RANGE = { min: 15, max: 20 } as const;

const SYSTEM = `You write a work packet for a technical freelancer who will take over an AI agent's job. They prompt the agent, edit its standing instructions and memory, and steer it until the person accepts the result. Be concrete and complete: the situation and the person's context, the outcome and its success criteria, every attempt so far and the person's feedback on it, why it fell short (the real cause, not a restatement), and a suggested approach as numbered steps. estimatedHours: realistic for a skilled prompter. skills: what the job needs (e.g. "prompt engineering", "spreadsheets", "copywriting").`;

export class GigError extends Error {}

export async function createPacket(deps: Deps, outcomeId: string, instructions: string): Promise<WorkPacket> {
  const { store, brain } = deps;
  const outcome = store.must("outcomes", outcomeId);
  const engagement = store.must("engagements", outcome.engagementId);
  const attempts = store.list("attempts", (row) => row.outcomeId === outcomeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const draft = await brain.structured({
    purpose: "packet",
    system: SYSTEM,
    effort: "high",
    messages: [{
      role: "user",
      content: JSON.stringify({
        brief: engagement.brief,
        outcome: outcome.spec,
        agentInstructions: instructions,
        attempts: attempts.map((attempt) => ({ deliverable: attempt.deliverable, verdict: attempt.verdict, feedback: attempt.feedback })),
      }),
    }],
    schema: WorkPacketDraft,
  });
  const plan = engagement.plan?.agents.find((agent) => agent.outcomeIndex === outcome.index);
  return store.put("packets", {
    ...draft,
    id: JayaStore.newId(), outcomeId, engagementId: engagement.id, status: "open", hourlyRate: DEFAULT_HOURLY_RATE, workerId: null, createdAt: new Date().toISOString(),
    agentSetup: { botId: outcome.botId, threadId: outcome.threadId, instructions, schedule: plan?.schedule ?? { type: "once", time: null, weekdays: [], everyMinutes: null } },
  });
}

export function registerWorker(store: JayaStore, input: { name: string; skills: string[]; hourlyRate?: number }) {
  const rate = input.hourlyRate ?? DEFAULT_HOURLY_RATE;
  if (rate < RATE_RANGE.min || rate > RATE_RANGE.max) throw new GigError(`the hourly rate is $${RATE_RANGE.min}-$${RATE_RANGE.max}`);
  return store.put("workers", { id: JayaStore.newId(), name: input.name.trim(), skills: input.skills, hourlyRate: rate });
}

export function claim(store: JayaStore, packetId: string, workerId: string): WorkPacket {
  const worker = store.must("workers", workerId);
  const packet = store.must("packets", packetId);
  if (packet.status !== "open") throw new GigError("someone already took this packet");
  return store.put("packets", { ...packet, status: "claimed", workerId, hourlyRate: worker.hourlyRate });
}

function held(store: JayaStore, packetId: string, workerId: string): WorkPacket {
  const packet = store.must("packets", packetId);
  if (packet.workerId !== workerId || (packet.status !== "claimed" && packet.status !== "submitted")) throw new GigError("this packet isn't yours to work on");
  return packet;
}

const openSession = (store: JayaStore, packetId: string, workerId: string) =>
  store.list("sessions", (row) => row.packetId === packetId && row.workerId === workerId && row.endedAt === null)[0];

export function startSession(store: JayaStore, packetId: string, workerId: string): WorkSession {
  held(store, packetId, workerId);
  return openSession(store, packetId, workerId) ?? store.put("sessions", { id: JayaStore.newId(), packetId, workerId, startedAt: new Date().toISOString(), endedAt: null });
}

export function stopSession(store: JayaStore, packetId: string, workerId: string): WorkSession | null {
  const session = openSession(store, packetId, workerId);
  return session ? store.put("sessions", { ...session, endedAt: new Date().toISOString() }) : null;
}

/** Something the worker does to the person's agent. Only while they hold the packet and have a session running. */
export async function workerAct(deps: Deps, packetId: string, workerId: string, action: { kind: "prompt" | "instructions" | "memory"; text: string; path?: string }) {
  const { store, harness } = deps;
  const packet = held(store, packetId, workerId);
  if (!openSession(store, packetId, workerId)) throw new GigError("start the timer before working on the agent");
  const text = action.text.trim();
  if (!text) throw new GigError("nothing to send");
  const bot = { botId: packet.agentSetup.botId, threadId: packet.agentSetup.threadId };
  if (action.kind === "prompt") await harness.send(bot, text);
  else if (action.kind === "instructions") {
    await harness.setInstructions(bot.botId, text);
    store.put("packets", { ...packet, agentSetup: { ...packet.agentSetup, instructions: text } });
  } else await harness.writeMemory(bot.botId, action.path ?? "memory/worker-notes.md", text);
  return store.put("actions", { id: JayaStore.newId(), packetId, workerId, kind: action.kind, detail: action.kind === "memory" ? `${action.path ?? "memory/worker-notes.md"}: ${text}` : text, at: new Date().toISOString() });
}

export function hoursWorked(sessions: readonly WorkSession[], now = Date.now()): number {
  const ms = sessions.reduce((sum, session) => sum + ((session.endedAt ? Date.parse(session.endedAt) : now) - Date.parse(session.startedAt)), 0);
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** On the person's acceptance: the timer stops and the worker is owed their hours at their rate. */
export function settle(store: JayaStore, packetId: string): Payout {
  const packet = store.must("packets", packetId);
  if (!packet.workerId) throw new GigError("no worker took this packet");
  stopSession(store, packetId, packet.workerId);
  const hours = hoursWorked(store.list("sessions", (row) => row.packetId === packetId));
  store.put("packets", { ...packet, status: "accepted" });
  return store.put("payouts", {
    id: JayaStore.newId(), packetId, workerId: packet.workerId, hours, amountCents: Math.round(hours * packet.hourlyRate * 100), status: "owed", createdAt: new Date().toISOString(),
  });
}
