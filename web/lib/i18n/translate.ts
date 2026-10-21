import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type MessageKey } from "./messages/en";
import { ptBR } from "./messages/pt-BR";

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, "pt-BR": ptBR };

export type Vars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

/** Looks `key` up in `locale` (falling back to English) and fills `{name}` placeholders. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function makeT(locale: Locale): TFunction {
  return (key, vars) => translate(locale, key, vars);
}

/** For keys built at runtime (e.g. config field names); undefined when there is no translation. */
export function tryTranslate(locale: Locale, key: string): string | undefined {
  const dict = DICTIONARIES[locale] as Record<string, string>;
  return dict[key] ?? (DICTIONARIES[DEFAULT_LOCALE] as Record<string, string>)[key];
}
