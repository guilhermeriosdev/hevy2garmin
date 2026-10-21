/**
 * An unattended run must not upload a workout without heart rate while the HR may still be on its
 * way to Garmin. Garmin forwards an upload to Strava at once and Strava keeps the first copy it
 * gets, so an early upload loses the HR on Strava for good.
 */
import { describe, it, expect, vi } from "vitest";
import { syncOneWorkout } from "../../src/sync/sync-one";
import type { SyncDeps } from "../../src/sync/gateway";
import { MemoryStore, mockGateway } from "./helpers";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function workoutEndedAgo(minutes: number) {
  return {
    id: "w-hr",
    title: "Pull",
    start_time: minutesAgo(minutes + 40),
    end_time: minutesAgo(minutes),
    exercises: [{ title: "Bench Press", sets: [{ type: "normal", weight_kg: 80, reps: 5 }] }],
  };
}

function setup(minutes: number, dailyHr: Array<[number, number | null]> = []) {
  const store = new MemoryStore();
  const gw = { ...mockGateway(), dailyHeartRate: vi.fn(async () => dailyHr) };
  const deps = {
    store,
    gateway: async () => gw,
    fetchWorkouts: async () => [workoutEndedAgo(minutes)],
  } as unknown as SyncDeps;
  return { store, gw, deps };
}

// Past the 120-minute watch grace, so only the HR wait is under test.
const LIVE = { dryRun: false, respectGrace: true, hrFusion: true } as const;

describe("waiting for heart rate before an unattended upload", () => {
  it("defers when no HR has reached Garmin yet, and touches nothing", async () => {
    const { store, gw, deps } = setup(180);
    const r = await syncOneWorkout(deps, LIVE);
    expect(r.status).toBe("deferred");
    expect(r.dedupDecision).toBe("waiting_for_hr");
    expect(gw.upload).not.toHaveBeenCalled();
    expect(store.claimPending).not.toHaveBeenCalled();
    expect(store.markSynced).not.toHaveBeenCalled();
  });

  it("uploads once the HR is there", async () => {
    const start = Date.parse(workoutEndedAgo(180).start_time);
    const { gw, deps } = setup(180, [[start + 60_000, 120], [start + 600_000, 135]]);
    const r = await syncOneWorkout(deps, LIVE);
    expect(r.status).toBe("synced");
    expect(r.fitStats?.avgHr).toBeGreaterThan(0);
    expect(gw.upload).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting after hrWaitMinutes and uploads without HR", async () => {
    const { gw, deps } = setup(180);
    const r = await syncOneWorkout(deps, { ...LIVE, hrWaitMinutes: 120 });
    expect(r.status).toBe("synced");
    expect(gw.upload).toHaveBeenCalledTimes(1);
  });

  it("hrWaitMinutes: 0 turns the wait off", async () => {
    const { gw, deps } = setup(180);
    const r = await syncOneWorkout(deps, { ...LIVE, hrWaitMinutes: 0 });
    expect(r.status).toBe("synced");
    expect(gw.upload).toHaveBeenCalledTimes(1);
  });

  it("does not wait when HR fusion is off", async () => {
    const { gw, deps } = setup(180);
    const r = await syncOneWorkout(deps, { ...LIVE, hrFusion: false });
    expect(r.status).toBe("synced");
    expect(gw.upload).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a person pressing Sync Now", async () => {
    const { gw, deps } = setup(180);
    const r = await syncOneWorkout(deps, { dryRun: false, hrFusion: true });
    expect(r.status).toBe("synced");
    expect(gw.upload).toHaveBeenCalledTimes(1);
  });
});
