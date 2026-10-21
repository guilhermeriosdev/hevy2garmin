"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { useI18n } from "@/components/i18n-provider";

/**
 * Destructive maintenance actions for the settings page.
 *
 * "Unsync all" clears every terminal synced_workouts row (DB-only — it does NOT
 * delete Garmin activities) so every workout becomes a sync candidate again. It
 * is guarded behind an inline confirmation because it affects all records.
 */
export function DangerZone({ syncedCount }: { syncedCount: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function unsyncAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/unsync-all"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; count?: number; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      setDone(d.count ?? 0);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-danger">{t("danger.title")}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {t(syncedCount === 1 ? "danger.desc.one" : "danger.desc.other", { n: syncedCount })}
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || syncedCount === 0}
            title={syncedCount === 0 ? t("danger.nothingSynced") : undefined}
            className="rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
          >
            {t("danger.unsyncAll")}
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={unsyncAll}
              disabled={busy}
              className="rounded-lg bg-danger/20 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/30 disabled:opacity-50"
            >
              {busy ? t("danger.clearing") : t("danger.confirm", { n: syncedCount })}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-active disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
          </span>
        )}
      </div>
      {done != null && (
        <p className="mt-2 text-xs text-success">{t(done === 1 ? "danger.done.one" : "danger.done.other", { n: done })}</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
