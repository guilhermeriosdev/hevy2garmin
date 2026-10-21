"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { useI18n } from "@/components/i18n-provider";
import { tryTranslate, type TFunction } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages/en";

/** Mirrors the SyncOneResult shape returned by /api/sync-one. */
interface SyncResult {
  status: "synced" | "skipped" | "deferred" | "dry_run" | "none" | "error";
  dryRun: boolean;
  wouldUpload: boolean;
  dedupDecision: string;
  workout: { hevy_id: string; title: string | null; start_time: string | null } | null;
  fitStats: {
    exercises: number;
    totalSets: number;
    calories: number;
    avgHr: number | null;
    durationS: number;
  } | null;
  existingGarminActivityId: number | null;
  garminActivityId: number | null;
  remaining: number;
  syncMethod: "upload" | "match" | null;
  error: string | null;
}

const DECISION_LABEL: Record<string, MessageKey> = {
  would_upload: "sync.decision.would_upload",
  already_synced: "sync.decision.already_synced",
  existing_garmin_activity: "sync.decision.existing_garmin_activity",
  claim_lost: "sync.decision.claim_lost",
  no_candidates: "sync.decision.no_candidates",
  no_start_time: "sync.decision.no_start_time",
};

const STATUS_STYLE: Record<string, string> = {
  synced: "bg-success/15 text-success",
  dry_run: "bg-teal/15 text-teal",
  skipped: "bg-surface-active text-text-muted",
  deferred: "bg-warm/15 text-warm",
  none: "bg-surface-active text-text-muted",
  error: "bg-danger/15 text-danger",
};

function fmtDuration(t: TFunction, s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return t("interval.minutes", { n: m });
  const h = Math.floor(m / 60);
  return t("sync.durationHM", { h, m: m % 60 });
}

/**
 * Sync controls for the dashboard.
 *
 * "Preview" runs /api/sync-one in its default DRY-RUN mode: it computes what the
 * next sync WOULD do (which workout, whether it would upload or match an
 * existing Garmin activity) without writing anything to Garmin or the DB.
 *
 * "Sync now" opts into a real upload (?live=1). Because a bad upload creates a
 * duplicate Garmin/Strava activity, it is guarded behind an explicit inline
 * confirmation, and the server independently requires authorization before it
 * will run live.
 */
export function SyncPanel({ ready }: { ready: boolean }) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "live">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  async function run(live: boolean) {
    setBusy(live ? "live" : "preview");
    setError(null);
    try {
      const res = await fetch(withBasePath(`/api/sync-one${live ? "?live=1" : ""}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(live ? { live: 1 } : {}),
      });
      const d = (await res.json().catch(() => ({}))) as SyncResult & { error?: string };
      if (!res.ok) {
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      setResult(d);
      setConfirmLive(false);
      if (live && d.status === "synced") router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-8 rounded-xl border border-border bg-surface-elevated p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">{t("sync.title")}</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {t("sync.desc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={busy !== null}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50"
          >
            {busy === "preview" ? t("sync.previewing") : t("sync.preview")}
          </button>
          {!confirmLive ? (
            <button
              type="button"
              onClick={() => setConfirmLive(true)}
              disabled={busy !== null || !ready}
              title={ready ? undefined : t("sync.connectFirst")}
              className="rounded-lg bg-teal/20 px-3 py-1.5 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
            >
              {t("sync.syncNow")}
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => run(true)}
                disabled={busy !== null}
                className="rounded-lg bg-teal/30 px-3 py-1.5 text-sm font-medium text-teal transition-colors hover:bg-teal/40 disabled:opacity-50"
              >
                {busy === "live" ? t("sync.syncing") : t("sync.confirmUpload")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmLive(false)}
                disabled={busy !== null}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
            </span>
          )}
        </div>
      </div>

      {confirmLive && (
        <p className="mt-3 rounded-lg border border-warm/40 bg-warm/10 p-3 text-xs text-warm">
          {t("sync.liveWarning")}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                STATUS_STYLE[result.status] ?? "bg-surface-active text-text-secondary"
              }`}
            >
              {result.dryRun ? t("sync.preview") : (tryTranslate(locale, `sync.status.${result.status}`) ?? result.status)}
            </span>
            <span className="text-sm text-text">
              {DECISION_LABEL[result.dedupDecision] ? t(DECISION_LABEL[result.dedupDecision]) : result.dedupDecision}
            </span>
          </div>

          {result.workout && (
            <div className="mt-3 text-sm">
              <div className="font-medium text-text">
                {result.workout.title || t("dash.untitled")}
              </div>
              {result.fitStats && (
                <div className="mt-1 text-xs text-text-muted tabular-nums">
                  {t("sync.stats", { exercises: result.fitStats.exercises, sets: result.fitStats.totalSets, kcal: result.fitStats.calories })}
                  {result.fitStats.avgHr != null && <> · {t("dash.bpmAvg", { n: result.fitStats.avgHr })}</>} ·{" "}
                  {fmtDuration(t, result.fitStats.durationS)}
                </div>
              )}
            </div>
          )}

          {(result.garminActivityId || result.existingGarminActivityId) && (
            <div className="mt-2 text-xs text-text-muted">
              {t("sync.garminActivity", { id: String(result.garminActivityId ?? result.existingGarminActivityId) })}
              {result.syncMethod === "match" && t("sync.matchedExisting")}
            </div>
          )}

          <div className="mt-2 text-xs text-text-muted">
            {t(result.remaining === 1 ? "sync.remaining.one" : "sync.remaining.other", { n: result.remaining })}
          </div>
        </div>
      )}
    </section>
  );
}
