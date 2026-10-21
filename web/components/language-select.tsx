"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale } from "@/lib/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Language picker. Stores the choice in a cookie and re-renders the server components. */
export function LanguageSelect() {
  const { t, locale } = useI18n();
  const router = useRouter();

  function change(value: string) {
    if (!isLocale(value)) return;
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <label className="mb-1 block text-xs text-text-muted" htmlFor="sf-language">
        {t("settings.language")}
      </label>
      <select
        id="sf-language"
        value={locale}
        onChange={(e) => change(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-teal focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-text-muted">{t("settings.languageHint")}</p>
    </div>
  );
}
