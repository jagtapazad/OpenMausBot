// OpenMausBot as the agent harness, over its HTTP API. A department per team, a bot per outcome with its standing
// instructions as the bot's soul, routines for schedules, and the bot's own conversation for everything said.
// Auth: an `omb_sess_` admin token from `openmausbot token create --scope admin`, or none for a server that trusts
// loopback (`openmausbot serve`). Department creation, memory writes and soul edits need admin scope.
import { randomUUID } from "node:crypto";

import type { Schedule } from "../../shared/jaya.ts";
import { QUESTION_TAG } from "./planner.ts";
import type { Harness, HarnessBot, HarnessMessage } from "./harness.ts";

export interface OpenMausBotConfig {
  url: string;
  token?: string;
  /** How bots act without asking: "auto" asks only for risky steps; "full" never asks. */
  approvalMode?: "ask" | "auto" | "full";
  /** The engine and model every bot runs on; the server's default when omitted. */
  modelSelection?: { instanceId: string; model: string };
  fetch?: typeof fetch;
  now?: () => number;
}

/** OpenMausBot's wire message, as much of it as is read here. */
interface WireMessage {
  id: string;
  role: "bot" | "user";
  kind: string;
  text?: string;
  at: number;
  card?: {
    title?: string;
    requestType?: "permission" | "question";
    requestId?: string;
    answered?: string;
    questionRequest?: { questions: Array<{ question: string; options?: Array<{ label: string }> }> };
  };
}

export class HarnessError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const MIN_INTERVAL = 5;
const MAX_INTERVAL = 1440;

/** Our schedule in OpenMausBot's routine schedule shape. */
export function routineSchedule(schedule: Schedule, now: number): Record<string, unknown> {
  switch (schedule.type) {
    case "daily":
    case "weekly":
      return { type: "daily", time: schedule.time ?? "09:00", weekdays: schedule.weekdays.length ? schedule.weekdays : DAYS };
    case "interval":
      return { type: "interval", everyMinutes: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, schedule.everyMinutes ?? 60)), anchorAt: now };
    case "once":
      return { type: "once", at: now + 60_000 };
  }
}

/** A question card's questions, as the text lines the orchestrator reads. */
function cardQuestions(message: WireMessage): string[] {
  const card = message.card;
  if (!card || card.requestType !== "question" || card.answered) return [];
  const asked = card.questionRequest?.questions ?? [];
  if (!asked.length) return card.title ? [card.title] : [];
  return asked.map((question) => question.options?.length ? `${question.question} (options: ${question.options.map((option) => option.label).join(", ")})` : question.question);
}

export class OpenMausBotHarness implements Harness {
  private readonly config: OpenMausBotConfig;
  /** The question card each thread is waiting on: a reply answers the card instead of becoming a new message. */
  private readonly pendingCard = new Map<string, string>();

  constructor(config: OpenMausBotConfig) {
    this.config = { ...config, url: config.url.replace(/\/+$/, "") };
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await (this.config.fetch ?? fetch)(`${this.config.url}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) as unknown : {};
    if (!response.ok) {
      const error = (parsed as { error?: unknown }).error;
      throw new HarnessError(`OpenMausBot ${method} ${path}: ${typeof error === "string" ? error : `HTTP ${response.status}`}`, response.status);
    }
    return parsed as T;
  }

  async createTeam(name: string) {
    const base = name.trim().slice(0, 50) || "Team";
    for (let attempt = 0; attempt < 5; attempt++) {
      const section = attempt ? `${base} ${attempt + 1}` : base;
      try {
        const created = await this.call<{ section: string }>("POST", "/api/sidebar-sections", { name: section });
        return { departmentId: created.section ?? section };
      } catch (error) {
        if (!(error instanceof HarnessError) || error.status !== 409) throw error;
      }
    }
    throw new HarnessError(`could not make a department named like "${base}"`, 409);
  }

  async createAgent(input: { departmentId: string; name: string; role: string; instructions: string }): Promise<HarnessBot> {
    const created = await this.call<{ bot: { id: string; threadId: string } }>("POST", "/api/bots", {
      name: input.name,
      title: input.role.slice(0, 80),
      section: input.departmentId,
      useDefaults: false,
      ...(this.config.modelSelection ? { modelSelection: this.config.modelSelection, requireAvailableModel: true } : {}),
      settings: { soul: input.instructions, approvalMode: this.config.approvalMode ?? "auto" },
    });
    return { botId: created.bot.id, threadId: created.bot.threadId };
  }

  async setInstructions(botId: string, instructions: string) {
    await this.call("PATCH", `/api/bots/${encodeURIComponent(botId)}`, { soul: instructions });
  }

  async writeMemory(botId: string, path: string, text: string) {
    await this.call("PUT", `/api/bots/${encodeURIComponent(botId)}/memory/file`, { path, text });
  }

  async schedule(input: { botId: string; name: string; prompt: string; schedule: Schedule }) {
    const created = await this.call<{ routine: { id: string } }>("POST", "/api/routines", {
      name: input.name.slice(0, 80), prompt: input.prompt, botId: input.botId, target: "bot", sameConversation: true,
      schedule: routineSchedule(input.schedule, (this.config.now ?? Date.now)()),
    });
    return { routineId: created.routine.id };
  }

  async send(bot: HarnessBot, text: string) {
    const requestId = this.pendingCard.get(bot.threadId);
    if (requestId) {
      this.pendingCard.delete(bot.threadId);
      await this.call("POST", `/api/threads/${encodeURIComponent(bot.threadId)}/respond`, { requestId, behavior: "answer", message: text });
      return;
    }
    await this.call("POST", `/api/bots/${encodeURIComponent(bot.botId)}/messages`, { text, threadId: bot.threadId, sendId: randomUUID() });
  }

  async messagesSince(bot: HarnessBot, since: number): Promise<HarnessMessage[]> {
    const { messages } = await this.call<{ messages: WireMessage[] }>("GET", `/api/threads/${encodeURIComponent(bot.threadId)}/messages?limit=200`);
    const out: HarnessMessage[] = [];
    for (const message of messages) {
      if (message.role !== "bot" || message.at <= since) continue;
      if (message.kind === "text" && message.text?.trim()) out.push({ id: message.id, role: "bot", text: message.text, at: message.at });
      const questions = cardQuestions(message);
      if (questions.length) {
        if (message.card?.requestId) this.pendingCard.set(bot.threadId, message.card.requestId);
        out.push({ id: message.id, role: "bot", text: questions.map((question) => `${QUESTION_TAG} ${question}`).join("\n"), at: message.at });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }
}
