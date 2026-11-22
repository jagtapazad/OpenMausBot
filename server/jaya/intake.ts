// The first call: a conversation, usually ten to fifteen minutes, that turns what the person wants into a brief of
// outcomes precise enough to hand to agents. It works the same typed in the app or spoken on the phone.
import type { Brain } from "./brain.ts";
import { JayaStore } from "./store.ts";
import { Brief, emptyBrief, IntakeTurn, type Engagement } from "./domain.ts";

export const OPENING = "Hi! I'm going to set up a small team of AI agents to get things done for you. To start: what outcomes are you looking for? Tell me in your own words, and I'll ask about the details.";

const SYSTEM = `You run the intake call for an AI agent service. A person tells you what they want done; you turn it into a brief a team of AI agents can work from. The agents will run on schedules and call or text the person when they get stuck.

How to run the call:
- Keep it a conversation. Ask one or two questions at a time, in plain words, and react to what they said.
- First find every outcome they want. Then, for each one, pin down: the deliverable (what exactly they get), success criteria they agree to (things a stranger could check), how often it happens (once, or a cadence such as "every weekday at 9:00"), any deadline, and constraints (budget, tone, things to never do).
- Learn the context the agents need: who the person is, their business or situation, the tools and accounts involved (names only, never passwords), and their preferences.
- Ask when and how they want to be reached with questions (call or text, hours).
- Read back each outcome in one sentence and get a yes before treating it as settled.
- Don't invent facts. Anything unknown goes in openQuestions.

Every turn, return:
- reply: what you say next, spoken-length (at most about 80 words).
- brief: the whole brief as it stands now, with everything learned so far (not only this turn's changes).
- ready: true only when every outcome has a deliverable and success criteria the person confirmed, and you know how to reach them. When ready, your reply tells them the team is being set up and that agents will check in with batched questions.`;

export function startIntake(store: JayaStore, phone: string | null = null): Engagement {
  const now = new Date().toISOString();
  return store.put("engagements", {
    id: JayaStore.newId(), createdAt: now, status: "intake", phone, departmentId: null, plan: null,
    brief: emptyBrief(), transcript: [{ role: "agent", text: OPENING, at: now }],
  });
}

export async function intakeTurn(store: JayaStore, brain: Brain, engagementId: string, text: string): Promise<{ engagement: Engagement; reply: string; ready: boolean }> {
  const engagement = store.must("engagements", engagementId);
  if (engagement.status !== "intake") throw new IntakeClosed("This intake call is already finished.");
  const said = text.trim();
  if (!said) throw new IntakeClosed("Say something first.");
  const transcript = [...engagement.transcript, { role: "person" as const, text: said, at: new Date().toISOString() }];
  const turn = await brain.structured({
    purpose: "intake",
    system: SYSTEM,
    effort: "medium",
    messages: [
      ...transcript.map((line) => ({ role: line.role === "agent" ? "assistant" as const : "user" as const, content: line.text })),
      // The brief so far rides on the last user turn, so the model keeps building the same one.
      { role: "user", content: `(Brief so far, for you only: ${JSON.stringify(engagement.brief)})` },
    ],
    schema: IntakeTurn,
  });
  const brief = Brief.parse(turn.brief);
  const ready = turn.ready && brief.outcomes.length > 0 && brief.outcomes.every((outcome) => outcome.deliverable.trim() && outcome.successCriteria.length > 0);
  const saved = store.put("engagements", {
    ...engagement,
    brief,
    status: ready ? "planning" : "intake",
    transcript: [...transcript, { role: "agent", text: turn.reply, at: new Date().toISOString() }],
  });
  return { engagement: saved, reply: turn.reply, ready };
}

export class IntakeClosed extends Error {}
