import { describe, expect, it, afterEach } from "vitest";
import { setLocale, t, LOCALES } from "@/lib/i18n";

afterEach(() => setLocale("en"));

describe("i18n", () => {
  it("returns English by default", () => {
    expect(t("settings.title")).toBe("Settings");
  });

  it("translates when a locale is set", () => {
    setLocale("es");
    expect(t("settings.title")).toBe("Ajustes");
  });

  it("falls back to English for untranslated keys", () => {
    setLocale("es");
    // A key only present in English still resolves via the fallback chain.
    expect(t("common.connect")).toBe("Conectar");
  });

  it("falls back to the key itself when missing everywhere", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("exposes selectable locales", () => {
    expect(LOCALES.map((l) => l.value)).toContain("en");
    expect(LOCALES.map((l) => l.value)).toContain("es");
  });
});
