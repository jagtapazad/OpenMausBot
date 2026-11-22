import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { demoBrain } from "../jaya/demo-brain.ts";
import { SimulatedHarness } from "../jaya/simulated-harness.ts";
import { JayaStore } from "../jaya/store.ts";
import { requiredScope } from "../request-auth.ts";
import { createJayaRoutes } from "./jaya.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve() {
  const store = new JayaStore(":memory:");
  const routes = [createJayaRoutes({ store, brain: demoBrain(), harness: new SimulatedHarness() })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  return { store, call };
}

describe("Jaya's routes", () => {
  it("are for the owner only", () => {
    expect(requiredScope("GET", "/api/jaya/engagements")).toBe("admin");
    expect(requiredScope("POST", "/api/jaya/packets/p1/act")).toBe("admin");
  });

  it("take a person from intake to a reviewed deliverable", async () => {
    const { call } = await serve();
    const { status, body: engagement } = await call("POST", "/api/jaya/engagements", { phone: "+15550100" });
    expect(status).toBe(201);
    for (const said of ["Weekly social posts for my bakery", "Three Instagram captions every Monday", "Weekly on Monday", "Never mention prices; text me"]) {
      expect((await call("POST", `/api/jaya/engagements/${engagement.id}/intake`, { text: said })).status).toBe(200);
    }
    const state = (await call("GET", `/api/jaya/engagements/${engagement.id}`)).body;
    expect(state.engagement.status).toBe("planning");
    expect((await call("POST", `/api/jaya/engagements/${engagement.id}/intake`, { text: "one more" })).status).toBe(409);

    expect((await call("POST", `/api/jaya/engagements/${engagement.id}/launch`)).body.status).toBe("running");
    const { body: found } = await call("POST", `/api/jaya/engagements/${engagement.id}/refresh`);
    expect(found.checkIn.questions).toHaveLength(1);
    await call("POST", `/api/jaya/checkins/${found.checkIn.id}/answers`, { replies: { [found.checkIn.questions[0].id]: "Friendly and short." } });

    const { body: delivered } = await call("POST", `/api/jaya/engagements/${engagement.id}/refresh`);
    expect(delivered.attempts).toHaveLength(1);
    expect((await call("POST", `/api/jaya/attempts/${delivered.attempts[0].id}/review`, { verdict: "rejected" })).status).toBe(409);
    expect((await call("POST", `/api/jaya/attempts/${delivered.attempts[0].id}/review`, { verdict: "accepted" })).body.outcome.status).toBe("accepted");
  });

  it("answer a bad request with what was wrong, a missing record with 404, and pass on other paths", async () => {
    const { call } = await serve();
    expect((await call("POST", "/api/jaya/engagements/nope/intake", { text: "" })).status).toBe(400);
    expect((await call("GET", "/api/jaya/engagements/nope")).status).toBe(404);
    expect((await call("GET", "/api/jaya/unknown")).body).toEqual({ from: "inline routes" });
    expect((await call("GET", "/api/bots")).body).toEqual({ from: "inline routes" });
  });

  it("return a worker with their jobs, payouts and timer sessions", async () => {
    const { call } = await serve();
    const { body: worker } = await call("POST", "/api/jaya/workers", { name: "Ana", skills: ["copywriting"], hourlyRate: 18 });
    const { body: me } = await call("GET", `/api/jaya/workers/${worker.id}`);
    expect(me).toMatchObject({ worker: { name: "Ana", hourlyRate: 18 }, packets: [], payouts: [], sessions: [] });
  });
});
