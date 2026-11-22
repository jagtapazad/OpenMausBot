---
name: jaya-security
description: "Security checklist for any change to Jaya (server/jaya, src/components/jaya, Twilio, phone calls, gig worker access). Use before opening a Jaya pull request."
---

# Jaya security checklist

Read `SECURITY.md` first; everything there applies. Jaya adds people outside
the owner (the person on the phone, gig workers) and a public endpoint, so
also check each of these:

- **Secrets.** Twilio and model keys live in the app's config and are write
  only: the API reports `configured` booleans, never values. No key in a
  response, an event, a log line or a process argument.
- **Public endpoints.** Every request to `/hooks/jaya/*` carries a valid
  `X-Twilio-Signature` for its exact public URL and parameters; anything else
  is refused before it is parsed further. The media WebSocket takes a
  single-use token bound to one CallSid that expires within a minute.
- **Gig workers.** A worker token is stored only as a hash, expires and can be
  revoked. It reaches only `/api/jaya/gig/*`, and acts only on the bot of a
  packet that worker has claimed, with the timer running. A worker never sees
  another person's engagement, a key, or the owner's other bots. Each refusal
  has a test.
- **Calls and texts.** Only to numbers the person entered and confirmed, inside
  their call window and daily cap. Every call says it is an AI. Calls are not
  recorded; transcripts live only in `jaya.db`. Phone numbers are masked in
  logs.
- **Processes.** No `shell: true`, no command strings for a shell.
- **Model input.** Text from calls, texts, workers and bot replies is untrusted:
  it never chooses a route, a recipient, a phone number or a permission.
