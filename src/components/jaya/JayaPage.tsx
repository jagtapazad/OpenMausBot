import { useCallback, useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";

import type { Attempt, CheckIn, EngagementView, Outcome } from "../../../shared/jaya";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { jayaApi } from "@/state/jaya";
import { useStore } from "@/state/store";
import { TOOL_PAGE_TITLE, ToolPage, ToolPageActions, ToolPageHeader } from "../ToolPageShell";
import { IntakeCall } from "./IntakeCall";

const STATUS: Record<Outcome["status"], { key: LocaleKey; tone: string }> = {
  working: { key: "jaya.status.working", tone: "text-ink-secondary" },
  "needs-input": { key: "jaya.status.needsInput", tone: "bg-warning/10 text-warning" },
  "in-review": { key: "jaya.status.inReview", tone: "bg-warning/10 text-warning" },
  accepted: { key: "jaya.status.accepted", tone: "bg-success/10 text-success" },
  escalated: { key: "jaya.status.escalated", tone: "bg-accent/10 text-accent-text" },
};
const POLL_MS = 5000;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function JayaPage() {
  const { dispatch } = useStore();
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<EngagementView | null>(null);
  const [error, setError] = useState("");
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    jayaApi.engagements().then((list) => setId(list[0]?.id ?? null)).catch(() => setError(t("jaya.loadFailed")));
  }, []);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try { setView(await jayaApi.view(id)); setError(""); }
    catch { setError(t("jaya.loadFailed")); }
  }, [id]);
  useEffect(() => { setView(null); void load(); }, [load]);
  const running = view?.engagement.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const start = async (phone: string) => {
    try { setId((await jayaApi.start(phone.trim() || null)).id); }
    catch (cause) { setError(messageOf(cause)); }
  };

  return (
    <ToolPage label={t("jaya.title")}>
      <ToolPageHeader backLabel={t("automations.back")} onBack={() => dispatch({ type: "showChat" })} backRef={back}>
        <h1 className={TOOL_PAGE_TITLE}>{view?.engagement.plan?.teamName ?? t("jaya.title")}</h1>
        {view && view.engagement.status !== "intake" && (
          <ToolPageActions>
            {running && <button type="button" className="ui-button" onClick={() => void jayaApi.refresh(view.engagement.id).then(load).catch((cause) => setError(messageOf(cause)))}>{t("jaya.team.refresh")}</button>}
            <button type="button" className="ui-button" onClick={() => { setId(null); setView(null); }}>{t("jaya.team.new")}</button>
          </ToolPageActions>
        )}
      </ToolPageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" data-jaya={view?.engagement.status ?? (id === null ? "start" : "loading")}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          {id === null ? <Start onStart={start} />
            : view && (view.engagement.status === "intake" || view.engagement.status === "planning")
              ? <IntakeCall view={view} onChange={load} onError={setError} />
              : view ? <Dashboard view={view} onChange={load} onError={setError} /> : null}
        </div>
      </div>
    </ToolPage>
  );
}

function Start({ onStart }: { onStart: (phone: string) => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [starting, setStarting] = useState(false);
  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 py-10">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-accent text-[20px] font-semibold text-accent-ink">J</span>
      <h2 className="text-[20px] font-semibold text-ink">{t("jaya.start.title")}</h2>
      <p className="text-[13px] leading-[18px] text-ink-secondary">{t("jaya.start.body")}</p>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-secondary">
        {t("jaya.start.phone")}
        <input type="tel" dir="auto" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 555 010 0100"
          className="h-9 rounded-lg border border-hairline bg-control px-3 text-[15px] font-normal text-ink focus-visible:outline-2 focus-visible:outline-focus" />
      </label>
      <button type="button" className="ui-button ui-button-lg ui-button-primary" disabled={starting}
        onClick={() => { setStarting(true); void onStart(phone).finally(() => setStarting(false)); }}>
        <Phone size={16} aria-hidden />{starting ? t("jaya.start.connecting") : t("jaya.start.button")}
      </button>
    </section>
  );
}

function Dashboard({ view, onChange, onError }: { view: EngagementView; onChange: () => Promise<void>; onError: (message: string) => void }) {
  const { outcomes, attempts, checkins, actions } = view;
  const open = checkins.find((checkIn) => checkIn.status === "sent");
  const pending = attempts.filter((attempt) => attempt.verdict === "pending");
  return (
    <>
      {open && <CheckInCard checkIn={open} onDone={onChange} onError={onError} />}
      {pending.map((attempt) => {
        const outcome = outcomes.find((row) => row.id === attempt.outcomeId);
        return outcome ? <ReviewCard key={attempt.id} attempt={attempt} outcome={outcome} onDone={onChange} onError={onError} /> : null;
      })}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3">
        {outcomes.map((outcome) => (
          <li key={outcome.id} className="flex flex-col gap-1.5 rounded-xl border border-hairline bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-ink">{outcome.spec.title}</h3>
              <span className={cn("ui-chip shrink-0", STATUS[outcome.status].tone)}>{t(STATUS[outcome.status].key)}</span>
            </div>
            <p className="text-[12px] text-ink-tertiary">{t("jaya.outcome.bot", { name: outcome.agentId, cadence: outcome.spec.cadence })}</p>
            <p className="text-[13px] text-ink">{outcome.spec.deliverable}</p>
            {outcome.rejections > 0 && <p className="text-[12px] text-ink-tertiary">{t("jaya.outcome.sentBack", { count: outcome.rejections })}</p>}
          </li>
        ))}
      </ul>
      {actions.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-hairline bg-card p-4">
          <h2 className="text-[15px] font-semibold text-ink">{t("jaya.changes.title")}</h2>
          <ul className="flex flex-col gap-1.5">
            {actions.map((action) => <li key={action.id} className="text-[13px] text-ink"><span className="ui-chip me-2">{action.kind}</span>{action.detail.slice(0, 200)}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

function CheckInCard({ checkIn, onDone, onError }: { checkIn: CheckIn; onDone: () => Promise<void>; onError: (message: string) => void }) {
  const [replies, setReplies] = useState<Record<string, string>>({});
  const send = async () => {
    try { await jayaApi.answer(checkIn.id, replies); setReplies({}); await onDone(); }
    catch (cause) { onError(messageOf(cause)); }
  };
  return (
    <section aria-label={t("jaya.checkin.title")} className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-4">
      <h2 className="text-[15px] font-semibold text-ink">{t("jaya.checkin.title")}</h2>
      <p className="text-[13px] text-ink">{checkIn.intro}{checkIn.channel === "sms" && <span className="text-ink-tertiary"> {t("jaya.checkin.sms")}</span>}</p>
      {checkIn.questions.filter((question) => !question.reply).map((question) => (
        <label key={question.id} className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
          {question.text}
          <input dir="auto" value={replies[question.id] ?? ""} onChange={(event) => setReplies({ ...replies, [question.id]: event.target.value })}
            className="h-9 rounded-lg border border-hairline bg-control px-3 text-[15px] font-normal text-ink focus-visible:outline-2 focus-visible:outline-focus" />
        </label>
      ))}
      <button type="button" className="ui-button ui-button-primary self-start" disabled={!Object.values(replies).some((reply) => reply.trim())} onClick={() => void send()}>{t("jaya.checkin.send")}</button>
    </section>
  );
}

function ReviewCard({ attempt, outcome, onDone, onError }: { attempt: Attempt; outcome: Outcome; onDone: () => Promise<void>; onError: (message: string) => void }) {
  const [feedback, setFeedback] = useState("");
  const decide = async (verdict: "accepted" | "rejected") => {
    try { await jayaApi.review(attempt.id, verdict, feedback.trim() || null); await onDone(); }
    catch (cause) { onError(messageOf(cause)); }
  };
  return (
    <section aria-label={t("jaya.review.title", { title: outcome.spec.title })} className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">{t("jaya.review.title", { title: outcome.spec.title })}</h2>
        {attempt.by === "worker" && <span className="ui-chip bg-accent/10 text-accent-text">{t("jaya.review.fromSpecialist")}</span>}
      </div>
      <pre dir="auto" className="rounded-lg bg-inset p-3 font-sans text-[13px] whitespace-pre-wrap text-ink">{attempt.deliverable}</pre>
      <ul className="flex flex-col gap-1">{outcome.spec.successCriteria.map((criterion) => <li key={criterion} className="text-[13px] text-ink-secondary">{criterion}</li>)}</ul>
      <textarea dir="auto" rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={t("jaya.review.feedback")} aria-label={t("jaya.review.feedback")}
        className="rounded-lg border border-hairline bg-control px-3 py-2 text-[15px] text-ink placeholder:text-ink-tertiary focus-visible:outline-2 focus-visible:outline-focus" />
      <div className="flex gap-2">
        <button type="button" className="ui-button ui-button-primary" onClick={() => void decide("accepted")}>{t("jaya.review.accept")}</button>
        <button type="button" className="ui-button" disabled={!feedback.trim()} onClick={() => void decide("rejected")}>{t("jaya.review.reject")}</button>
      </div>
    </section>
  );
}
