import { useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import type { Transfer, TransferStatus } from "@/lib/types";
import { formatBytes, formatSpeed } from "@/lib/utils";

export interface TransferQueueProps {
  transfers: Transfer[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (t: Transfer) => void;
  onClearCompleted: () => void;
}

const STATUS_COLOR: Record<TransferStatus, string> = {
  queued: "text-subtle",
  transferring: "text-accent",
  paused: "text-warning",
  completed: "text-success",
  failed: "text-danger",
  cancelled: "text-subtle",
};

const ACTIVE = new Set<TransferStatus>(["queued", "transferring", "paused"]);

/** Top-level buckets a transfer can fall into, in display order. */
type Filter = "all" | "queued" | "active" | "failed" | "completed";

const FILTERS: { value: Filter; label: string; match: (s: TransferStatus) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "queued", label: "Queued", match: (s) => s === "queued" },
  { value: "active", label: "Active", match: (s) => s === "transferring" || s === "paused" },
  { value: "failed", label: "Failed", match: (s) => s === "failed" },
  { value: "completed", label: "Completed", match: (s) => s === "completed" || s === "cancelled" },
];

export function TransferQueue({
  transfers,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onClearCompleted,
}: TransferQueueProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = FILTERS.reduce<Record<Filter, number>>(
    (acc, f) => {
      acc[f.value] = transfers.filter((t) => f.match(t.status)).length;
      return acc;
    },
    { all: 0, queued: 0, active: 0, failed: 0, completed: 0 },
  );

  const activeFilter = FILTERS.find((f) => f.value === filter)!;
  const visible = transfers.filter((t) => activeFilter.match(t.status));
  const hasCleared = transfers.some((t) => t.status === "completed" || t.status === "cancelled");

  return (
    <div className="flex h-full flex-col">
      {/* Filter chips with live counts */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ${
              filter === f.value
                ? "bg-accent text-accent-fg"
                : "text-subtle hover:bg-muted hover:text-fg"
            }`}
          >
            <span>{f.label}</span>
            <span
              className={`rounded-full px-1.5 text-[10px] ${
                filter === f.value ? "bg-accent-fg/20" : "bg-muted"
              }`}
            >
              {counts[f.value]}
            </span>
          </button>
        ))}
        <div className="flex-1" />
        {hasCleared && (
          <button onClick={onClearCompleted} className="text-[10px] text-subtle hover:text-fg">
            Clear completed
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-elevated text-left text-xs text-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 font-medium">Speed</th>
              <th className="px-3 py-2 font-medium">Size</th>
              <th className="px-3 py-2 font-medium">Remote path</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-subtle">
                  {transfers.length === 0
                    ? "Queue is empty. Select a file and click the arrow to transfer."
                    : `No ${filter === "all" ? "" : filter + " "}transfers.`}
                </td>
              </tr>
            )}
            {visible.map((t) => {
              const pct =
                t.totalBytes > 0
                  ? Math.round((t.bytesTransferred / t.totalBytes) * 100)
                  : t.status === "completed"
                    ? 100
                    : 0;
              const barColor =
                t.status === "failed"
                  ? "bg-danger"
                  : t.status === "completed"
                    ? "bg-success"
                    : "bg-accent";
              return (
                <tr key={t.id} className="border-b border-border/50">
                  <td className="max-w-[220px] truncate px-3 py-1.5 text-fg" title={t.name}>
                    {t.name || "-"}
                  </td>
                  <td className={`px-3 py-1.5 capitalize ${STATUS_COLOR[t.status]}`}>
                    {t.status}
                    {t.error && (
                      <span className="ml-1 text-[10px] text-danger" title={t.error}>
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full ${barColor} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-subtle">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-subtle">
                    {t.speed > 0 ? formatSpeed(t.speed) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-subtle">
                    {formatBytes(t.bytesTransferred)} / {formatBytes(t.totalBytes)}
                  </td>
                  <td
                    className="max-w-[200px] truncate px-3 py-1.5 text-subtle"
                    title={t.remotePath}
                  >
                    {t.remotePath || "-"}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      {t.status === "transferring" && (
                        <IconBtn label="Pause" onClick={() => onPause(t.id)}>
                          <Pause size={13} />
                        </IconBtn>
                      )}
                      {t.status === "paused" && (
                        <IconBtn label="Resume" onClick={() => onResume(t.id)}>
                          <Play size={13} />
                        </IconBtn>
                      )}
                      {t.status === "failed" && (
                        <IconBtn label="Retry" onClick={() => onRetry(t)}>
                          <RotateCcw size={13} />
                        </IconBtn>
                      )}
                      {ACTIVE.has(t.status) && (
                        <IconBtn label="Cancel" onClick={() => onCancel(t.id)}>
                          <X size={13} />
                        </IconBtn>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
    >
      {children}
    </button>
  );
}
