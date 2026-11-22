import type { Brief, Engagement, EngagementView } from "../../shared/jaya";
import { api } from "@/state/api";

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const jayaApi = {
  engagements: () => api<Engagement[]>("/api/jaya/engagements", { background: true }),
  view: (id: string) => api<EngagementView>(`/api/jaya/engagements/${encodeURIComponent(id)}`, { background: true }),
  start: (phone: string | null) => post<Engagement>("/api/jaya/engagements", { phone }),
  say: (id: string, text: string) => post<{ engagement: Engagement; reply: string; ready: boolean }>(`/api/jaya/engagements/${encodeURIComponent(id)}/intake`, { text }),
  launch: (id: string) => post<Engagement>(`/api/jaya/engagements/${encodeURIComponent(id)}/launch`),
  refresh: (id: string) => post(`/api/jaya/engagements/${encodeURIComponent(id)}/refresh`),
  answer: (checkInId: string, replies: Record<string, string>) => post(`/api/jaya/checkins/${encodeURIComponent(checkInId)}/answers`, { replies }),
  review: (attemptId: string, verdict: "accepted" | "rejected", feedback: string | null) =>
    post(`/api/jaya/attempts/${encodeURIComponent(attemptId)}/review`, { verdict, feedback }),
};

export type BriefCheck = "outcomes" | "deliverables" | "criteria" | "context" | "contact";

export function briefChecks(brief: Brief): Array<{ key: BriefCheck; done: boolean }> {
  const outcomes = brief.outcomes;
  const every = (test: (outcome: Brief["outcomes"][number]) => boolean) => outcomes.length > 0 && outcomes.every(test);
  return [
    { key: "outcomes", done: outcomes.length > 0 },
    { key: "deliverables", done: every((outcome) => outcome.deliverable.trim().length > 0) },
    { key: "criteria", done: every((outcome) => outcome.successCriteria.length > 0) },
    { key: "context", done: brief.context.length > 0 || brief.summary.trim().length > 0 },
    { key: "contact", done: Boolean(brief.contactPreferences?.trim()) },
  ];
}
