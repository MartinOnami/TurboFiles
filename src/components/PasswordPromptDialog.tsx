import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";

export interface PasswordPrompt {
  /** Site display name. */
  name: string;
  /** "user@host" for context. */
  target: string;
  /** Optional reason, e.g. an auth error from a previous attempt. */
  reason?: string;
}

export interface PasswordResult {
  password: string;
  remember: boolean;
}

export interface PasswordPromptDialogProps {
  prompt: PasswordPrompt | null;
  /** Resolve with the entered password (and whether to save it), or null to cancel. */
  onResolve: (result: PasswordResult | null) => void;
}

/** Prompt for a site password at connect time when none is stored. */
export function PasswordPromptDialog({ prompt, onResolve }: PasswordPromptDialogProps) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!prompt) return;
    setPassword("");
    setRemember(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onResolve(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prompt, onResolve]);

  if (!prompt) return null;

  const submit = () => {
    if (!password) return;
    onResolve({ password, remember });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={() => onResolve(null)}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <KeyRound size={16} className="text-accent" /> Enter password
          </h2>
          <button
            onClick={() => onResolve(null)}
            className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-4 py-3 text-xs">
          <p className="text-fg">
            Password for <span className="font-medium">{prompt.name}</span>{" "}
            <span className="text-subtle">({prompt.target})</span>
          </p>
          {prompt.reason && (
            <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-1.5 text-[11px] text-fg">
              {prompt.reason}
            </p>
          )}
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Password"
            className="h-8 rounded border border-border bg-bg px-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <label className="flex items-center gap-2 text-subtle">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember in this device's keychain
          </label>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={() => onResolve(null)}
            className="rounded-md border border-border px-4 py-1.5 text-xs text-subtle hover:bg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!password}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            Connect
          </button>
        </footer>
      </div>
    </div>
  );
}
