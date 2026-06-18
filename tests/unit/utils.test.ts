import { describe, expect, it } from "vitest";
import { cn, formatBytes, formatLogTime, formatSpeed, logDateKey, scopeColor, setByteFormat } from "@/lib/utils";

describe("formatBytes (binary default)", () => {
  it("formats zero", () => expect(formatBytes(0)).toBe("0 B"));
  it("formats KiB", () => expect(formatBytes(2400)).toBe("2.3 KiB"));
  it("formats MiB", () => expect(formatBytes(12_600_000)).toBe("12 MiB"));
  it("formats GiB", () => expect(formatBytes(1_120_000_000)).toBe("1 GiB"));
});

describe("formatBytes (decimal)", () => {
  it("uses decimal units when selected", () => {
    setByteFormat("decimal");
    expect(formatBytes(2400)).toBe("2.4 KB");
    expect(formatBytes(12_600_000)).toBe("12.6 MB");
    setByteFormat("binary"); // restore default for other tests
  });
});

describe("formatSpeed", () => {
  it("appends /s", () => expect(formatSpeed(8_400_000)).toBe("8 MiB/s"));
});

describe("log timestamp helpers", () => {
  it("formatLogTime renders clock time for ISO and passes through legacy strings", () => {
    expect(formatLogTime("2026-06-15T09:30:00.000Z")).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(formatLogTime("14:30:25")).toBe("14:30:25"); // legacy time-only
    expect(formatLogTime("not a date")).toBe("not a date");
  });

  it("logDateKey is stable within a day and distinct across days", () => {
    // Local-time inputs (no "Z") so grouping is timezone-independent in the test.
    const a = logDateKey("2026-06-15T01:00:00");
    const b = logDateKey("2026-06-15T23:00:00");
    const c = logDateKey("2026-06-16T01:00:00");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(logDateKey("garbage")).toBe("earlier");
  });

  it("scopeColor is deterministic and returns a hex color", () => {
    expect(scopeColor("user@host")).toBe(scopeColor("user@host"));
    expect(scopeColor("user@host")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("cn", () => {
  it("merges and de-dupes tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-fg", false && "hidden", "font-bold")).toBe("text-fg font-bold");
  });
});
