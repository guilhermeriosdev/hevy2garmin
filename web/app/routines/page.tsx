import { getDb } from "@/lib/db";
import { HevyRoutinesList } from "@/components/hevy-routines-list";
import { RoutineSchedules } from "@/components/routine-schedules";
import { RoutineRemove } from "@/components/routine-remove";
import { getT } from "@/lib/i18n/server";
import { fmtDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { TFunction } from "@/lib/i18n/translate";

// Queries the live hevy2garmin Postgres per request — never at build time.
export const dynamic = "force-dynamic";

interface RoutineRow {
  hevy_routine_id: string;
  title: string;
  status: string;
  garmin_workout_id: string | null;
  scheduled_date: string | null;
  synced_at: string | null;
  schedules: Array<{ scheduleId: string; date: string }>;
  schedule_count: number;
}

interface RoutinesData {
  dbConfigured: boolean;
  total: number;
  scheduled: number;
  rows: RoutineRow[];
}

const EMPTY: RoutinesData = { dbConfigured: false, total: 0, scheduled: 0, rows: [] };
const LIMIT = 100;

async function loadRoutines(): Promise<RoutinesData> {
  let sql: ReturnType<typeof getDb>;
  try {
    sql = getDb();
  } catch {
    return EMPTY;
  }

  const [rows, scheduleEntries] = await Promise.all([
    sql`
      SELECT hevy_routine_id, title, COALESCE(status, 'success') AS status,
             garmin_workout_id, scheduled_date, synced_at
      FROM synced_routines
      ORDER BY synced_at DESC NULLS LAST
      LIMIT ${LIMIT}
    `.catch(
      () =>
        [] as Array<{
          hevy_routine_id: string;
          title: string | null;
          status: string;
          garmin_workout_id: string | null;
          scheduled_date: string | null;
          synced_at: string | null;
        }>,
    ),
    sql`
      SELECT hevy_routine_id, schedule_id, scheduled_date
      FROM routine_schedules
      ORDER BY scheduled_date ASC
    `.catch(
      () => [] as Array<{ hevy_routine_id: string; schedule_id: string; scheduled_date: string | null }>,
    ),
  ]);

  const schedules = new Map<string, Array<{ scheduleId: string; date: string }>>();
  for (const e of scheduleEntries) {
    const list = schedules.get(e.hevy_routine_id) ?? [];
    list.push({ scheduleId: String(e.schedule_id), date: e.scheduled_date ?? "" });
    schedules.set(e.hevy_routine_id, list);
  }

  const mapped: RoutineRow[] = rows.map((r) => ({
    hevy_routine_id: r.hevy_routine_id,
    title: r.title ?? "",
    status: r.status,
    garmin_workout_id: r.garmin_workout_id ?? null,
    scheduled_date: r.scheduled_date ?? null,
    synced_at: r.synced_at ?? null,
    schedules: schedules.get(r.hevy_routine_id) ?? [],
    schedule_count: (schedules.get(r.hevy_routine_id) ?? []).length,
  }));

  return {
    dbConfigured: true,
    total: mapped.length,
    scheduled: mapped.filter((r) => r.schedule_count > 0).length,
    rows: mapped,
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


function StatusPill({ status, t }: { status: string; t: TFunction }) {
  const map: Record<string, { cls: string; label: string }> = {
    success: { cls: "bg-success/15 text-success", label: t("wk.statusSynced") },
    failed: { cls: "bg-danger/15 text-danger", label: t("wk.statusFailed") },
    skipped: { cls: "bg-surface-active text-text-muted", label: t("wk.statusSkipped") },
  };
  const s = map[status] ?? { cls: "bg-surface-active text-text-secondary", label: status };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="text-2xl font-bold tabular-nums text-text">{value}</div>
      <div className="mt-0.5 text-xs text-text-muted">{label}</div>
    </div>
  );
}

export default async function RoutinesPage() {
  const { t, locale } = await getT();
  const data = await loadRoutines();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-text">{t("wk.rt.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t("wk.rt.subtitle")}
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
        {t("wk.rt.help")}
      </div>

      {data.dbConfigured && (
        <HevyRoutinesList
          syncedIds={data.rows.filter((r) => r.status !== "missing_on_garmin").map((r) => r.hevy_routine_id)}
        />
      )}

      {!data.dbConfigured && (
        <div className="mb-6 rounded-lg border border-warm/40 bg-warm/10 p-4 text-sm text-warm">
          {t("wk.noDb")}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4">
        <StatCard label={t("wk.rt.statSynced")} value={data.total} />
        <StatCard label={t("wk.rt.statScheduled")} value={data.scheduled} />
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm font-medium text-text-secondary">
            {t("wk.rt.empty")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("wk.rt.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface-elevated">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2 font-medium">{t("wk.rt.colRoutine")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.rt.colStatus")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.rt.colGarminWorkout")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.rt.colScheduled")}</th>
                <th className="px-4 py-2 font-medium">{t("wk.rt.colSynced")}</th>
                {/* Labelled for screen readers without an sr-only span: that is absolutely
                    positioned, escapes the table's scroll box and widened the whole page. */}
                <th className="px-4 py-2 font-medium" aria-label={t("wk.rt.remove")} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.hevy_routine_id}>
                  <td className="px-4 py-2 font-medium text-text">
                    {r.title || t("wk.rt.untitled")}
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} t={t} />
                  </td>
                  <td className="px-4 py-2 tabular-nums text-text-secondary">
                    {r.garmin_workout_id || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <RoutineSchedules hevyRoutineId={r.hevy_routine_id} entries={r.schedules} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-text-muted">
                    {fmtDate(locale, r.synced_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <RoutineRemove hevyRoutineId={r.hevy_routine_id} title={r.title || t("wk.rt.thisRoutine")} />
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
