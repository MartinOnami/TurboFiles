import type { LogEntry } from "@/lib/types";
import { formatLogTime } from "@/lib/utils";

const LEVEL_COLOR: Record<LogEntry["level"], string> = {
  info: "text-success",
  warn: "text-warning",
  error: "text-danger",
  debug: "text-subtle",
};

export function LogsPanel({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-subtle">Logs</div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {logs.length === 0 && <p className="text-subtle">No log entries yet.</p>}
        {/* Newest first. */}
        {logs
          .map((log, i) => ({ log, i }))
          .reverse()
          .map(({ log, i }) => (
            <div key={i} className="flex gap-2">
              <span className="text-subtle">{formatLogTime(log.timestamp)}</span>
              <span className={`uppercase ${LEVEL_COLOR[log.level]}`}>[{log.level}]</span>
              <span className="text-fg">{log.message}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
