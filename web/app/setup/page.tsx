import { getDb } from "@/lib/db";
import { authEnabled, productionRuntime } from "@/lib/auth";
import { loadGarminConnection, loadHevyConnection, type Connection } from "@/lib/connections";
import { ConnectHevy } from "@/components/connect-hevy";
import { ConnectGarmin } from "@/components/connect-garmin";
import { directGarminLogin } from "@/lib/direct-login-flag";
import { SetupTimezone } from "@/components/setup-timezone";
import { fmtDateTime } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

// Queries the live hevy2garmin Postgres per request — never at build time.
export const dynamic = "force-dynamic";

interface SetupData {
  dbConfigured: boolean;
  hevy: Connection;
  garmin: Connection;
  /** user_profile.timezone, or null when nothing has been chosen yet (#639). */
  timezone: string | null;
}

const NONE: Connection = { connected: false, connectedAt: null };
const EMPTY: SetupData = { dbConfigured: false, hevy: NONE, garmin: NONE, timezone: null };

async function loadSetup(): Promise<SetupData> {
  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return EMPTY;
  }
  const [hevy, garmin, profile] = await Promise.all([
    loadHevyConnection(sql),
    loadGarminConnection(sql),
    sql`SELECT value FROM app_cache WHERE key = 'user_profile' LIMIT 1`.catch(
      () => [] as Array<{ value: unknown }>,
    ),
  ]);
  const raw = profile[0]?.value;
  const tz =
    raw && typeof raw === "object" && typeof (raw as { timezone?: unknown }).timezone === "string"
      ? ((raw as { timezone: string }).timezone.trim() || null)
      : null;
  return { dbConfigured: true, hevy, garmin, timezone: tz };
}

function fmtDate(locale: Locale, value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return fmtDateTime(locale, value, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * `labels` exists because a timezone is not a connection (#639). Reusing this
 * dot unchanged put "Not connected" under the Timezone heading, which reads as
 * a broken integration rather than a field nobody has filled in yet.
 */
function StatusDot({
  connected,
  labels,
  tone = "bg-danger",
}: {
  connected: boolean;
  labels: [string, string];
  /** A missing timezone is not a failure, so it should not be red like one. */
  tone?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? "bg-success" : tone}`}
        aria-hidden
      />
      <span className={`text-xs ${connected ? "text-success" : "text-text-muted"}`}>
        {connected ? labels[0] : labels[1]}
      </span>
    </span>
  );
}

/* A production deploy with no password: the proxy serves only this page and the login page
   (#550), so the connect forms would only fail. Say what to do instead. */
async function SetPasswordFirst() {
  const { t } = await getT();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">{t("setup.pw.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t("setup.pw.intro")}
        </p>
      </header>
      <section
        data-testid="set-password-first"
        className="rounded-xl border border-warm/40 bg-warm/10 p-5 text-sm text-text"
      >
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            {t("setup.pw.s1a")} <strong>Settings</strong> {t("setup.pw.s1b")}{" "}
            <strong>Environment Variables</strong>.
          </li>
          <li>
            {t("setup.pw.s2a")} <code className="rounded bg-surface px-1">H2G_PASSWORD</code> {t("setup.pw.s2b")}{" "}
            <code className="rounded bg-surface px-1">HEVY2GARMIN_SECRET</code> {t("setup.pw.s2c")}
          </li>
          <li>{t("setup.pw.s3")}</li>
        </ol>
        <p className="mt-4 text-xs text-text-muted">
          {t("setup.pw.selfA")} <code className="rounded bg-surface px-1">next start</code>{t("setup.pw.selfB")}
        </p>
      </section>
    </main>
  );
}

export default async function SetupPage() {
  if (productionRuntime() && !authEnabled()) return <SetPasswordFirst />;
  const data = await loadSetup();
  const { t, locale } = await getT();
  const connLabels: [string, string] = [t("setup.connected"), t("setup.notConnected")];
  const hevyConnected = data.hevy.connected;
  const garminConnected = data.garmin.connected;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">{t("setup.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t("setup.intro")}
        </p>
      </header>

      {!data.dbConfigured && (
        <div className="mb-6 rounded-lg border border-warm/40 bg-warm/10 p-4 text-sm text-warm">
          {t("setup.noDb")}
        </div>
      )}

      {/* Hevy */}
      <section className="mb-6 rounded-xl border border-border bg-surface-elevated p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Hevy</h2>
          <StatusDot connected={hevyConnected} labels={connLabels} />
        </div>
        {hevyConnected && data.hevy.connectedAt && (
          <p className="mb-3 text-xs text-text-muted">
            {t("setup.connectedOn", { date: fmtDate(locale, data.hevy.connectedAt) })}
          </p>
        )}
        <ConnectHevy connected={hevyConnected} />
      </section>

      {/* Garmin */}
      <section className="rounded-xl border border-border bg-surface-elevated p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Garmin Connect</h2>
          <StatusDot connected={garminConnected} labels={connLabels} />
        </div>
        {garminConnected && data.garmin.connectedAt && (
          <p className="mb-3 text-xs text-text-muted">
            {t("setup.connectedOn", { date: fmtDate(locale, data.garmin.connectedAt) })}
          </p>
        )}
        <ConnectGarmin connected={garminConnected} directLogin={directGarminLogin()} />
      </section>

      {/* Timezone (#639). Last, because it only matters once something can sync,
          and first-time users should not meet a text field before the two
          connections that actually gate everything. */}
      <section className="mt-6 rounded-xl border border-border bg-surface-elevated p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">{t("setup.timezone")}</h2>
          <StatusDot connected={data.timezone !== null} labels={[t("setup.set"), t("setup.notSet")]} tone="bg-text-muted" />
        </div>
        <SetupTimezone current={data.timezone} />
      </section>
    </main>
  );
}
