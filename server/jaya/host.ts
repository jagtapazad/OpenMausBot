import { join } from "node:path";

import { createJayaRoutes } from "../routes/jaya.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { StoreChange } from "../store.ts";
import { autopilot } from "./autopilot.ts";
import { claudeBrain, type Brain } from "./brain.ts";
import { demoBrain } from "./demo-brain.ts";
import type { Harness } from "./harness.ts";
import { OpenMausBotHarness } from "./http-harness.ts";
import { JayaStore } from "./store.ts";

export interface JayaHostDeps {
  dataDir: string;
  port: number;
  onChange: (listener: (change: StoreChange) => void) => () => void;
  env?: NodeJS.ProcessEnv;
  brain?: Brain;
  harness?: Harness;
  log?: (line: string) => void;
}

export interface JayaHost {
  routes: RouteHandler;
  store: JayaStore;
  tick: () => Promise<void>;
  close: () => void;
}

const TICK_MS = 30_000;
const SETTLE_MS = 1_500;

export function pickBrain(env: NodeJS.ProcessEnv): Brain {
  const key = env.JAYA_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY;
  return env.JAYA_BRAIN === "claude" && key ? claudeBrain({ apiKey: key }) : demoBrain();
}

export function createJaya(deps: JayaHostDeps): JayaHost {
  const env = deps.env ?? process.env;
  const store = new JayaStore(join(deps.dataDir, "jaya.db"));
  const brain = deps.brain ?? pickBrain(env);
  const harness = deps.harness ?? new OpenMausBotHarness({ url: `http://127.0.0.1:${deps.port}`, approvalMode: "auto" });
  const log = deps.log ?? ((line: string) => console.warn(line));

  let running: Promise<void> | null = null;
  const tick = () => {
    running ??= autopilot({ store, brain, harness })
      .catch((error: unknown) => log(`jaya: autopilot failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { running = null; });
    return running;
  };

  const jayaThreads = () => new Set(store.list("outcomes").map((outcome) => outcome.threadId));
  let settle: NodeJS.Timeout | null = null;
  const stopWatching = deps.onChange((change) => {
    if (change.type !== "message" || change.message.role !== "bot" || !jayaThreads().has(change.threadId)) return;
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => { settle = null; void tick(); }, SETTLE_MS);
    settle.unref?.();
  });
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();

  return {
    routes: createJayaRoutes({ store, brain, harness }),
    store,
    tick,
    close: () => {
      stopWatching();
      clearInterval(timer);
      if (settle) clearTimeout(settle);
      store.close();
    },
  };
}
