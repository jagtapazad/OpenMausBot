import { z } from "zod";

/** One result the person wants, written so a stranger could tell whether it was reached. */
export const OutcomeSpec = z.object({
  title: z.string(),
  why: z.string(),
  deliverable: z.string(),
  successCriteria: z.array(z.string()),
  /** "once", or how often it repeats ("every weekday at 9:00", "weekly on Monday"). */
  cadence: z.string(),
  deadline: z.string().nullable(),
  constraints: z.array(z.string()),
});
export type OutcomeSpec = z.infer<typeof OutcomeSpec>;

/** Everything the intake call learned. Grows turn by turn; the planner reads the final one. */
export const Brief = z.object({
  personName: z.string().nullable(),
  summary: z.string(),
  context: z.array(z.string()),
  outcomes: z.array(OutcomeSpec),
  toolsAndAccounts: z.array(z.string()),
  preferences: z.array(z.string()),
  /** When and how the person wants to be reached for questions. */
  contactPreferences: z.string().nullable(),
  openQuestions: z.array(z.string()),
});
export type Brief = z.infer<typeof Brief>;

export const emptyBrief = (): Brief => ({
  personName: null, summary: "", context: [], outcomes: [], toolsAndAccounts: [], preferences: [], contactPreferences: null, openQuestions: [],
});

/** The interviewer's answer to one turn of the intake conversation. */
export const IntakeTurn = z.object({
  reply: z.string(),
  brief: Brief,
  /** True once every outcome has a deliverable and success criteria the person agreed to. */
  ready: z.boolean(),
});
export type IntakeTurn = z.infer<typeof IntakeTurn>;

export const Schedule = z.object({
  type: z.enum(["once", "daily", "weekly", "interval"]),
  /** "09:00" for daily and weekly. */
  time: z.string().nullable(),
  /** 0 = Sunday … 6 = Saturday, for weekly. */
  weekdays: z.array(z.number().int().min(0).max(6)),
  everyMinutes: z.number().int().positive().nullable(),
});
export type Schedule = z.infer<typeof Schedule>;

/** One agent the planner sets up for one outcome. */
export const AgentSpec = z.object({
  outcomeIndex: z.number().int().min(0),
  name: z.string(),
  role: z.string(),
  instructions: z.string(),
  kickoff: z.string(),
  schedule: Schedule,
  /** What the agent must hand back for the person to review. */
  handback: z.string(),
});
export type AgentSpec = z.infer<typeof AgentSpec>;

export const Plan = z.object({
  teamName: z.string(),
  agents: z.array(AgentSpec),
});
export type Plan = z.infer<typeof Plan>;

/** Many agents' open questions, merged into the few the person answers in one go. */
export const CheckInDraft = z.object({
  intro: z.string(),
  questions: z.array(z.object({
    text: z.string(),
    /** The clarification ids this question answers. */
    answers: z.array(z.string()),
  })),
});
export type CheckInDraft = z.infer<typeof CheckInDraft>;

/** What a gig worker gets when the agents could not reach an outcome on their own. */
export const WorkPacketDraft = z.object({
  title: z.string(),
  situation: z.string(),
  outcome: z.string(),
  successCriteria: z.array(z.string()),
  whatWasTried: z.array(z.string()),
  whyItFellShort: z.array(z.string()),
  suggestedApproach: z.array(z.string()),
  estimatedHours: z.number().positive(),
  skills: z.array(z.string()),
});
export type WorkPacketDraft = z.infer<typeof WorkPacketDraft>;

export type EngagementStatus = "intake" | "planning" | "running" | "done";
export interface Engagement {
  id: string;
  createdAt: string;
  status: EngagementStatus;
  /** The person's phone, for check-in calls and texts. */
  phone: string | null;
  transcript: Array<{ role: "agent" | "person"; text: string; at: string }>;
  brief: Brief;
  plan: Plan | null;
  /** The harness department the agents live in. */
  departmentId: string | null;
}

export type OutcomeStatus = "working" | "needs-input" | "in-review" | "accepted" | "escalated";
export interface Outcome {
  id: string;
  engagementId: string;
  index: number;
  spec: OutcomeSpec;
  status: OutcomeStatus;
  agentId: string;
  /** The harness bot and its conversation. */
  botId: string;
  threadId: string;
  /** Reviews the person has turned down; past the engagement's limit the outcome goes to a gig worker. */
  rejections: number;
  /** The newest bot message already read, in ms. */
  seenUntil: number;
}

export type ClarificationStatus = "open" | "asked" | "answered";
export interface Clarification {
  id: string;
  engagementId: string;
  outcomeId: string;
  question: string;
  status: ClarificationStatus;
  answer: string | null;
  checkInId: string | null;
  createdAt: string;
}

export interface CheckIn {
  id: string;
  engagementId: string;
  createdAt: string;
  channel: "web" | "sms" | "call";
  intro: string;
  questions: Array<{ id: string; text: string; answers: string[]; reply: string | null }>;
  status: "sent" | "answered";
}

export type AttemptVerdict = "pending" | "accepted" | "rejected";
export interface Attempt {
  id: string;
  outcomeId: string;
  /** The person's own agent work, or a gig worker's. */
  by: "agent" | "worker";
  deliverable: string;
  verdict: AttemptVerdict;
  feedback: string | null;
  createdAt: string;
}

export type PacketStatus = "open" | "claimed" | "submitted" | "accepted";
export interface WorkPacket extends WorkPacketDraft {
  id: string;
  outcomeId: string;
  engagementId: string;
  status: PacketStatus;
  hourlyRate: number;
  workerId: string | null;
  /** The agent's setup as it was handed over, for the worker to start from. */
  agentSetup: { botId: string; threadId: string; instructions: string; schedule: Schedule };
  createdAt: string;
}

export interface Worker {
  id: string;
  name: string;
  skills: string[];
  hourlyRate: number;
}

export interface WorkSession {
  id: string;
  packetId: string;
  workerId: string;
  startedAt: string;
  endedAt: string | null;
}

/** Everything a worker did to an agent, kept so the person can see how their agent was changed. */
export interface WorkerAction {
  id: string;
  packetId: string;
  workerId: string;
  kind: "prompt" | "instructions" | "memory";
  detail: string;
  at: string;
}

export interface Payout {
  id: string;
  packetId: string;
  workerId: string;
  hours: number;
  amountCents: number;
  status: "owed" | "paid";
  createdAt: string;
}
