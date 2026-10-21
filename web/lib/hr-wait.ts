/**
 * Wait for heart rate before an unattended upload.
 *
 * Garmin forwards an upload to Strava at once, and Strava keeps the first copy it receives, so a
 * workout uploaded before the watch has synced its heart rate reaches Strava without HR for good.
 * The engine looks for HR, asks twice, and uploads anyway when there is none.
 *
 * This runs BEFORE the engine, only for unattended runs (cron, webhook): it works out which
 * workout the engine would take next, looks for HR the way the engine does, and when there is none
 * for a workout that ended recently it answers `deferred` itself. Nothing is claimed, uploaded or
 * written, so the workout stays a candidate and the next run asks again. After `hrWaitMinutes`
 * it steps aside and the workout uploads without HR, as before.
 *
 * The same rule lives in the engine (typescript/src/sync/sync-one.ts) for when the pinned
 * `hevy2garmin` release includes it; until then this is what makes it true on a deployed web app.
 */
import {
  checkGracePeriod,
  dailyHrToPoints,
  DEFAULT_GRACE_MINUTES,
  filterUnsynced,
  hrForSync,
  workoutAgeMinutes,
  type DedupDecision,
  type HrDeps,
  type SyncDeps,
  type SyncOneResult,
} from "hevy2garmin";

/** Twelve hours covers a watch that syncs late in the day. 0 turns the wait off. */
export const DEFAULT_HR_WAIT_MINUTES = 720;

export interface HrWaitInput {
  dryRun?: boolean;
  respectGrace?: boolean;
  graceMinutes?: number;
  hrFusion: boolean;
  hrWaitMinutes: number;
  targetHevyId?: string;
  targetActivityId?: number;
  mergeOnly?: boolean;
}

/** The wait, from `H2G_HR_WAIT_MINUTES` when set to a number, else the default. */
export function hrWaitMinutesFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.H2G_HR_WAIT_MINUTES;
  if (raw == null || raw.trim() === "") return DEFAULT_HR_WAIT_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HR_WAIT_MINUTES;
}

/**
 * A `deferred` result when the next workout should wait for its heart rate, else null (go ahead).
 * Never throws: any trouble looking means "do not hold the workout back".
 */
export async function deferForHr(deps: SyncDeps, o: HrWaitInput): Promise<SyncOneResult | null> {
  // Only an unattended, live upload that would carry HR. A person pressing Sync Now has decided
  // they want it now; merge-only never uploads; a resync never uploads either.
  if (o.dryRun !== false || !o.respectGrace || !o.hrFusion || o.hrWaitMinutes <= 0) return null;
  if (o.mergeOnly || o.targetActivityId != null) return null;

  try {
    const workouts = await deps.fetchWorkouts();
    const [synced, pending] = await Promise.all([deps.store.loadSyncedIds(), deps.store.loadPendingIds()]);
    const candidates = filterUnsynced(workouts, synced, pending);
    const picked = o.targetHevyId
      ? candidates.find((c) => String(c.id) === o.targetHevyId)
      : candidates[0];
    if (!picked) return null;

    // Inside the watch grace the engine defers on its own; past the wait the workout goes up as is.
    const grace = o.graceMinutes ?? DEFAULT_GRACE_MINUTES;
    if (checkGracePeriod(picked, grace).withinGrace) return null;
    const age = workoutAgeMinutes(picked);
    if (age === null || age >= o.hrWaitMinutes) return null;

    const gateway = await deps.gateway();
    // Read the sources only: the engine does its own backup and cache writes when it runs.
    const { saveBackup: _b, saveCache: _c, ...readers } = (deps.hr ?? {}) as HrDeps;
    const sources: HrDeps = {
      ...readers,
      fetchActivityFit:
        readers.fetchActivityFit ??
        (gateway.activityFit ? (id: number | string) => gateway.activityFit!(id) : undefined),
      dailyHr:
        readers.dailyHr ??
        (gateway.dailyHeartRate
          ? async (start: Date, end: Date) =>
              dailyHrToPoints(await gateway.dailyHeartRate!(start.toISOString().slice(0, 10)), start, end)
          : undefined),
    };
    const found = await hrForSync(picked, sources, { enabled: true });
    if (found && found.length) return null;

    return {
      status: "deferred",
      dryRun: false,
      wouldUpload: false,
      dedupDecision: "waiting_for_hr" as unknown as DedupDecision,
      workout: {
        hevy_id: String(picked.id),
        title: (picked.title as string | null) ?? null,
        start_time: (picked.start_time as string | null) ?? null,
      },
      fitStats: null,
      existingGarminActivityId: null,
      garminActivityId: null,
      remaining: Math.max(0, candidates.length - 1),
      syncMethod: null,
      error: null,
    } as SyncOneResult;
  } catch {
    return null;
  }
}
