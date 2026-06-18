import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conditional logic, de-duplicating conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type ByteFormat = "binary" | "decimal";

// Module-level format, set from settings during render (see App.tsx). Kept here
// so the many formatBytes call sites don't each need the setting threaded in.
let byteFormat: ByteFormat = "binary";
export function setByteFormat(f: ByteFormat): void {
  byteFormat = f;
}

/** Format a byte count, honouring the binary (KiB) or decimal (KB) preference. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const binary = byteFormat === "binary";
  const k = binary ? 1024 : 1000;
  const units = binary
    ? ["B", "KiB", "MiB", "GiB", "TiB"]
    : ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${units[i]}`;
}

/** Format a transfer speed in bytes/sec as "8.4 MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

// ── Log timestamps (stored as ISO; legacy entries may be time-only strings) ──

export type DateTimeFormat = "locale" | "iso" | "short";

// Module-level format, set from settings during render (see App.tsx).
let dateTimeFormat: DateTimeFormat = "short";
export function setDateTimeFormat(f: DateTimeFormat): void {
  dateTimeFormat = f;
}

/** Show the time for a log entry per the user's format; falls back to the raw value. */
export function formatLogTime(ts?: string): string {
  const d = new Date(ts ?? "");
  if (isNaN(d.getTime())) return ts ?? "";
  switch (dateTimeFormat) {
    case "iso":
      // 24-hour HH:MM:SS in ISO style.
      return d.toTimeString().slice(0, 8);
    case "locale":
      return d.toLocaleTimeString();
    default:
      return d.toLocaleTimeString("en-US", { hour12: false });
  }
}

/** A stable day key (YYYY-MM-DD) for grouping; "earlier" for unparseable values. */
export function logDateKey(ts?: string): string {
  const d = new Date(ts ?? "");
  if (isNaN(d.getTime())) return "earlier";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** A human label for a log day: "Today", "Yesterday", or "Jun 14, 2026". */
export function logDateLabel(ts?: string): string {
  const d = new Date(ts ?? "");
  if (isNaN(d.getTime())) return "Earlier";
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const today = new Date();
  if (sameDay(d, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A deterministic accent color for a session scope (so each site reads distinctly). */
const SCOPE_PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#ef4444", "#6366f1",
];
export function scopeColor(scope: string): string {
  let h = 0;
  for (let i = 0; i < scope.length; i++) h = (h * 31 + scope.charCodeAt(i)) >>> 0;
  return SCOPE_PALETTE[h % SCOPE_PALETTE.length];
}
