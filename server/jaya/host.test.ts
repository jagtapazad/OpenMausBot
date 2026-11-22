import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { StoreChange } from "../store.ts";
import { createJaya, pickBrain } from "./host.ts";
import { SimulatedHarness } from "./simulated-harness.ts";

const folders: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function host() {
  const dataDir = mkdtempSync(join(tmpdir(), "jaya-host-"));
  folders.push(dataDir);
  const listeners: Array<(change: StoreChange) => void> = [];
  const jaya = createJaya({ dataDir, port: 1, harness: new SimulatedHarness(), env: {}, onChange: (listener) => { listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1); }; } });
  closers.push(jaya.close);
  return { jaya, listeners };
}

describe("the Jaya host", () => {
  it("keeps its records in jaya.db in the data folder and stops listening when closed", () => {
    const { jaya, listeners } = host();
    expect(jaya.store.list("engagements")).toEqual([]);
    expect(listeners).toHaveLength(1);
    jaya.close();
    closers.splice(0);
    expect(listeners).toHaveLength(0);
  });

  it("uses the demo brain unless Claude is asked for and a key is set", () => {
    expect(pickBrain({})).not.toBe(pickBrain({}));
    const demo = pickBrain({ JAYA_BRAIN: "claude" });
    const claude = pickBrain({ JAYA_BRAIN: "claude", ANTHROPIC_API_KEY: "sk-test" });
    expect(demo.structured.toString()).not.toBe(claude.structured.toString());
  });

  it("runs the autopilot on demand without overlapping runs", async () => {
    const { jaya } = host();
    const first = jaya.tick();
    expect(jaya.tick()).toBe(first);
    await first;
  });
});
