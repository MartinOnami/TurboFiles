import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { formatBytes } from "@/lib/utils";

/** Details of a single name collision at the transfer destination. */
export interface FileConflict {
  name: string;
  /** "upload" → local file replacing a remote one; "download" → the reverse. */
  direction: "upload" | "download";
  /** Where the existing file lives, for human-readable copy. */
  destLabel: string;
  sourceSize: number;
  sourceModified?: string;
  destSize: number;
  destModified?: string;
}

export type ConflictResolution =
  | { action: "overwrite" }
  | { action: "skip" }
  | { action: "keepBoth" }
  | { action: "resume" }
  | { action: "rename"; newName: string };

export interface OverwriteDialogProps {
  conflict: FileConflict | null;
  onResolve: (r: ConflictResolution) => void;
}

export function OverwriteDialog({ conflict, onResolve }: OverwriteDialogProps) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    // Reset the rename sub-state whenever a new conflict appears.
    setRenaming(false);
    setNewName(conflict?.name ?? "");
  }, [conflict]);

  useEffect(() => {
    if (!conflict) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onResolve({ action: "skip" }); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [conflict, onResolve]);

  if (!conflict) return null;

  const sourceIsLocal = conflict.direction === "upload";
  const sourceLabel = sourceIsLocal ? "Local file" : "Remote file";
  const targetLabel = sourceIsLocal ? "Existing on server" : "Existing in folder";
  const sameSize = conflict.sourceSize === conflict.destSize;
  // Resuming only makes sense when the target looks like a partial of the source.
  const canResume = conflict.destSize > 0 && conflict.destSize < conflict.sourceSize;

  const confirmRename = () => {
    const n = newName.trim();
    if (n && n !== conflict.name) onResolve({ action: "rename", newName: n });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <AlertTriangle size={15} className="text-warning" /> Target file already exists
          </h2>
          <button
            onClick={() => onResolve({ action: "skip" })}
            className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
            aria-label="Skip"
          >
            <X size={15} />
          </button>
        </header>

        <div className="px-4 py-3 text-xs text-fg">
          <p className="mb-3 text-subtle">
            A file named <span className="font-medium text-fg">{conflict.name}</span> already exists
            {" "}{conflict.destLabel}. Choose what to do.
          </p>

          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
            <FileCard label={sourceLabel} size={conflict.sourceSize} modified={conflict.sourceModified} highlight />
            <div className="flex items-center text-subtle"><ArrowRight size={16} /></div>
            <FileCard label={targetLabel} size={conflict.destSize} modified={conflict.destModified} />
          </div>

          {sameSize && (
            <p className="mt-2 text-[11px] text-subtle">Both files are the same size ({formatBytes(conflict.sourceSize)}).</p>
          )}

          {renaming && (
            <div className="mt-3 flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); }}
                className="h-8 flex-1 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="New file name"
              />
              <button
                onClick={confirmRename}
                disabled={!newName.trim() || newName.trim() === conflict.name}
                className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={() => onResolve({ action: "skip" })}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-subtle hover:bg-muted hover:text-fg"
          >
            Skip
          </button>
          {canResume && (
            <button
              onClick={() => onResolve({ action: "resume" })}
              className="rounded-md border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10"
              title="Continue the transfer from where it stopped"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => onResolve({ action: "keepBoth" })}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-subtle hover:bg-muted hover:text-fg"
            title="Transfer under a new, automatically numbered name"
          >
            Keep both
          </button>
          <button
            onClick={() => setRenaming((v) => !v)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              renaming ? "border-accent text-accent" : "border-border text-subtle hover:bg-muted hover:text-fg"
            }`}
          >
            Rename…
          </button>
          <button
            onClick={() => onResolve({ action: "overwrite" })}
            className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Overwrite
          </button>
        </footer>
      </div>
    </div>
  );
}

function FileCard({
  label, size, modified, highlight,
}: { label: string; size: number; modified?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border px-2.5 py-2 ${highlight ? "border-accent/40 bg-accent/5" : "border-border bg-bg"}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-1 text-fg">{formatBytes(size)}</p>
      {modified && <p className="mt-0.5 text-[11px] text-subtle">{modified}</p>}
    </div>
  );
}
