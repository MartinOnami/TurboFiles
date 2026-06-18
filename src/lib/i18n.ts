/**
 * Minimal internationalisation scaffolding.
 *
 * This is intentionally dependency-free: a flat key→string dictionary per locale
 * plus a module-level `t()` lookup (mirroring the `setByteFormat`/`setDateTimeFormat`
 * pattern used elsewhere). It establishes the structure for full translation;
 * only a starter set of keys is translated today, and untranslated keys fall
 * back to English, then to the key itself.
 */

export type Locale = "en" | "es";

/** Display names for the locale picker. */
export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

type Dict = Record<string, string>;

const en: Dict = {
  "settings.title": "Settings",
  "settings.interface": "Interface",
  "settings.connection": "Connection",
  "settings.filelists": "File lists",
  "settings.transfers": "Transfers",
  "settings.editing": "File editing",
  "settings.assistant": "Assistant",
  "settings.changelog": "Changelog",
  "settings.about": "About",
  "settings.language": "Language",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.connect": "Connect",
  "common.disconnect": "Disconnect",
};

// Starter translations — extended over time. Missing keys fall back to English.
const es: Dict = {
  "settings.title": "Ajustes",
  "settings.interface": "Interfaz",
  "settings.connection": "Conexión",
  "settings.filelists": "Listas de archivos",
  "settings.transfers": "Transferencias",
  "settings.editing": "Edición de archivos",
  "settings.assistant": "Asistente",
  "settings.changelog": "Cambios",
  "settings.about": "Acerca de",
  "settings.language": "Idioma",
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.connect": "Conectar",
  "common.disconnect": "Desconectar",
};

const DICTS: Record<Locale, Dict> = { en, es };

// Module-level current locale, set from settings during render (see App.tsx).
let locale: Locale = "en";
export function setLocale(l: Locale): void {
  locale = l;
}

/** Translate `key` for the active locale, falling back to English then the key. */
export function t(key: string): string {
  return DICTS[locale]?.[key] ?? en[key] ?? key;
}
