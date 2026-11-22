import type { Schedule } from "../../shared/jaya.ts";

export interface HarnessBot {
  botId: string;
  threadId: string;
}

export interface HarnessMessage {
  id: string;
  role: "bot" | "person";
  text: string;
  /** Milliseconds since the epoch. */
  at: number;
}

/** What the product asks of the agent harness (OpenMausBot): a team, its agents, their schedules and conversations. */
export interface Harness {
  createTeam(name: string): Promise<{ departmentId: string }>;
  createAgent(input: { departmentId: string; name: string; role: string; instructions: string }): Promise<HarnessBot>;
  setInstructions(botId: string, instructions: string): Promise<void>;
  /** A note in the agent's own memory, which it reads on every turn. */
  writeMemory(botId: string, path: string, text: string): Promise<void>;
  schedule(input: { botId: string; name: string; prompt: string; schedule: Schedule }): Promise<{ routineId: string }>;
  send(bot: HarnessBot, text: string): Promise<void>;
  /** The bot's messages after `since` (ms), oldest first. */
  messagesSince(bot: HarnessBot, since: number): Promise<HarnessMessage[]>;
}
