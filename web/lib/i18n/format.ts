import type { Locale } from "./config";
import type { TFunction } from "./translate";

/** "30 min" / "2 hours" / "1 day" for an auto-sync interval given in minutes. */
export function fmtInterval(t: TFunction, minutes: number): string {
  if (minutes < 60) return t("interval.minutes", { n: minutes });
  const h = minutes / 60;
  if (h === 1) return t("interval.hour");
  return h < 24 ? t("interval.hours", { n: h }) : t("interval.day");
}

/** Locale-aware date/time. Empty or unparsable values show an em dash. */
export function fmtDateTime(locale: Locale, value: string | null, opts: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale, opts);
}
