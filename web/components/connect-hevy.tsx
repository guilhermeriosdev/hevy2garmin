"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { useI18n } from "@/components/i18n-provider";

/**
 * Connect-Hevy form for the setup page. Sends the entered API key to
 * /api/connect-hevy, which validates it against Hevy (read-only) and, only if
 * valid, stores it. The key is never echoed back — on success the field clears.
 */
export function ConnectHevy({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    const trimmed = key.trim();
    if (!trimmed) {
      setError(t("hevy.enterKey"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(withBasePath("/api/connect-hevy"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        valid?: boolean;
        workout_count?: number;
        error?: string;
      };
      if (!res.ok || !d.ok) {
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
        return;
      }
      setKey("");
      setOkMsg(t(d.workout_count === 1 ? "hevy.connected.one" : "hevy.connected.other", { n: d.workout_count ?? 0 }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-text-muted">
        {connected ? t("hevy.helpConnected") : t("hevy.helpNew")}
      </p>
      <input
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={t("hevy.placeholder")}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
        >
          {busy ? t("hevy.validating") : t("hevy.validate")}
        </button>
        {okMsg && <span className="text-xs text-success">{okMsg}</span>}
        {error && (
          <span className="text-xs text-danger" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
