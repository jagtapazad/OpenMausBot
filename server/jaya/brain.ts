// The model behind the intake call, the planner, check-in batching and work packets. Every call asks for one
// structured answer validated by a Zod schema, so the rest of the product never parses free text.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface BrainTask<T> {
  /** Names the call in logs and in the scripted brain the tests use. */
  purpose: "intake" | "plan" | "checkin" | "packet" | "deliverable";
  system: string;
  messages: Turn[];
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high" | "xhigh";
}

export interface Brain {
  structured<T>(task: BrainTask<T>): Promise<T>;
}

export class BrainRefused extends Error {}

export const CLAUDE_MODEL = "claude-opus-5-5";

export function claudeBrain(options: { apiKey: string } | { client: Anthropic }): Brain {
  const client = "client" in options ? options.client : new Anthropic({ apiKey: options.apiKey });
  return {
    async structured<T>(task: BrainTask<T>): Promise<T> {
      // Server-side fallbacks: a safety decline is retried on a fallback model inside the same call.
      const response = await client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: task.system, cache_control: { type: "ephemeral" } }],
        messages: task.messages,
        output_config: { effort: task.effort ?? "medium", format: betaZodOutputFormat(task.schema) },
      });
      if (response.stop_reason === "refusal") throw new BrainRefused(`the model declined the ${task.purpose} request`);
      if (response.parsed_output == null) throw new Error(`the model's ${task.purpose} answer did not match its schema (stop: ${response.stop_reason})`);
      return response.parsed_output as T;
    },
  };
}

/** A fixed answer, or one worked out from the request. */
export type ScriptStep = object | ((task: BrainTask<unknown>) => unknown);

/** Answers from a script, in order per purpose: for tests and for running the product without an API key. */
export function scriptedBrain(script: Partial<Record<BrainTask<unknown>["purpose"], ScriptStep[]>>): Brain & { calls: Array<BrainTask<unknown>> } {
  const calls: Array<BrainTask<unknown>> = [];
  const next = new Map<string, number>();
  return {
    calls,
    async structured<T>(task: BrainTask<T>): Promise<T> {
      calls.push(task as BrainTask<unknown>);
      const answers = script[task.purpose] ?? [];
      const index = next.get(task.purpose) ?? 0;
      const answer = answers[Math.min(index, answers.length - 1)];
      if (answer === undefined) throw new Error(`no scripted answer for ${task.purpose}`);
      next.set(task.purpose, index + 1);
      const value = typeof answer === "function" ? (answer as (t: BrainTask<unknown>) => unknown)(task as BrainTask<unknown>) : answer;
      return task.schema.parse(value);
    },
  };
}
