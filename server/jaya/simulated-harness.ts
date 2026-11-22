// A stand-in for OpenMausBot: agents that answer at once, by a script, so the whole loop (questions, check-ins,
// reviews, escalation) runs in tests and in a demo without a harness or model.
import { randomUUID } from "node:crypto";

import { DELIVERABLE_TAG, QUESTION_TAG } from "./planner.ts";
import type { Harness, HarnessBot, HarnessMessage } from "./harness.ts";

interface SimBot {
  bot: HarnessBot;
  name: string;
  instructions: string;
  memory: Map<string, string>;
  messages: HarnessMessage[];
  routines: Array<{ name: string; prompt: string }>;
  turns: number;
}

/** How a simulated agent answers its nth message (0 = the kickoff). Return null to stay quiet. */
export type SimScript = (turn: number, text: string, bot: { name: string; instructions: string; memory: ReadonlyMap<string, string> }) => string | null;

/** Asks one question on the kickoff, then hands back a deliverable after every later message. */
export const askThenDeliver: SimScript = (turn, text, bot) => turn === 0
  ? `${QUESTION_TAG} Before I start: is there anything I should know about how you like this done?`
  : `${DELIVERABLE_TAG} Draft ${turn} from ${bot.name}, taking into account: "${text.slice(0, 120)}".\n- Every success criterion checked.`;

export class SimulatedHarness implements Harness {
  readonly bots = new Map<string, SimBot>();
  readonly teams = new Map<string, string>();
  private clock: number;
  private readonly script: SimScript;

  constructor(script: SimScript = askThenDeliver, start = Date.now()) {
    this.script = script;
    this.clock = start;
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  async createTeam(name: string) {
    const departmentId = name;
    this.teams.set(departmentId, name);
    return { departmentId };
  }

  async createAgent(input: { departmentId: string; name: string; role: string; instructions: string }) {
    const bot = { botId: randomUUID(), threadId: randomUUID() };
    this.bots.set(bot.botId, { bot, name: input.name, instructions: input.instructions, memory: new Map(), messages: [], routines: [], turns: 0 });
    return bot;
  }

  private sim(botId: string): SimBot {
    const found = this.bots.get(botId);
    if (!found) throw new Error(`no simulated bot ${botId}`);
    return found;
  }

  async setInstructions(botId: string, instructions: string) {
    this.sim(botId).instructions = instructions;
  }

  async writeMemory(botId: string, path: string, text: string) {
    this.sim(botId).memory.set(path, text);
  }

  async schedule(input: { botId: string; name: string; prompt: string }) {
    this.sim(input.botId).routines.push({ name: input.name, prompt: input.prompt });
    return { routineId: randomUUID() };
  }

  async send(bot: HarnessBot, text: string) {
    const sim = this.sim(bot.botId);
    sim.messages.push({ id: randomUUID(), role: "person", text, at: this.tick() });
    const reply = this.script(sim.turns++, text, sim);
    if (reply !== null) sim.messages.push({ id: randomUUID(), role: "bot", text: reply, at: this.tick() });
  }

  async messagesSince(bot: HarnessBot, since: number) {
    return this.sim(bot.botId).messages.filter((message) => message.role === "bot" && message.at > since);
  }
}
