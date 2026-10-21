"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { useI18n } from "@/components/i18n-provider";

/**
 * Sessions & Security card for the settings page. "Sign out everywhere" bumps
 * the server-side session epoch (POST /api/logout-all), which revokes every
 * outstanding cookie on all devices, then sends this device to /login. Guarded
 * by an inline confirmation.
 */
export function SessionsCard() {
  const { t } = useI18n();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/logout-all"), { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      router.push("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">{t("sessions.title")}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {t("sessions.desc")}
          </p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-active"
          >
            {t("sessions.signOutAll")}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{t("sessions.confirmQ")}</span>
            <button
              type="button"
              onClick={signOutAll}
              disabled={busy}
              className="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/25 disabled:opacity-50"
            >
              {busy ? t("sessions.signingOut") : t("sessions.confirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="text-xs text-text-muted underline"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
