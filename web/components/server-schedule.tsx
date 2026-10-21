import { getT } from "@/lib/i18n/server";

/**
 * Auto-sync on a self-hosted server, where its own cron syncs and the Hevy
 * webhook syncs each finished workout.
 * Replaces the dashboard's toggle, which would do nothing there.
 */
export async function ServerSchedule({ schedule }: { schedule: string }) {
  const { t } = await getT();
  return (
    <section className="rounded-xl border border-border bg-surface-elevated p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">{t("autosync.title")}</h2>
        <span className="text-sm font-medium text-teal">{t("serverSchedule.on")}</span>
      </div>
      <p className="mt-0.5 text-sm text-text-secondary">{t("serverSchedule.desc", { schedule })}</p>
    </section>
  );
}
