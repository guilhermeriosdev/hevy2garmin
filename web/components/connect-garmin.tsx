"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { useI18n } from "@/components/i18n-provider";

/**
 * Connect-Garmin form for the setup page. Three modes:
 *   1. email/password → POST /api/garmin-login
 *   2. two-factor code → POST /api/garmin-login-mfa (when step 1 returns needs_mfa)
 *   3. manual ticket fallback → sign in on Garmin's own widget, paste the
 *      resulting ST-… ticket, exchange it for DI tokens (at the CF Worker
 *      /exchange, or with `directLogin` at this server's
 *      /api/garmin-ticket-exchange), then POST /api/garmin-ticket. Revealed when Garmin forces a
 *      captcha (needs_captcha), or on demand via "having trouble?".
 *
 * Credentials are forwarded to the login Worker only to obtain a token and are
 * never stored or echoed back. With `directLogin` (H2G_DIRECT_GARMIN_LOGIN, #685)
 * no Worker is involved: the server signs in to Garmin itself.
 */

// The Garmin embed sign-in widget (opens in a new tab); after login the URL
// carries the ST-… ticket the user pastes back.
const GARMIN_SSO_URL =
  "https://sso.garmin.com/sso/signin?id=gauth-widget&embedWidget=true" +
  "&gauthHost=https://sso.garmin.com/sso" +
  "&service=https://sso.garmin.com/sso/embed" +
  "&source=https://sso.garmin.com/sso/embed" +
  "&redirectAfterAccountLoginUrl=https://sso.garmin.com/sso/embed" +
  "&redirectAfterAccountCreationUrl=https://sso.garmin.com/sso/embed";
// The ticket exchange on the shared Garmin SSO worker (garmin-auth's
// DEFAULT_SSO_WORKER_URL). The old hevy2garmin-exchange-di worker was deleted
// in 2026-09 (garmin-auth#47) and answers 404.
export const WORKER_EXCHANGE_URL = "https://garmin-auth-sso.gkos.workers.dev/exchange";

/** Pull the ST-… ticket out of a pasted embed URL, or accept a raw ticket. */
function extractTicket(raw: string): string | null {
  const m = raw.match(/ticket=([^&\s]+)/);
  if (m) return m[1];
  const t = raw.trim();
  return t.startsWith("ST-") ? t : null;
}

export function ConnectGarmin({ connected, directLogin = false }: { connected: boolean; directLogin?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [ticketUrl, setTicketUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  type Reply = { status?: string; error?: string; session_id?: string };

  function onSuccess() {
    setPassword("");
    setMfaCode("");
    setTicketUrl("");
    setSessionId(null);
    setManual(false);
    setOkMsg(t("cg.connectedMsg"));
    router.refresh();
  }

  async function startLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    if (!email.trim() || !password) {
      setError(t("cg.errCreds"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(withBasePath("/api/garmin-login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const d = (await res.json().catch(() => ({}))) as Reply;
      if (d.status === "connected") {
        onSuccess();
      } else if (d.status === "needs_mfa") {
        setSessionId(d.session_id ?? "");
        setError(null);
      } else if (d.status === "needs_captcha") {
        // Garmin wants a captcha the automated flow can't clear → manual ticket.
        setManual(true);
        setError(null);
      } else {
        if (d.status === "rate_limited") void recordCooldown();
        setError(d.error ?? t("common.requestFailed", { status: res.status }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!mfaCode.trim()) {
      setError(t("cg.errMfa"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(withBasePath("/api/garmin-login-mfa"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, mfa_code: mfaCode.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as Reply;
      if (d.status === "connected") onSuccess();
      else setError(d.error ?? t("common.requestFailed", { status: res.status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Best-effort record of a Garmin rate-limit cooldown. */
  async function recordCooldown() {
    try {
      await fetch(withBasePath("/api/garmin-rate-limited"), { method: "POST" });
    } catch {
      /* best-effort */
    }
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ticket = extractTicket(ticketUrl);
    if (!ticket) {
      setError(t("cg.errTicket"));
      return;
    }
    setBusy(true);
    try {
      // Exchange the ticket for DI tokens: at the CF Worker, or on this server
      // when direct login is on, so the ticket goes nowhere but Garmin.
      const ex = await fetch(directLogin ? withBasePath("/api/garmin-ticket-exchange") : WORKER_EXCHANGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const tokens = (await ex.json().catch(() => ({}))) as {
        di_token?: string;
        di_refresh_token?: string;
        di_client_id?: string;
        error?: string;
      };
      if (!ex.ok || !tokens.di_token || !tokens.di_refresh_token || !tokens.di_client_id) {
        setError(tokens.error ?? t("cg.errExchange"));
        return;
      }
      const res = await fetch(withBasePath("/api/garmin-ticket"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokens: {
            di_token: tokens.di_token,
            di_refresh_token: tokens.di_refresh_token,
            di_client_id: tokens.di_client_id,
          },
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) onSuccess();
      else setError(d.error ?? t("cg.errStore", { status: res.status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none";

  // Mode 3: manual ticket-paste fallback
  if (manual) {
    return (
      <form onSubmit={submitTicket} className="space-y-3">
        <p className="text-xs text-text-muted">
          {t("cg.manualIntro")}
        </p>
        <ol className="ml-4 list-decimal space-y-1 text-xs text-text-secondary">
          <li>
            <a href={GARMIN_SSO_URL} target="_blank" rel="noreferrer" className="text-teal underline">
              {t("cg.manualSignIn")}
            </a>{" "}
            {t("cg.manualStep1")}
          </li>
          <li>{t("cg.manualStep2")}</li>
          <li>{t("cg.manualStep3")}</li>
        </ol>
        <input
          type="text"
          value={ticketUrl}
          onChange={(e) => setTicketUrl(e.target.value)}
          placeholder="https://sso.garmin.com/sso/embed?ticket=ST-…"
          className={inputCls}
          aria-label={t("cg.ticketAria")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50"
          >
            {busy ? t("cg.connecting") : t("cg.connect")}
          </button>
          <button
            type="button"
            onClick={() => { setManual(false); setError(null); }}
            disabled={busy}
            className="text-xs text-text-muted underline hover:text-text-secondary disabled:opacity-50"
          >
            {t("cg.backToPassword")}
          </button>
          {error && <span className="text-xs text-danger" role="alert">{error}</span>}
        </div>
      </form>
    );
  }

  // Mode 2: verification code
  if (sessionId !== null) {
    return (
      <form onSubmit={submitMfa} className="space-y-3">
        <p className="text-xs text-text-muted">
          {t("cg.mfaIntro")}
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          placeholder={t("cg.mfaCode")}
          className={inputCls}
          aria-label={t("cg.mfaCode")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50">
            {busy ? t("cg.verifying") : t("cg.verify")}
          </button>
          <button type="button" onClick={() => { setSessionId(null); setMfaCode(""); setError(null); }} disabled={busy} className="text-xs text-text-muted underline hover:text-text-secondary disabled:opacity-50">
            {t("cg.startOver")}
          </button>
          {error && <span className="text-xs text-danger" role="alert">{error}</span>}
        </div>
      </form>
    );
  }

  // Mode 1: email + password
  return (
    <form onSubmit={startLogin} className="space-y-3">
      <p className="text-xs text-text-muted">
        {connected
          ? t("cg.introConnected")
          : t("cg.introNew")}
      </p>
      <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("cg.email")} className={inputCls} aria-label={t("cg.email")} />
      <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("cg.password")} className={inputCls} aria-label={t("cg.password")} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-teal/20 px-4 py-2 text-sm font-medium text-teal transition-colors hover:bg-teal/30 disabled:opacity-50">
          {busy ? t("cg.connecting") : t("cg.connectGarmin")}
        </button>
        {okMsg && <span className="text-xs text-success">{okMsg}</span>}
        {error && <span className="text-xs text-danger" role="alert">{error}</span>}
      </div>
      <p className="text-xs text-text-muted">
        {t("cg.trouble")}{" "}
        <button type="button" onClick={() => { setManual(true); setError(null); }} className="text-teal underline">
          {t("cg.troubleLink")}
        </button>
        .
      </p>
    </form>
  );
}
