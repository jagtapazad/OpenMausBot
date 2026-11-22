import { emptyBrief, type EngagementView } from "../../../shared/jaya";

const spec = {
  title: "Weekly social posts for the bakery",
  why: "Keep the shop busy on slow weekdays",
  deliverable: "Three Instagram captions every Monday",
  successCriteria: ["Three captions, each under 150 characters", "No prices", "Warm, friendly tone"],
  cadence: "Weekly on Monday",
  deadline: null,
  constraints: ["Never mention prices"],
};

export function jayaPreviewView(state: string, now: number): EngagementView | null {
  if (state === "start") return null;
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const transcript = [
    { role: "agent" as const, text: "Hi! I'm going to set up a small team of AI agents to get things done for you. To start: what outcomes are you looking for?", at: at(6) },
    { role: "person" as const, text: "Weekly social posts for my bakery", at: at(5) },
    { role: "agent" as const, text: "Got it. What exactly should you get back, so you'd know it's done?", at: at(5) },
    { role: "person" as const, text: "Three Instagram captions every Monday, never mention prices", at: at(3) },
    { role: "agent" as const, text: "How often should this happen, and how should the team reach you with questions?", at: at(3) },
  ];
  const done = state !== "intake";
  const brief = {
    ...emptyBrief(),
    summary: "A neighbourhood bakery that wants steady social posts.",
    outcomes: [spec],
    context: ["Family bakery, two shops"],
    toolsAndAccounts: ["Instagram"],
    contactPreferences: done ? "Text, weekdays 9 to 5" : null,
    openQuestions: done ? [] : ["Which days are busiest?"],
  };
  const engagement = {
    id: "preview", createdAt: at(6), status: state === "dashboard" ? "running" as const : done ? "planning" as const : "intake" as const,
    phone: "+15550100", transcript: done ? [...transcript, { role: "person" as const, text: "Weekly on Monday, text me", at: at(1) }] : transcript,
    brief, plan: state === "dashboard" ? { teamName: "Bakery social", agents: [] } : null, departmentId: null,
  };
  if (state !== "dashboard") return { engagement, outcomes: [], attempts: [], checkins: [], packets: [], actions: [] };
  const outcome = { id: "o1", engagementId: "preview", index: 0, spec, status: "in-review" as const, agentId: "Max", botId: "b1", threadId: "t1", rejections: 1, seenUntil: 0 };
  return {
    engagement,
    outcomes: [outcome, { ...outcome, id: "o2", index: 1, status: "working", agentId: "Ivy", spec: { ...spec, title: "Monthly newsletter", deliverable: "A 300-word email", cadence: "Monthly" }, rejections: 0 }],
    attempts: [{ id: "a1", outcomeId: "o1", by: "agent", verdict: "pending", feedback: null, createdAt: at(2),
      deliverable: "1. Fresh sourdough just came out of the oven.\n2. Monday treat: our cinnamon knots are back.\n3. Come say hi, the coffee's on us." }],
    checkins: [{ id: "c1", engagementId: "preview", createdAt: at(4), channel: "sms", status: "sent", intro: "Two quick questions from your team.",
      questions: [{ id: "q1", text: "Should posts mention opening hours?", answers: [], reply: null }, { id: "q2", text: "Any days to skip?", answers: [], reply: null }] }],
    packets: [],
    actions: [],
  };
}
