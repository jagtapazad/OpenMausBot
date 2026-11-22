import { z } from "zod";

import { BrainRefused } from "../jaya/brain.ts";
import { answerCheckIn, batchCheckIn, type Delivery } from "../jaya/checkins.ts";
import type { Outcome } from "../../shared/jaya.ts";
import { claim, GigError, hoursWorked, registerWorker, startSession, stopSession, workerAct } from "../jaya/gig.ts";
import { IntakeClosed, intakeTurn, startIntake } from "../jaya/intake.ts";
import { launch, poll, type Deps } from "../jaya/orchestrator.ts";
import { review, ReviewError } from "../jaya/reviews.ts";
import { NotFound } from "../jaya/store.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export interface JayaRouteDeps extends Deps {
  delivery?: Delivery;
}

const text = z.object({ text: z.string().min(1).max(4000) });
const workerBody = z.object({ workerId: z.string().min(1) });

type Match = (ctx: RouteContext, params: string[]) => Promise<unknown>;

export function createJayaRoutes(deps: JayaRouteDeps): RouteHandler {
  const { store } = deps;
  const instructionsFor = (outcome: Outcome) =>
    store.must("engagements", outcome.engagementId).plan?.agents.find((agent) => agent.outcomeIndex === outcome.index)?.instructions ?? "";
  const body = async <T>(ctx: RouteContext, schema: z.ZodType<T>) => schema.parse(await ctx.readBody(ctx.req).catch(() => ({})));

  const engagementView = (id: string) => {
    const engagement = store.must("engagements", id);
    const outcomes = store.list("outcomes", (row) => row.engagementId === id).sort((a, b) => a.index - b.index);
    const outcomeIds = new Set(outcomes.map((row) => row.id));
    const packets = store.list("packets", (row) => row.engagementId === id);
    const packetIds = new Set(packets.map((row) => row.id));
    return {
      engagement,
      outcomes,
      attempts: store.list("attempts", (row) => outcomeIds.has(row.outcomeId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      checkins: store.list("checkins", (row) => row.engagementId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      packets,
      actions: store.list("actions", (row) => packetIds.has(row.packetId)),
    };
  };

  const routes: Array<[method: string, pattern: RegExp, run: Match]> = [
    ["GET", /^\/api\/jaya\/engagements$/, async () =>
      store.list("engagements").sort((a, b) => b.createdAt.localeCompare(a.createdAt))],
    ["POST", /^\/api\/jaya\/engagements$/, async (ctx) => {
      const { phone } = await body(ctx, z.object({ phone: z.string().max(20).nullable().optional() }));
      return startIntake(store, phone ?? null);
    }],
    ["GET", /^\/api\/jaya\/engagements\/([^/]+)$/, async (_ctx, [id]) => engagementView(id!)],
    ["POST", /^\/api\/jaya\/engagements\/([^/]+)\/intake$/, async (ctx, [id]) =>
      intakeTurn(store, deps.brain, id!, (await body(ctx, text)).text)],
    ["POST", /^\/api\/jaya\/engagements\/([^/]+)\/launch$/, async (_ctx, [id]) => launch(deps, id!)],
    ["POST", /^\/api\/jaya\/engagements\/([^/]+)\/refresh$/, async (_ctx, [id]) => {
      const found = await poll(deps, id!);
      const checkIn = found.questions.length ? await batchCheckIn(deps, id!) : null;
      return { ...found, checkIn };
    }],
    ["POST", /^\/api\/jaya\/checkins\/([^/]+)\/answers$/, async (ctx, [id]) => {
      const { replies } = await body(ctx, z.object({ replies: z.record(z.string(), z.string().max(4000)) }));
      return answerCheckIn(deps, id!, replies);
    }],
    ["POST", /^\/api\/jaya\/attempts\/([^/]+)\/review$/, async (ctx, [id]) => {
      const input = await body(ctx, z.object({ verdict: z.enum(["accepted", "rejected"]), feedback: z.string().max(4000).nullable().optional() }));
      return review(deps, id!, input.verdict, input.feedback ?? null, instructionsFor);
    }],
    ["POST", /^\/api\/jaya\/workers$/, async (ctx) => {
      const input = await body(ctx, z.object({ name: z.string().min(1).max(80), skills: z.array(z.string().max(40)).max(20).default([]), hourlyRate: z.number().optional() }));
      return registerWorker(store, input);
    }],
    ["GET", /^\/api\/jaya\/workers\/([^/]+)$/, async (_ctx, [id]) => {
      const worker = store.must("workers", id!);
      return {
        worker,
        packets: store.list("packets", (row) => row.workerId === worker.id),
        payouts: store.list("payouts", (row) => row.workerId === worker.id),
        sessions: store.list("sessions", (row) => row.workerId === worker.id),
      };
    }],
    ["GET", /^\/api\/jaya\/packets$/, async (ctx) => {
      const status = ctx.url.searchParams.get("status");
      return store.list("packets", (row) => !status || row.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }],
    ["GET", /^\/api\/jaya\/packets\/([^/]+)$/, async (_ctx, [id]) => {
      const packet = store.must("packets", id!);
      const sessions = store.list("sessions", (row) => row.packetId === packet.id);
      return {
        packet,
        sessions,
        hours: hoursWorked(sessions),
        actions: store.list("actions", (row) => row.packetId === packet.id).sort((a, b) => a.at.localeCompare(b.at)),
        attempts: store.list("attempts", (row) => row.outcomeId === packet.outcomeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      };
    }],
    ["POST", /^\/api\/jaya\/packets\/([^/]+)\/claim$/, async (ctx, [id]) => claim(store, id!, (await body(ctx, workerBody)).workerId)],
    ["POST", /^\/api\/jaya\/packets\/([^/]+)\/session\/start$/, async (ctx, [id]) => startSession(store, id!, (await body(ctx, workerBody)).workerId)],
    ["POST", /^\/api\/jaya\/packets\/([^/]+)\/session\/stop$/, async (ctx, [id]) => stopSession(store, id!, (await body(ctx, workerBody)).workerId)],
    ["POST", /^\/api\/jaya\/packets\/([^/]+)\/act$/, async (ctx, [id]) => {
      const input = await body(ctx, workerBody.extend({
        kind: z.enum(["prompt", "instructions", "memory"]),
        text: z.string().min(1).max(20000),
        path: z.string().regex(/^memory\/[\w-]+\.md$/).optional(),
      }));
      return workerAct(deps, id!, input.workerId, input);
    }],
  ];

  return async (ctx) => {
    if (!ctx.path.startsWith("/api/jaya/")) return PASS;
    for (const [method, pattern, run] of routes) {
      if (method !== ctx.method) continue;
      const found = pattern.exec(ctx.path);
      if (!found) continue;
      try {
        const result = await run(ctx, found.slice(1).map(decodeURIComponent));
        return ctx.json(ctx.res, method === "POST" && /\/(engagements|workers)$/.test(ctx.path) ? 201 : 200, result);
      } catch (error) {
        return ctx.json(ctx.res, ...failure(error));
      }
    }
    return PASS;
  };
}

function failure(error: unknown): [number, { error: string }] {
  if (error instanceof NotFound) return [404, { error: "Not found." }];
  if (error instanceof z.ZodError) return [400, { error: error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ") }];
  if (error instanceof GigError || error instanceof ReviewError || error instanceof IntakeClosed) return [409, { error: error.message }];
  if (error instanceof BrainRefused) return [422, { error: error.message }];
  throw error;
}
