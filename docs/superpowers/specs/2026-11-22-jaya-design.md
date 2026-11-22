# Jaya: outcome agents with phone calls and a gig worker backstop

Date: 2026-11-22. Base: upstream/main 6ef53dd80. Fork: jagtapazad/OpenMausBot.

## Why

A person wants outcomes ("three Instagram captions every Monday"), not a chat.
Jaya turns a short call into a brief, builds a team of bots for it, lets the
bots check in with batched questions by text or phone, and when a bot cannot
get an outcome accepted, hands the work to a paid human specialist who steers
that same bot. It ran as a separate app over the public HTTP API
(jagtapazad/jaya); this fork builds it in.

## Goals

- An intake call (typed, spoken in the app, or a real phone call) that fills a
  brief: outcomes, deliverables, success criteria, cadence, contact rules.
- One bot per outcome in a sidebar section, with the brief in its memory and a
  routine for anything recurring.
- Batched check-ins: open questions from every bot merged into a few, sent in
  the app, by text or by phone call, with answers routed back to the bots
  that asked.
- Reviews: accept, or send back with a reason. After three rejections the
  outcome becomes a work packet for a gig worker.
- Gig workers, invited by the owner, see a job board, claim a packet, run a
  timer and steer the bot (prompt, instructions, memory). Accepted work
  records what they are owed.

## Non-goals (v1)

- Paying workers. Payouts are recorded, not sent.
- Accounts for clients other than the owner of the server.
- Gemini for phone calls (needs PCM16 transcoding); OpenAI Realtime only.
- Call recording.

## Anti-goals

- A second app: Jaya uses the app's bots, memory, routines, threads, config,
  TTS and speech, and its webhook ingress. No new public listener.
- Workers inside the owner's app: they get a separate page and a token that
  reaches only Jaya's gig routes.

## Design

### Server (`server/jaya/`)

- `domain.ts`: zod types for engagements, outcomes, clarifications,
  check-ins, attempts, packets, workers, sessions, actions, payouts.
- `store.ts`: `openJayaStore(dataDir)` over `jaya.db` (`node:sqlite`), each
  record a zod-checked JSON column, as `server/runtime/store.ts` does. A new
  file, so no data-format change.
- `harness.ts`: the operations Jaya needs from the app (department, bot with
  instructions, memory file, routine, send, replies), implemented on the
  app's own store, memory journal, routine manager and turn starter, with a
  simulated harness for tests.
- `brain.ts`: structured model calls (intake turn, plan, merged check-in,
  work packet), validated by zod, with a demo brain that makes no calls.
- `intake.ts`, `planner.ts`, `orchestrator.ts`, `checkins.ts`, `reviews.ts`,
  `gig.ts`, `autopilot.ts` (driven by message events, not a timer).
- `server/routes/jaya.ts`: `/api/jaya/*`, owner only, plus `/api/jaya/gig/*`
  for worker tokens.

### Phone (`server/jaya/calls/`, `server/jaya/twilio.ts`)

- Texts: `POST /hooks/jaya/sms` through the webhook ingress door, Twilio
  signed, answered with TwiML.
- Calls: Twilio places or receives the call; `POST /hooks/jaya/voice` answers
  `<Connect><Stream>` to `/hooks/jaya/media/<token>`, a WebSocket on the
  ingress listener. The bridge passes 8 kHz G.711 μ-law frames straight to
  OpenAI Realtime (`g711_ulaw` in and out), clears Twilio's buffer when the
  person starts talking, and writes both sides' transcripts into the
  engagement, where the brain updates the brief as in a typed call.

### Interface (`src/components/jaya/`)

- Owner: a Jaya page among the sidebar tools: the intake call (timer,
  transcript, dictation, spoken replies, live brief), outcomes, check-ins,
  reviews, workers and their changes.
- Workers: `/jaya/gig`, a standalone page like `/pair`: join, stats, job
  board, jobs, and a workspace with the packet and a console for the bot.
- Built to `DESIGN.md`: tokens, Geist, lucide icons, `t()` strings,
  `Segmented`, both skins, preview pages for `pnpm shots`.

## Security

See `.claude/skills/jaya-security/SKILL.md`. In short: keys write only;
every public request Twilio signed; media sockets on single-use tokens; worker
tokens hashed, expiring, revocable and limited to the claimed packet's bot;
calls and texts only to confirmed numbers inside the person's window, always
saying they are an AI, never recorded; numbers masked in logs.

## Testing

- Unit tests per module with the fake driver and the simulated harness; the
  whole loop (intake to a recorded payout) in one test.
- Route tests for every refusal of a worker token.
- A fake Twilio (signed requests, a media WebSocket client) and a fake
  Realtime server on loopback for texts and calls.
- `docs/verification/jaya.md` drives the flow against an isolated fixture.

## Decisions

- Built into a fork rather than kept as a separate app: Jaya needs the bot's
  memory, routines and turns from inside, and the app's ingress for Twilio.
- Twilio realtime media streams rather than turn-by-turn speech: natural
  back-and-forth on a phone call is the product.
- Workers get scoped tokens rather than Team Cloud seats: the server stays
  single owner.

## Pull requests

0. Fork setup and this spec.
1. Server core.
2. Owner interface.
3. Worker access and portal.
4. Texts.
5. Phone calls.
6. Verification recipe and `verify-jaya` skill.
