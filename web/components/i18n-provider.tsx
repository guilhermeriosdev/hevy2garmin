"use client";

import { createContext, useContext, useMemo } from "react";
import type { Locale } from "@/lib/i18n/config";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { makeT, type TFunction } from "@/lib/i18n/translate";

interface I18n {
  locale: Locale;
  t: TFunction;
}

const Ctx = createContext<I18n>({ locale: DEFAULT_LOCALE, t: makeT(DEFAULT_LOCALE) });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Client-component translator: `const { t, locale } = useI18n();` */
export function useI18n(): I18n {
  return useContext(Ctx);
}
