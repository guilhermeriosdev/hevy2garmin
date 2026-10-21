import { describe, it, expect, vi } from "vitest";
import type { SyncDeps } from "hevy2garmin";
import { deferForHr, hrWaitMinutesFromEnv, DEFAULT_HR_WAIT_MINUTES } from "./hr-wait";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function workout(endedMinutesAgo: number) {
  return {
    id: "w1",
    title: "Pull",
    start_time: minutesAgo(endedMinutesAgo + 40),
    end_time: minutesAgo(endedMinutesAgo),
    exercises: [],
  };
}

function makeDeps(w: ReturnType<typeof workout>, daily: Array<[number, number | null]> = [], synced: string[] = []) {
  const dailyHeartRate = vi.fn(async () => daily);
  const deps = {
    store: {
      loadSyncedIds: async () => new Set(synced),
      loadPendingIds: async () => new Set<string>(),
    },
    fetchWorkouts: async () => [w],
    gateway: async () => ({ dailyHeartRate }),
  } as unknown as SyncDeps;
  return { deps, dailyHeartRate };
}

// Past the 120-minute watch grace, so only the HR wait is under test.
const LIVE = { dryRun: false, respectGrace: true, hrFusion: true, hrWaitMinutes: DEFAULT_HR_WAIT_MINUTES } as const;

describe("deferForHr", () => {
  it("defers a recent workout that has no heart rate on Garmin yet", async () => {
    const { deps } = makeDeps(workout(180));
    const r = await deferForHr(deps, LIVE);
    expect(r?.status).toBe("deferred");
    expect(r?.dedupDecision).toBe("waiting_for_hr");
    expect(r?.workout?.hevy_id).toBe("w1");
    expect(r?.wouldUpload).toBe(false);
  });

  it("lets the workout through once the daily feed has HR for its window", async () => {
    const w = workout(180);
    const start = Date.parse(w.start_time);
    const { deps } = makeDeps(w, [[start + 60_000, 120], [start + 600_000, 135]]);
    expect(await deferForHr(deps, LIVE)).toBeNull();
  });

  it("steps aside after the wait has run out", async () => {
    const { deps } = makeDeps(workout(180));
    expect(await deferForHr(deps, { ...LIVE, hrWaitMinutes: 120 })).toBeNull();
  });

  it("leaves the watch grace period to the engine", async () => {
    const { deps, dailyHeartRate } = makeDeps(workout(30));
    expect(await deferForHr(deps, LIVE)).toBeNull();
    expect(dailyHeartRate).not.toHaveBeenCalled();
  });

  it.each([
    ["a person pressing Sync Now", { respectGrace: false }],
    ["a dry run", { dryRun: true }],
    ["HR fusion off", { hrFusion: false }],
    ["the wait set to 0", { hrWaitMinutes: 0 }],
    ["merge-only", { mergeOnly: true }],
    ["a resync", { targetActivityId: 5 }],
  ])("does not wait for %s", async (_name, over) => {
    const { deps, dailyHeartRate } = makeDeps(workout(180));
    expect(await deferForHr(deps, { ...LIVE, ...over })).toBeNull();
    expect(dailyHeartRate).not.toHaveBeenCalled();
  });

  it("does nothing when there is no candidate", async () => {
    const { deps } = makeDeps(workout(180), [], ["w1"]);
    expect(await deferForHr(deps, LIVE)).toBeNull();
  });

  it("never holds a workout back because looking failed", async () => {
    const { deps } = makeDeps(workout(180));
    (deps as unknown as { gateway: () => Promise<never> }).gateway = async () => {
      throw new Error("garmin down");
    };
    expect(await deferForHr(deps, LIVE)).toBeNull();
  });
});

describe("hrWaitMinutesFromEnv", () => {
  it("defaults to 12 hours", () => {
    expect(hrWaitMinutesFromEnv({})).toBe(720);
  });
  it("reads H2G_HR_WAIT_MINUTES, including 0 to turn it off", () => {
    expect(hrWaitMinutesFromEnv({ H2G_HR_WAIT_MINUTES: "90" })).toBe(90);
    expect(hrWaitMinutesFromEnv({ H2G_HR_WAIT_MINUTES: "0" })).toBe(0);
  });
  it("ignores nonsense", () => {
    expect(hrWaitMinutesFromEnv({ H2G_HR_WAIT_MINUTES: "soon" })).toBe(720);
    expect(hrWaitMinutesFromEnv({ H2G_HR_WAIT_MINUTES: "-5" })).toBe(720);
  });
});
