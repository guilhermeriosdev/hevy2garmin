import Link from "next/link";
import { getDb } from "@/lib/db";
import { resyncedLabel } from "@/lib/resynced";
import { getT } from "@/lib/i18n/server";
import { fmtDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFunction } from "@/lib/i18n/translate";

// Queries the live hevy2garmin Postgres per request — never at build time.
export const dynamic = "force-dynamic";

interface HistoryRow {
  hevy_id: string;
  title: string;
  synced_at: string | null;
  // Set when a resync rewrote the row; synced_at stays the original (#709).
  resynced_at: string | null;
  calories: number | null;
  avg_hr: number | null;
  garmin_activity_id: string | null;
  status: string;
}

interface HistoryData {
  dbConfigured: boolean;
  total: number;
  rows: HistoryRow[];
}

const EMPTY: HistoryData = { dbConfigured: false, total: 0, rows: [] };
const LIMIT = 100;

async function loadHistory(): Promise<HistoryData> {
  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return EMPTY;
  }

  const [counts, rows] = await Promise.all([
    sql`SELECT count(*)::int AS total FROM synced_workouts`.catch(
      () => [] as Array<{ total: number }>,
    ),
    sql`
      SELECT hevy_id, title, synced_at, resynced_at, calories, avg_hr,
             garmin_activity_id, COALESCE(status, 'success') AS status
      FROM synced_workouts
      ORDER BY synced_at DESC
      LIMIT ${LIMIT}
    `.catch(() => [] as HistoryRow[]),
  ]);

  return {
    dbConfigured: true,
    total: counts[0]?.total ?? 0,
    rows: rows.map((r) => ({
      hevy_id: r.hevy_id,
      title: r.title ?? "",
      synced_at: r.synced_at ?? null,
      resynced_at: r.resynced_at ?? null,
      calories: r.calories != null ? Number(r.calories) : null,
      avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
      garmin_activity_id: r.garmin_activity_id ?? null,
      status: r.status,
    })),
  };
}

function fmtDate(locale: Locale, value: string | null): string {
  return fmtDateTime(locale, value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** When a resync last rewrote the row, on its own line under the sync date. */
function ResyncedNote({ at, t, locale }: { at: string | null; t: TFunction; locale: Locale }) {
  if (!resyncedLabel(at, (v) => fmtDate(locale, v))) return null;
  return <div className="text-xs">{t("wk.resynced", { date: fmtDate(locale, new Date(at as string).toISOString()) })}</div>;
}

function statusLabel(t: TFunction, status: string): string {
  if (status === "manual") return t("wk.statusManual");
  if (status === "skipped") return t("wk.statusSkipped");
  return t("wk.statusUploaded");
}

function StatusPill({ status, t }: { status: string; t: TFunction }) {
  const styles: Record<string, string> = {
    success: "bg-success/15 text-success",
    manual: "bg-warm/15 text-warm",
    skipped: "bg-surface-active text-text-muted",
    failed: "bg-danger/15 text-danger",
  };
  const cls = styles[status] ?? "bg-surface-active text-text-secondary";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {statusLabel(t, status)}
    </span>
  );
}

export default async function HistoryPage() {
  const { t, locale } = await getT();
  const data = await loadHistory();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-text">{t("wk.hist.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t(data.total === 1 ? "wk.hist.count.one" : "wk.hist.count.other", { n: data.total })}
          {data.total > LIMIT && <span> · {t("wk.hist.showing", { limit: LIMIT })}</span>}
        </p>
      </header>

      {!data.dbConfigured && (
        <div className="mb-6 rounded-lg border border-warm/40 bg-warm/10 p-4 text-sm text-warm">
          {t("wk.noDb")}
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-3 text-text-muted"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <p className="text-sm font-medium text-text-secondary">
            {t("wk.hist.empty")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("wk.hist.goTo", { link: "\u0000" })
              .split("\u0000")
              .flatMap((part, i) =>
                i === 0
                  ? [part]
                  : [
                      <Link key="l" href="/workouts" className="text-teal underline">
                        {t("nav.workouts")}
                      </Link>,
                      part,
                    ],
              )}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface-elevated">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2 font-medium">{t("wk.hist.colSynced")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.hist.colTitle")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("wk.hist.colCalories")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("wk.hist.colAvgHr")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.hist.colGarminId")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.hist.colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.hevy_id}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-text-muted">
                    {fmtDate(locale, r.synced_at)}
                    <ResyncedNote at={r.resynced_at} t={t} locale={locale} />
                  </td>
                  <td className="px-4 py-2 font-medium text-text">
                    {r.title || t("wk.untitledWorkout")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                    {r.calories ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                    {r.avg_hr ?? "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-text-muted">
                    {r.garmin_activity_id ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
