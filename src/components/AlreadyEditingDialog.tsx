import { useEffect, useState } from "react";

/** A remote file that already has a local copy open for editing. */
export interface EditConflict {
  name: string;
}

/** The user's choice: reopen the local copy, re-download fresh, or cancel (null). */
export type EditConflictChoice = "reopen" | "fresh" | null;

export interface AlreadyEditingDialogProps {
  conflict: EditConflict | null;
  onResolve: (choice: EditConflictChoice) => void;
}

/**
 * Shown when a remote file opened for editing is already being edited (a local
 * copy + watcher exist). Mirrors FileZilla: reopen the local file, or discard it
 * and download a fresh copy.
 */
export function AlreadyEditingDialog({ conflict, onResolve }: AlreadyEditingDialogProps) {
  const [choice, setChoice] = useState<"reopen" | "fresh">("reopen");

  // Default to the safe option (reopen, preserving local edits) on each open.
  useEffect(() => {
    if (conflict) setChoice("reopen");
  }, [conflict]);

  useEffect(() => {
    if (!conflict) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(null);
      if (e.key === "Enter") onResolve(choice);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [conflict, choice, onResolve]);

  if (!conflict) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={() => onResolve(null)}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Selected file already being edited</h2>
        </div>
        <div className="px-4 py-3 text-sm text-fg">
          <p className="text-subtle">The selected file is already being edited:</p>
          <p className="mt-1 break-all font-mono">{conflict.name}</p>
          <p className="mb-1.5 mt-3 text-[10px] font-medium uppercase tracking-wide text-subtle">
            Action to perform
          </p>
          <label className="flex cursor-pointer items-center gap-2 py-1">
            <input
              type="radio"
              name="edit-action"
              checked={choice === "reopen"}
              onChange={() => setChoice("reopen")}
              className="accent-accent"
            />
            Reopen local file
          </label>
          <label className="flex cursor-pointer items-center gap-2 py-1">
            <input
              type="radio"
              name="edit-action"
              checked={choice === "fresh"}
              onChange={() => setChoice("fresh")}
              className="accent-accent"
            />
            Discard local file, then download and edit anew
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={() => onResolve(null)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => onResolve(choice)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
