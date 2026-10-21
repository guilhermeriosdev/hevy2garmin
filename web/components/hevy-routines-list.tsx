"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { useI18n } from "@/components/i18n-provider";

interface Routine {
  id: string;
  title: string;
  exercises: number;
}

const btn =
  "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50";

function RoutineRow({ r, onGarmin }: { r: Routine; onGarmin: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<null | "sync" | "schedule">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Starts from the server's synced table, so a routine already on Garmin still
  // reads "Re-sync" after a refresh (#735). When the server's answer changes (a
  // sync elsewhere, a Remove), the row follows it.
  const [synced, setSynced] = useState(onGarmin);
  const [serverSynced, setServerSynced] = useState(onGarmin);
  if (serverSynced !== onGarmin) {
    setServerSynced(onGarmin);
    setSynced(onGarmin);
  }
  const [showSchedule, setShowSchedule] = useState(false);
  const [date, setDate] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [weekday, setWeekday] = useState(1); // Mon
  const [weeks, setWeeks] = useState("4");

  async function sync() {
    setBusy("sync");
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(withBasePath(`/api/routines/${encodeURIComponent(r.id)}/sync`), { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; status?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      setSynced(true);
      setMsg(d.status === "skipped" ? t("wk.hrl.skipped") : t("wk.hrl.synced"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError(recurring ? t("wk.hrl.pickStart") : t("wk.hrl.pickDate"));
      return;
    }
    setBusy("schedule");
    setError(null);
    setMsg(null);
    try {
      const payload = recurring
        ? { mode: "recurring", weekday, start_date: date, weeks: Number.parseInt(weeks || "1", 10) }
        : { date };
      const res = await fetch(withBasePath(`/api/routines/${encodeURIComponent(r.id)}/schedule`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; scheduled?: number; total?: number };
      if (!res.ok || !d.ok) {
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      setShowSchedule(false);
      setMsg(recurring ? t("wk.hrl.scheduledWeekly", { n: d.scheduled ?? d.total ?? "" }) : t("wk.hrl.scheduledFor", { date }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{r.title}</div>
          <div className="mt-0.5 text-xs text-text-muted">
            {t(r.exercises === 1 ? "wk.hrl.exercise.one" : "wk.hrl.exercise.other", { n: r.exercises })}
            {synced && <span className="text-success"> · {t("wk.hrl.onGarmin")}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={sync} disabled={busy !== null} className={btn}>
            {busy === "sync" ? t("wk.hrl.syncing") : synced ? t("wk.hrl.resync") : t("wk.hrl.syncToGarmin")}
          </button>
          <button
            type="button"
            onClick={() => setShowSchedule((v) => !v)}
            disabled={busy !== null}
            className={btn}
          >
            {showSchedule ? t("common.cancel") : t("wk.hrl.schedule")}
          </button>
        </div>
      </div>
      {showSchedule && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-text-muted">{recurring ? t("wk.hrl.startDate") : t("wk.hrl.date")}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text focus:border-teal focus:outline-none"
            />
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-3.5 w-3.5 accent-teal" />
              {t("wk.hrl.repeatWeekly")}
            </label>
          </div>
          {recurring && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-text-muted">{t("wk.hrl.on")}</label>
              <select
                value={weekday}
                onChange={(e) => setWeekday(Number.parseInt(e.target.value, 10))}
                aria-label={t("wk.hrl.weekday")}
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text focus:border-teal focus:outline-none"
              >
                {(["wk.hrl.wd0", "wk.hrl.wd1", "wk.hrl.wd2", "wk.hrl.wd3", "wk.hrl.wd4", "wk.hrl.wd5", "wk.hrl.wd6"] as const).map((d, i) => (
                  <option key={d} value={i}>{t(d)}</option>
                ))}
              </select>
              <label className="text-xs text-text-muted">{t("wk.hrl.for")}</label>
              <input
                type="number"
                min={1}
                max={52}
                value={weeks}
                onChange={(e) => setWeeks(e.target.value)}
                aria-label={t("wk.hrl.weeksAria")}
                className="w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text focus:border-teal focus:outline-none"
              />
              <span className="text-xs text-text-muted">{t("wk.hrl.weeks")}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={schedule}
              disabled={busy !== null}
              className="rounded-lg bg-teal/20 px-3 py-1.5 text-xs font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
            >
              {busy === "schedule" ? t("wk.hrl.scheduling") : recurring ? t("wk.hrl.addWeekly") : t("wk.hrl.addToCalendar")}
            </button>
            <span className="text-xs text-text-muted">{t("wk.hrl.syncFirst")}</span>
          </div>
        </div>
      )}
      {msg && !error && <div className="mt-1.5 text-xs text-success">{msg}</div>}
      {error && (
        <div className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </div>
      )}
    </li>
  );
}

/**
 * Your Hevy routines, with per-routine "Sync to Garmin" (create a planned
 * workout) and "Schedule" (add it to a calendar date). Fetches /api/hevy-routines
 * (read-only) on mount; degrades quietly when Hevy is unreachable.
 */
interface BulkState {
  running: boolean;
  total: number;
  synced: number;
  failed: number;
  done: boolean;
}

/** `syncedIds`: Hevy ids of the routines the synced table has on Garmin. */
export function HevyRoutinesList({ syncedIds = [] }: { syncedIds?: string[] }) {
  const { t } = useI18n();
  const onGarmin = new Set(syncedIds);
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [note, setNote] = useState<string | null>(null);
  // A demo is not a failure, so it must not be phrased as one (#634).
  const [demo, setDemo] = useState(false);
  const [query, setQuery] = useState("");
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(withBasePath("/api/hevy-routines"))
      .then((res) => res.json())
      .then((d: { routines?: Routine[]; error?: string; demo?: boolean }) => {
        if (!alive) return;
        setRoutines(Array.isArray(d.routines) ? d.routines : []);
        if (d.demo) setDemo(true);
        if (d.error) setNote(d.error);
        setPhase("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setNote(err instanceof Error ? err.message : String(err));
        setPhase("ready");
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = query.trim()
    ? routines.filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()))
    : routines;

  // Sync every (filtered) routine to Garmin, one at a time, with live progress.
  // Each iteration is a real Garmin planned-workout write, so it's confirmed first.
  async function syncAll() {
    setConfirmAll(false);
    const list = filtered;
    if (list.length === 0) return;
    stopRef.current = false;
    let synced = 0;
    let failed = 0;
    setBulk({ running: true, total: list.length, synced, failed, done: false });
    for (const r of list) {
      if (stopRef.current) break;
      try {
        const res = await fetch(withBasePath(`/api/routines/${encodeURIComponent(r.id)}/sync`), { method: "POST" });
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (res.ok && d.ok) synced += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      setBulk({ running: true, total: list.length, synced, failed, done: false });
    }
    setBulk({ running: false, total: list.length, synced, failed, done: true });
    router.refresh();
  }

  const bulkPct = bulk && bulk.total ? Math.round(((bulk.synced + bulk.failed) / bulk.total) * 100) : 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">{t("wk.hrl.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {routines.length > 0 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("wk.hrl.searchPlaceholder")}
              aria-label={t("wk.hrl.searchAria")}
              className="w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none"
            />
          )}
          {routines.length > 0 &&
            (bulk?.running ? (
              <button
                type="button"
                onClick={() => { stopRef.current = true; }}
                className="rounded-lg border border-warm/50 px-3 py-2 text-xs font-medium text-warm hover:bg-warm/15"
              >
                {t("wk.hrl.stop")}
              </button>
            ) : !confirmAll ? (
              <button
                type="button"
                onClick={() => setConfirmAll(true)}
                className="rounded-lg bg-teal/20 px-3 py-2 text-xs font-medium text-teal hover:bg-teal/30"
              >
                {t("wk.hrl.syncAll")}
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t("wk.hrl.syncNQ", { n: filtered.length })}</span>
                <button type="button" onClick={syncAll} className="rounded-lg bg-teal px-3 py-2 text-xs font-medium text-black">
                  {t("wk.hrl.start")}
                </button>
                <button type="button" onClick={() => setConfirmAll(false)} className="text-xs text-text-muted underline">
                  {t("common.cancel")}
                </button>
              </span>
            ))}
        </div>
      </div>

      {bulk && (
        <div className="mb-3" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-active">
            <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${bulkPct}%` }} role="progressbar" aria-valuenow={bulkPct} aria-valuemin={0} aria-valuemax={100} />
          </div>
          <p className="mt-1.5 text-xs text-text-secondary tabular-nums">
            {bulk.done ? t("wk.hrl.done") : t("wk.hrl.syncingDash")}
            <span className="text-success">{t("wk.hrl.nSynced", { n: bulk.synced })}</span>
            {bulk.failed > 0 && <span className="text-danger"> · {t("wk.hrl.nFailed", { n: bulk.failed })}</span>}
            {t("wk.hrl.of")}
            {bulk.total}
          </p>
        </div>
      )}
      {phase === "loading" ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          {t("wk.hrl.loading")}
        </div>
      ) : routines.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          {demo
            ? t("wk.hrl.demo")
            : note
              ? t("wk.hrl.loadFailed", { note })
              : t("wk.hrl.none")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-text-muted">
          {t("wk.hrl.noMatch", { query })}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {filtered.map((r) => (
              <RoutineRow key={r.id} r={r} onGarmin={onGarmin.has(String(r.id))} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted tabular-nums">
            {t(routines.length === 1 ? "wk.hrl.countOf.one" : "wk.hrl.countOf.other", { shown: filtered.length, total: routines.length })}
          </p>
        </>
      )}
    </section>
  );
}
