import { useEffect, useRef, useState } from "react";
import { Check, Circle, Clock, Mic, Send, Square, Volume2, VolumeX } from "lucide-react";

import type { Brief, EngagementView } from "../../../shared/jaya";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { speaker } from "@/lib/tts";
import { useComposerDictation } from "@/lib/use-composer-dictation";
import { formatElapsed } from "@/lib/working-time";
import { briefChecks, jayaApi, type BriefCheck } from "@/state/jaya";
import type { LocaleKey } from "@/locales";

const VOICE_KEY = "jaya-voice";
const CHECK_LABEL: Record<BriefCheck, LocaleKey> = {
  outcomes: "jaya.brief.check.outcomes", deliverables: "jaya.brief.check.deliverables", criteria: "jaya.brief.check.criteria",
  context: "jaya.brief.check.context", contact: "jaya.brief.check.contact",
};

const voiceSaved = () => { try { return localStorage.getItem(VOICE_KEY) === "on"; } catch { return false; } };
const saveVoice = (on: boolean) => { try { if (on) localStorage.setItem(VOICE_KEY, "on"); else localStorage.removeItem(VOICE_KEY); } catch { /* storage blocked */ } };

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function IntakeCall({ view, onChange, onError }: { view: EngagementView; onChange: () => Promise<void>; onError: (message: string) => void }) {
  const { engagement } = view;
  const live = engagement.status === "intake";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [voice, setVoice] = useState(voiceSaved);
  const now = useNow(live);
  const list = useRef<HTMLOListElement>(null);
  const spoken = useRef(engagement.transcript.length);
  const dictation = useComposerDictation({ draftId: `jaya-${engagement.id}`, text, onText: setText });

  const send = async () => {
    const said = text.trim();
    if (!said || busy) return;
    dictation.stop();
    setBusy(true);
    setPending(said);
    setText("");
    try {
      await jayaApi.say(engagement.id, said);
      await onChange();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      setText(said);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };
  const launch = async () => {
    setBusy(true);
    try { await jayaApi.launch(engagement.id); await onChange(); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const fresh = engagement.transcript.slice(spoken.current).filter((line) => line.role === "agent");
    spoken.current = engagement.transcript.length;
    if (voice && live) for (const line of fresh) void speaker.speak(line.text).catch(() => undefined);
  }, [engagement.transcript, voice, live]);
  useEffect(() => () => speaker.stop(), []);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [engagement.transcript.length, pending, busy]);

  const checks = briefChecks(engagement.brief);
  const done = checks.filter((check) => check.done).length;
  const lastAt = engagement.transcript.at(-1)?.at ?? engagement.createdAt;
  const elapsed = (live ? now : Date.parse(lastAt)) - Date.parse(engagement.createdAt);
  const toggleVoice = () => { const next = !voice; setVoice(next); saveVoice(next); if (!next) speaker.stop(); };
  const state = !live ? t("jaya.call.done") : busy ? t("jaya.call.thinking") : dictation.recording ? t("jaya.call.listening") : t("jaya.call.live");

  return (
    <div className="flex flex-col gap-4" data-jaya-call={engagement.status}>
      <header className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-card px-4 py-3">
        <div className="flex min-w-48 flex-1 items-center gap-3">
          <span className="relative flex size-9 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-ink" aria-hidden>
            J{live && <span className="absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" />}
          </span>
          <div className="flex flex-col">
            <h2 className="text-[15px] font-semibold text-ink">{t("jaya.call.title")}</h2>
            <span role="status" className="text-[12px] text-ink-tertiary">{state}</span>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[13px] font-medium tabular-nums text-ink-secondary"><Clock size={14} aria-hidden />{formatElapsed(elapsed)}</span>
        <div className="flex min-w-32 flex-col gap-1">
          <span className="text-[12px] text-ink-tertiary">{t("jaya.call.progress", { done, total: checks.length })}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-ink/[0.08]"><span className="block h-full rounded-full bg-success transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(done / checks.length) * 100}%` }} /></span>
        </div>
        <button type="button" className={cn("ui-icon-button", voice && "text-accent")} aria-pressed={voice} aria-label={t("jaya.call.voice")} title={t("jaya.call.voice")} onClick={toggleVoice}>
          {voice ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
        </button>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline bg-card">
          <ol ref={list} className="flex max-h-[60vh] min-h-72 flex-col gap-3 overflow-y-auto p-4">
            {engagement.transcript.map((line, index) => <Line key={index} agent={line.role === "agent"} text={line.text} at={line.at} />)}
            {pending && <Line agent={false} text={pending} faded />}
            {busy && pending && (
              <li className="flex items-end gap-2">
                <Avatar agent />
                <span className="flex gap-1 rounded-4xl rounded-es-md bg-ink/[0.06] px-4 py-3" aria-label={t("jaya.call.thinking")}>
                  {[0, 1, 2].map((dot) => <span key={dot} className="size-1.5 animate-pulse rounded-full bg-ink-tertiary motion-reduce:animate-none" style={{ animationDelay: `${dot * 150}ms` }} />)}
                </span>
              </li>
            )}
          </ol>
          {live ? (
            <div className="flex items-end gap-2 border-t border-hairline p-3">
              {dictation.ready && (
                <button type="button" className={cn("ui-icon-button size-11 shrink-0 rounded-full", dictation.recording && "bg-danger text-danger-ink")} disabled={busy}
                  aria-pressed={dictation.recording} aria-label={dictation.recording ? t("jaya.call.micStop") : t("jaya.call.mic")} title={dictation.recording ? t("jaya.call.micStop") : t("jaya.call.mic")} onClick={dictation.toggle}>
                  {dictation.recording ? <Square size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
                </button>
              )}
              <textarea dir="auto" rows={2} value={text} placeholder={t("jaya.call.placeholder")} aria-label={t("jaya.call.placeholder")}
                className="min-h-11 flex-1 resize-y rounded-lg border border-hairline bg-control px-3 py-2 text-[15px] text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-focus"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
              <button type="button" className="ui-button ui-button-md ui-button-primary shrink-0" disabled={busy || !text.trim()} onClick={() => void send()}>
                <Send size={16} aria-hidden /><span className="max-sm:hidden">{t("jaya.call.send")}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline bg-success/10 p-4">
              <div className="min-w-56 flex-1">
                <p className="text-[15px] font-medium text-ink">{t("jaya.call.ready.title")}</p>
                <p className="text-[13px] text-ink-secondary">{t("jaya.call.ready.body")}</p>
              </div>
              <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={busy} onClick={() => void launch()}>
                {busy ? t("jaya.call.ready.busy") : t("jaya.call.ready.button")}
              </button>
            </div>
          )}
          {dictation.speechError && <p role="alert" className="px-4 pb-3 text-[13px] text-danger">{dictation.speechError}</p>}
        </section>

        <BriefPanel brief={engagement.brief} checks={checks} />
      </div>
    </div>
  );
}

function Avatar({ agent }: { agent: boolean }) {
  return agent
    ? <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-ink">J</span>
    : <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-inset text-[12px] font-medium text-ink-secondary">{t("jaya.call.you")}</span>;
}

function Line({ agent, text, at, faded }: { agent: boolean; text: string; at?: string; faded?: boolean }) {
  return (
    <li className={cn("flex max-w-[88%] items-end gap-2 animate-msg-in motion-reduce:animate-none", agent ? "self-start" : "flex-row-reverse self-end", faded && "opacity-70")}>
      <Avatar agent={agent} />
      <div dir="auto" className={cn("flex flex-col gap-0.5 rounded-4xl px-4 py-2.5", agent ? "rounded-es-md bg-ink/[0.06] text-ink" : "rounded-ee-md bg-accent text-accent-ink")}>
        <p className="text-[15px] leading-[22px] whitespace-pre-wrap">{text}</p>
        {at && <time className="self-end text-[12px] opacity-70 tabular-nums">{new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>}
      </div>
    </li>
  );
}

function BriefPanel({ brief, checks }: { brief: Brief; checks: Array<{ key: BriefCheck; done: boolean }> }) {
  const chips = (label: LocaleKey, items: string[], warn = false) => items.length > 0 && (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-tertiary">{t(label)}</span>
      <div className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className={cn("ui-chip", warn && "bg-warning/10 text-warning")}>{item}</span>)}</div>
    </div>
  );
  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-hairline bg-card p-4 lg:sticky lg:top-4" aria-label={t("jaya.brief.title")}>
      <h2 className="text-[15px] font-semibold text-ink">{t("jaya.brief.title")}</h2>
      <ul className="flex flex-col gap-1.5">
        {checks.map((check) => (
          <li key={check.key} className={cn("flex items-center gap-2 text-[13px]", check.done ? "text-ink" : "text-ink-tertiary")}>
            {check.done ? <Check size={14} className="text-success" aria-hidden /> : <Circle size={14} aria-hidden />}{t(CHECK_LABEL[check.key])}
          </li>
        ))}
      </ul>
      {brief.summary ? <p className="rounded-lg bg-inset p-3 text-[13px] text-ink">{brief.summary}</p> : <p className="text-[13px] text-ink-tertiary">{t("jaya.brief.empty")}</p>}
      {brief.outcomes.map((outcome, index) => (
        <article key={`${index}-${outcome.title}`} className="flex flex-col gap-1.5 rounded-lg border border-hairline p-3 animate-fade-in motion-reduce:animate-none">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{outcome.title}</h3>
            {outcome.cadence && <span className="ui-chip shrink-0">{outcome.cadence}</span>}
          </div>
          {outcome.deliverable && <p className="text-[13px] text-ink"><span className="text-ink-tertiary">{t("jaya.brief.youGet")}</span> {outcome.deliverable}</p>}
          {outcome.deadline && <p className="text-[12px] text-ink-tertiary">{t("jaya.brief.by", { deadline: outcome.deadline })}</p>}
          {outcome.successCriteria.length > 0 && (
            <ul className="flex flex-col gap-1">
              {outcome.successCriteria.map((criterion) => <li key={criterion} className="flex items-start gap-1.5 text-[13px] text-ink"><Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />{criterion}</li>)}
            </ul>
          )}
        </article>
      ))}
      {chips("jaya.brief.context", brief.context)}
      {chips("jaya.brief.tools", brief.toolsAndAccounts)}
      {chips("jaya.brief.preferences", brief.preferences)}
      {brief.contactPreferences && chips("jaya.brief.reach", [brief.contactPreferences])}
      {chips("jaya.brief.open", brief.openQuestions, true)}
    </aside>
  );
}
