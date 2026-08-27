// EPIC 52: lightweight client i18n (en/ru). No framework — dictionaries + localStorage.

import { en } from "./locales/en";
import { ru } from "./locales/ru";

export type Locale = "en" | "ru";

export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "cubewars.locale";

const dictionaries: Record<Locale, Record<string, string>> = { en, ru };

type Listener = (locale: Locale) => void;

let currentLocale: Locale = resolveInitialLocale();
const listeners = new Set<Listener>();

function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ru";
}

function browserPrefersRu(): boolean {
  if (typeof navigator === "undefined") return false;
  const candidates = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
  return candidates.some((lang) => lang.toLowerCase().startsWith("ru"));
}

function resolveInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* private mode / denied */
  }
  return browserPrefersRu() ? "ru" : "en";
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) {
    applyI18nDom();
    return;
  }
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore quota / private mode */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  applyI18nDom();
  for (const listener of listeners) listener(locale);
}

/** Subscribe to locale changes. Returns unsubscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(key: string, params?: TranslationParams): string {
  const dict = dictionaries[currentLocale] ?? dictionaries.en;
  let text = dict[key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** Apply `data-i18n*` attributes on the document (static HTML chrome). */
export function applyI18nDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (!key) return;
    el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key || !("placeholder" in el)) return;
    (el as HTMLInputElement).placeholder = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (!key) return;
    el.setAttribute("aria-label", t(key));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    el.setAttribute("title", t(key));
  });
  // Highlight active locale buttons.
  root.querySelectorAll<HTMLElement>("[data-locale]").forEach((el) => {
    const loc = el.getAttribute("data-locale");
    el.classList.toggle("locale-active", loc === currentLocale);
    el.setAttribute("aria-pressed", loc === currentLocale ? "true" : "false");
  });
}

/** Wire EN|RU buttons with `data-locale="en"|"ru"`. Call once on boot. */
export function wireLocaleSwitcher(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-locale]").forEach((el) => {
    el.addEventListener("click", () => {
      const loc = el.getAttribute("data-locale");
      if (isLocale(loc)) setLocale(loc);
    });
  });
}

/** Map catalog label for the active locale. */
export function localizedMapName(map: {
  displayName: string;
  displayNameRu?: string;
}): string {
  if (currentLocale === "ru" && map.displayNameRu) return map.displayNameRu;
  return map.displayName;
}

// Sync document lang on module load (browser only).
if (typeof document !== "undefined") {
  document.documentElement.lang = currentLocale;
}
