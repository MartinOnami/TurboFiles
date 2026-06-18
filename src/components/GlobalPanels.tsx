import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { LogEntry, LogLevel, Transfer } from "@/lib/types";
import { formatLogTime, logDateKey, logDateLabel, scopeColor } from "@/lib/utils";
import type { TransferQueueProps } from "./TransferQueue";

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-success",
  warn: "text-warning",
  error: "text-danger",
  debug: "text-subtle",
};

/** Small colored pill identifying the session/site a log entry belongs to. */
function SiteBadge({ scope }: { scope: string }) {
  const c = scopeColor(scope);
  return (
    <span
      className="max-w-[14rem] truncate rounded px-1.5 py-px text-[10px] font-medium"
      style={{ backgroundColor: `${c}22`, color: c }}
      title={scope}
    >
      {scope}
    </span>
  );
}

const LEVELS: (LogLevel | "all")[] = ["all", "info", "warn", "error"];

/** Pick a stable, sorted list of session scopes present in the given items. */
function scopesOf(items: { scope?: string }[]): string[] {
  const set = new Set<string>();
  for (const it of items) set.add(it.scope || "System");
  return Array.from(set).sort();
}

function ScopeSelect({
  value,
  scopes,
  onChange,
}: {
  value: string;
  scopes: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-subtle">
      Site
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="all">All sites</option>
        {scopes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Full-window, filterable log view opened as a top tab. */
export function GlobalLogsPanel({ logs }: { logs: LogEntry[] }) {
  const [scope, setScope] = useState("all");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [search, setSearch] = useState("");

  const scopes = scopesOf(logs);
  const q = search.toLowerCase();
  const visible = logs.filter((l) => {
    if (scope !== "all" && (l.scope || "System") !== scope) return false;
    if (level !== "all" && l.level !== level) return false;
    if (q && !l.message.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <ScopeSelect value={scope} scopes={scopes} onChange={setScope} />
        <div className="flex items-center gap-1">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={`rounded-full px-2.5 py-1 text-xs capitalize transition-colors ${
                level === lv
                  ? "bg-accent text-accent-fg"
                  : "text-subtle hover:bg-muted hover:text-fg"
              }`}
            >
              {lv}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter messages…"
            className="h-7 w-48 rounded border border-border bg-bg pl-6 pr-2 text-xs text-fg placeholder-subtle focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {visible.length === 0 && (
          <p className="p-3 text-xs text-subtle">No matching log entries.</p>
        )}
        {groupByDate(visible).map((group) => (
          <div key={group.key}>
            <div className="sticky top-0 z-10 border-b border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-subtle">
              {group.label} · {group.entries.length}
            </div>
            <div className="relative py-1 pl-7 pr-3">
              {/* timeline rail */}
              <span className="absolute bottom-1 left-3 top-1 w-px bg-border" />
              {group.entries.map(({ entry, i }) => {
                const scope = entry.scope || "System";
                const dot =
                  scope === "System" ? "var(--tw-prose-bullets, #64748b)" : scopeColor(scope);
                return (
                  <div key={i} className="relative py-1">
                    <span
                      className="absolute -left-[18px] top-2 h-2 w-2 rounded-full ring-2 ring-surface"
                      style={{ backgroundColor: dot }}
                    />
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-mono text-subtle">
                        {formatLogTime(entry.timestamp)}
                      </span>
                      <span className={`font-mono uppercase ${LEVEL_COLOR[entry.level]}`}>
                        [{entry.level}]
                      </span>
                      {scope !== "System" && <SiteBadge scope={scope} />}
                      <span className="break-all text-fg">{entry.message}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tsMillis(ts?: string): number {
  const d = new Date(ts ?? "");
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Sort items chronologically and group into consecutive same-day sections. */
function groupByDate<T extends { timestamp?: string }>(
  items: T[],
): { key: string; label: string; entries: { entry: T; i: number }[] }[] {
  const sorted = [...items].sort((a, b) => tsMillis(a.timestamp) - tsMillis(b.timestamp));
  const groups: { key: string; label: string; entries: { entry: T; i: number }[] }[] = [];
  sorted.forEach((entry, i) => {
    const key = logDateKey(entry.timestamp);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: logDateLabel(entry.timestamp), entries: [] };
      groups.push(g);
    }
    g.entries.push({ entry, i });
  });
  return groups;
}

const STATUS_COLOR: Record<Transfer["status"], string> = {
  queued: "text-subtle",
  transferring: "text-accent",
  paused: "text-warning",
  completed: "text-success",
  failed: "text-danger",
  cancelled: "text-subtle",
};

const QFILTERS: { value: string; label: string; match: (s: Transfer["status"]) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "queued", label: "Queued", match: (s) => s === "queued" },
  { value: "active", label: "Active", match: (s) => s === "transferring" || s === "paused" },
  { value: "failed", label: "Failed", match: (s) => s === "failed" },
  { value: "completed", label: "Completed", match: (s) => s === "completed" || s === "cancelled" },
];

/** Full-window transfer queue as a date + site timeline (mirrors the Logs tab). */
export function GlobalQueuePanel({
  transfers,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onClearCompleted,
}: { transfers: Transfer[] } & Omit<TransferQueueProps, "transfers">) {
  const [scope, setScope] = useState("all");
  const [filter, setFilter] = useState("all");
  const scopes = scopesOf(transfers);
  const activeFilter = QFILTERS.find((f) => f.value === filter)!;
  const visible = transfers.filter((t) => {
    if (scope !== "all" && (t.scope || "System") !== scope) return false;
    return activeFilter.match(t.status);
  });
  const hasCleared = transfers.some((t) => t.status === "completed" || t.status === "cancelled");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <ScopeSelect value={scope} scopes={scopes} onChange={setScope} />
        <div className="flex items-center gap-1">
          {QFILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                filter === f.value
                  ? "bg-accent text-accent-fg"
                  : "text-subtle hover:bg-muted hover:text-fg"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {hasCleared && (
          <button
            onClick={onClearCompleted}
            className="ml-auto text-[10px] text-subtle hover:text-fg"
          >
            Clear completed
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {visible.length === 0 && <p className="p-3 text-xs text-subtle">No matching transfers.</p>}
        {groupByDate(visible).map((group) => (
          <div key={group.key}>
            <div className="sticky top-0 z-10 border-b border-border bg-elevated px-3 py-1 text-[11px] font-semibold text-subtle">
              {group.label} · {group.entries.length}
            </div>
            <div className="relative py-1 pl-7 pr-3">
              <span className="absolute bottom-1 left-3 top-1 w-px bg-border" />
              {group.entries.map(({ entry: t }) => (
                <QueueRow
                  key={t.id}
                  t={t}
                  onPause={onPause}
                  onResume={onResume}
                  onCancel={onCancel}
                  onRetry={onRetry}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const QACTIVE = new Set<Transfer["status"]>(["queued", "transferring", "paused"]);

function QueueRow({
  t,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: { t: Transfer } & Omit<TransferQueueProps, "transfers" | "onClearCompleted">) {
  const pct =
    t.totalBytes > 0
      ? Math.round((t.bytesTransferred / t.totalBytes) * 100)
      : t.status === "completed"
        ? 100
        : 0;
  const bar =
    t.status === "failed" ? "bg-danger" : t.status === "completed" ? "bg-success" : "bg-accent";
  const scope = t.scope || "System";
  const dot = scope === "System" ? "#64748b" : scopeColor(scope);
  return (
    <div className="relative py-1.5">
      <span
        className="absolute -left-[18px] top-2.5 h-2 w-2 rounded-full ring-2 ring-surface"
        style={{ backgroundColor: dot }}
      />
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 font-mono text-subtle">{formatLogTime(t.timestamp)}</span>
        <span className="shrink-0 text-subtle">{t.direction === "upload" ? "⬆" : "⬇"}</span>
        {scope !== "System" && <SiteBadge scope={scope} />}
        <span className="min-w-0 flex-1 truncate text-fg" title={t.remotePath}>
          {t.name || "-"}
        </span>
        <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
          <div className={`h-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-9 shrink-0 text-right text-subtle">{pct}%</span>
        <span className={`w-20 shrink-0 capitalize ${STATUS_COLOR[t.status]}`}>
          {t.status}
          {t.error && (
            <span className="ml-1 text-danger" title={t.error}>
              ⚠
            </span>
          )}
        </span>
        <div className="flex w-14 shrink-0 items-center justify-end gap-0.5">
          {t.status === "transferring" && (
            <RowAction label="Pause" onClick={() => onPause(t.id)}>
              ⏸
            </RowAction>
          )}
          {t.status === "paused" && (
            <RowAction label="Resume" onClick={() => onResume(t.id)}>
              ▶
            </RowAction>
          )}
          {t.status === "failed" && (
            <RowAction label="Retry" onClick={() => onRetry(t)}>
              ↻
            </RowAction>
          )}
          {QACTIVE.has(t.status) && (
            <RowAction label="Cancel" onClick={() => onCancel(t.id)}>
              ✕
            </RowAction>
          )}
        </div>
      </div>
    </div>
  );
}

function RowAction({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded px-1 py-0.5 text-subtle hover:bg-muted hover:text-fg"
    >
      {children}
    </button>
  );
}
