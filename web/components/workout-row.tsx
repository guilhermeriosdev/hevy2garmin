"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { canResync, resyncOutcome, type ResyncOutcome } from "@/lib/resync-row";
import { resyncedLabel } from "@/lib/resynced";
import { useI18n } from "@/components/i18n-provider";
import { fmtDateTime } from "@/lib/i18n/format";
import type { TFunction } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

export interface WorkoutItem {
  hevy_id: string;
  title: string | null;
  when: string | null;
  /** When the row was last resynced; `when` stays the original sync (#709). */
  resynced_at?: string | null;
  garmin_activity_id: string | null;
  detail?: string | null;
  kind: "terminal" | "pending";
  state: string;
}

function fmtDate(locale: Locale, value: string | null): string {
  return fmtDateTime(locale, value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The resync text comes from lib/resync-row in English; show it in the user's language. */
function resyncText(t: TFunction, outcome: ResyncOutcome): string {
  switch (outcome.text) {
    case "Resync failed.":
      return t("wk.row.resyncFailed");
    case "Resynced from Hevy.":
      return t("wk.row.resynced");
    case "This activity is no longer on Garmin, so nothing was changed.":
      return t("wk.row.targetMissing");
  }
  const m = /^Resync did not complete \((.*)\)\.$/.exec(outcome.text);
  if (m) return t("wk.row.resyncIncomplete", { status: m[1] === "no status" ? t("wk.row.noStatus") : m[1] });
  return outcome.text;
}

function StatusPill({ item }: { item: WorkoutItem }) {
  const { t } = useI18n();
  const terminal: Record<string, { cls: string; label: string }> = {
    success: { cls: "bg-success/15 text-success", label: t("wk.statusUploaded") },
    manual: { cls: "bg-warm/15 text-warm", label: t("wk.statusManual") },
    skipped: { cls: "bg-surface-active text-text-muted", label: t("wk.statusSkipped") },
    failed: { cls: "bg-danger/15 text-danger", label: t("wk.statusFailed") },
  };
  if (item.kind === "terminal") {
    const s = terminal[item.state] ?? { cls: "bg-surface-active text-text-secondary", label: item.state };
    return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
  }
  return <span className="inline-block rounded-full bg-teal/15 px-2.5 py-0.5 text-xs font-medium text-teal">{item.state}</span>;
}

function HrChart({ samples }: { samples: number[] }) {
  const { t } = useI18n();
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const W = 600;
  const H = 120;
  const pad = 8;
  const xy = (v: number, i: number) => {
    const x = pad + (i / Math.max(1, samples.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const line = samples.map(xy).join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full rounded-lg bg-surface" style={{ height: 110 }}>
        <polygon points={area} fill="rgba(239, 68, 68, 0.12)" />
        <polyline points={line} fill="none" stroke="#ef4444" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-text-muted tabular-nums">
        <span>{t("wk.row.hrMin", { n: min })}</span>
        <span>{t("wk.row.hrAvg", { n: avg })}</span>
        <span>{t("wk.row.hrMax", { n: max })}</span>
      </div>
    </div>
  );
}

const actionBtn =
  "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50";

/**
 * A workout row with an on-demand heart-rate chart and, for in-flight (pending)
 * workouts, manual-resolution controls. The HR toggle appears only when the
 * workout is matched to a Garmin activity; expanding it fetches the cached HR
 * from /api/workout/[id]/hr (read-only) and draws an inline SVG.
 *
 * Pending rows get a "Resolve" affordance revealing "Mark as synced" (the user
 * uploaded it themselves), "Skip" (never sync this one), and "Abandon" (drop the
 * stuck in-flight attempt so it can retry). Terminal rows get an "Unsync"
 * affordance that drops the local ledger row so the workout becomes a sync
 * candidate again. All of these POST to DB-only routes (no Garmin call) and
 * refresh the list on success.
 *
 * Rows this app synced, with a Garmin activity, also get "Resync", which
 * pushes the current Hevy version into that activity in place (#701). It is the one
 * action here that writes to Garmin, so it asks first, and it reports its
 * outcome on the row: done, the activity is gone, or an error. `edited` puts
 * the "Edited in Hevy" badge beside it, and `onResyncOutcome` tells the list
 * how the resync went, so a success can take the badge away.
 */
export function WorkoutRow({
  item,
  edited = false,
  onResyncOutcome,
}: {
  item: WorkoutItem;
  edited?: boolean;
  onResyncOutcome?: (hevyId: string, outcome: ResyncOutcome) => void;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<number[] | null | undefined>(undefined); // undefined = not fetched
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [unsyncing, setUnsyncing] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [recoveryMsg, setRecoveryMsg] = useState<string | null>(null);
  const [retryConfirm, setRetryConfirm] = useState(false);
  const [resyncConfirm, setResyncConfirm] = useState(false);
  const [resyncResult, setResyncResult] = useState<ResyncOutcome | null>(null);
  const canHr = Boolean(item.garmin_activity_id);
  const canResolve = item.kind === "pending";
  const canUnsync = item.kind === "terminal";
  const resynced = resyncedLabel(item.resynced_at, (v) => fmtDate(locale, v))
    ? t("wk.resynced", { date: fmtDate(locale, new Date(item.resynced_at as string).toISOString()) })
    : null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && samples === undefined) {
      setLoading(true);
      try {
        const res = await fetch(withBasePath(`/api/workout/${encodeURIComponent(item.hevy_id)}/hr`));
        const d = (await res.json().catch(() => ({}))) as { samples?: unknown };
        setSamples(Array.isArray(d.samples) ? (d.samples as number[]) : null);
      } catch {
        setSamples(null);
      } finally {
        setLoading(false);
      }
    }
  }

  async function resolve(action: "mark-synced" | "skip") {
    setActing(true);
    setActionErr(null);
    try {
      const res = await fetch(withBasePath(`/api/workout/${encodeURIComponent(item.hevy_id)}/${action}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "resolved from web" }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setActionErr(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      // The server component re-queries; this row moves to terminal and the
      // pending banner count drops.
      setResolving(false);
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  async function abandon() {
    setActing(true);
    setActionErr(null);
    try {
      const res = await fetch(withBasePath(`/api/pending/${encodeURIComponent(item.hevy_id)}/abandon`), {
        method: "POST",
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setActionErr(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      // The pending row is dropped; the workout becomes a candidate again and
      // this row leaves the list on refresh.
      setResolving(false);
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  async function reconcile() {
    setActing(true);
    setActionErr(null);
    setRecoveryMsg(null);
    try {
      const res = await fetch(withBasePath(`/api/pending/${encodeURIComponent(item.hevy_id)}/reconcile`), {
        method: "POST",
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !d.ok) {
        setActionErr(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      if (d.status === "reconciled_synced") {
        setResolving(false);
        router.refresh(); // Garmin already had it — this row is now terminal.
      } else {
        setRecoveryMsg(t("wk.row.pendingNotYet"));
      }
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  async function retry() {
    setActing(true);
    setActionErr(null);
    setRecoveryMsg(null);
    try {
      const res = await fetch(withBasePath(`/api/pending/${encodeURIComponent(item.hevy_id)}/retry`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: item.hevy_id }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
      if (!res.ok || !d.ok) {
        setActionErr(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      setRetryConfirm(false);
      setResolving(false);
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  async function unsync() {
    setActing(true);
    setActionErr(null);
    try {
      const res = await fetch(withBasePath(`/api/unsync/${encodeURIComponent(item.hevy_id)}`), {
        method: "POST",
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setActionErr(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      // The terminal row is gone; the server re-query drops it from the list and
      // the workout becomes a sync candidate again.
      setUnsyncing(false);
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }

  async function resync() {
    setActing(true);
    setResyncResult(null);
    try {
      const res = await fetch(withBasePath(`/api/sync/${encodeURIComponent(item.hevy_id)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ live: true, resync: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { status?: unknown; error?: unknown };
      const outcome = resyncOutcome(res.ok, d);
      setResyncResult(outcome);
      onResyncOutcome?.(item.hevy_id, outcome);
      if (outcome.kind === "success") {
        setResyncConfirm(false);
        router.refresh();
      }
    } catch (err) {
      setResyncResult({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActing(false);
    }
  }

  const resyncResultCls = {
    success: "text-success",
    missing: "text-warm",
    error: "text-danger",
  } as const;

  return (
    <li className={`px-4 py-3 ${item.kind === "terminal" ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{item.title || t("wk.untitledWorkout")}</div>
          <div className="mt-0.5 text-xs text-text-muted">
            {fmtDate(locale, item.when)}
            {resynced && (
              <span className="hidden sm:inline">
                {" · "}
                <span className="whitespace-nowrap">{resynced}</span>
              </span>
            )}
            {item.garmin_activity_id && (
              <>
                {" · "}
                <a
                  href={`https://connect.garmin.com/modern/activity/${item.garmin_activity_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal underline underline-offset-2 hover:text-teal/80"
                  onClick={(e) => e.stopPropagation()}
                >
                  Garmin {item.garmin_activity_id}
                </a>
              </>
            )}
            {" · "}
            <a
              href={`https://hevy.com/workout/${item.hevy_id}`}
              target="_blank"
              rel="noreferrer"
              className="text-text-secondary underline underline-offset-2 hover:text-text"
              onClick={(e) => e.stopPropagation()}
            >
              Hevy
            </a>
            {item.detail && <span className="text-text-secondary"> · {item.detail}</span>}
          </div>
          {/* On a narrow screen the note gets its own line rather than
              lengthening the date line beside the buttons. */}
          {resynced && (
            <div className="mt-0.5 text-xs text-text-muted sm:hidden">
              <span className="whitespace-nowrap">{resynced}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canResolve && (
            <button type="button" onClick={() => setResolving((v) => !v)} className={actionBtn}>
              {resolving ? t("common.cancel") : t("wk.row.resolve")}
            </button>
          )}
          {canHr && (
            <button type="button" onClick={toggle} className={actionBtn}>
              {open ? t("wk.row.hideHr") : t("wk.row.hr")}
            </button>
          )}
          {edited && (
            <span
              className="inline-block whitespace-nowrap rounded-full bg-warm/15 px-2.5 py-0.5 text-xs font-medium text-warm"
              title={t("wk.row.editedTitle")}
            >
              {t("wk.row.edited")}
            </span>
          )}
          {canResync(item) && (
            <button
              type="button"
              onClick={() => {
                setResyncConfirm((v) => !v);
                setResyncResult(null);
              }}
              className={actionBtn}
            >
              {resyncConfirm ? t("common.cancel") : t("wk.row.resync")}
            </button>
          )}
          {canUnsync && (
            <button type="button" onClick={() => setUnsyncing((v) => !v)} className={actionBtn}>
              {unsyncing ? t("common.cancel") : t("wk.row.unsync")}
            </button>
          )}
          <StatusPill item={item} />
        </div>
      </div>

      {resyncConfirm && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-xs font-medium text-text">{t("wk.row.resyncQ")}</p>
          <p className="mt-1 text-xs text-text-muted">
            {t("wk.row.resyncBody")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resync}
              disabled={acting}
              className="rounded-lg bg-teal/20 px-3 py-1.5 text-xs font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
            >
              {acting ? t("wk.row.resyncing") : t("wk.row.resync")}
            </button>
          </div>
        </div>
      )}

      {resyncResult && (
        <p
          className={`mt-2 text-xs ${resyncResultCls[resyncResult.kind]}`}
          role={resyncResult.kind === "success" ? "status" : "alert"}
        >
          {resyncText(t, resyncResult)}
        </p>
      )}

      {unsyncing && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-text-muted">
            {t("wk.row.unsyncBody")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={unsync}
              disabled={acting}
              className="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/25 disabled:opacity-50"
            >
              {acting ? t("wk.row.working") : t("wk.row.unsync")}
            </button>
            {actionErr && (
              <span className="text-xs text-danger" role="alert">
                {actionErr}
              </span>
            )}
          </div>
        </div>
      )}

      {resolving && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-text-muted">
            {t("wk.row.resolveBody")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => resolve("mark-synced")}
              disabled={acting}
              className="rounded-lg bg-warm/20 px-3 py-1.5 text-xs font-medium text-warm transition-colors hover:bg-warm/30 disabled:opacity-50"
            >
              {acting ? t("wk.row.working") : t("wk.row.markSynced")}
            </button>
            <button
              type="button"
              onClick={() => resolve("skip")}
              disabled={acting}
              className="rounded-lg bg-surface-active px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-border disabled:opacity-50"
            >
              {t("wk.row.skip")}
            </button>
            <button
              type="button"
              onClick={abandon}
              disabled={acting}
              title={t("wk.row.abandonTitle")}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted underline-offset-2 transition-colors hover:text-text-secondary hover:underline disabled:opacity-50"
            >
              {t("wk.row.abandon")}
            </button>
            {actionErr && (
              <span className="text-xs text-danger" role="alert">
                {actionErr}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <span className="text-xs text-text-muted">{t("wk.row.recovery")}</span>
            <button
              type="button"
              onClick={reconcile}
              disabled={acting}
              title={t("wk.row.checkGarminTitle")}
              className={actionBtn}
            >
              {acting ? t("wk.row.working") : t("wk.row.checkGarmin")}
            </button>
            {!retryConfirm ? (
              <button
                type="button"
                onClick={() => setRetryConfirm(true)}
                disabled={acting}
                title={t("wk.row.retryUploadTitle")}
                className={actionBtn}
              >
                {t("wk.row.retryUpload")}
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={retry}
                  disabled={acting}
                  className="rounded-lg bg-teal/20 px-3 py-1.5 text-xs font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
                >
                  {acting ? t("wk.row.retrying") : t("wk.row.confirmReupload")}
                </button>
                <button
                  type="button"
                  onClick={() => setRetryConfirm(false)}
                  disabled={acting}
                  className={actionBtn}
                >
                  {t("common.cancel")}
                </button>
              </span>
            )}
            {recoveryMsg && (
              <span className="text-xs text-text-secondary">{recoveryMsg}</span>
            )}
          </div>
        </div>
      )}

      {open && (
        <div>
          {loading ? (
            <p className="mt-2 text-xs text-text-muted">{t("wk.row.loadingHr")}</p>
          ) : samples ? (
            <HrChart samples={samples} />
          ) : (
            <p className="mt-2 text-xs text-text-muted">{t("wk.row.noHr")}</p>
          )}
        </div>
      )}
    </li>
  );
}
