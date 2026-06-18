import { useEffect } from "react";
import { ShieldAlert, X } from "lucide-react";

export interface CertPrompt {
  host: string;
  message: string;
}

export interface CertTrustDialogProps {
  prompt: CertPrompt | null;
  onResolve: (trust: boolean) => void;
}

/**
 * FileZilla-style "Unknown certificate" dialog. Shown when a TLS handshake fails
 * verification (self-signed cert or hostname mismatch). Trusting bypasses both
 * certificate-chain and hostname checks for this server, so the copy is explicit
 * about the risk.
 */
export function CertTrustDialog({ prompt, onResolve }: CertTrustDialogProps) {
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prompt, onResolve]);

  if (!prompt) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={() => onResolve(false)}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <ShieldAlert size={16} className="text-warning" /> Unknown certificate
          </h2>
          <button
            onClick={() => onResolve(false)}
            className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
            aria-label="Cancel"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-4 py-3 text-xs">
          <p className="text-fg">
            The server's TLS certificate for <span className="font-medium">{prompt.host}</span>{" "}
            could not be verified.
          </p>

          <div className="rounded-md border border-border bg-bg px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">Details</p>
            <p className="mt-1 break-words font-mono text-[11px] text-fg">{prompt.message}</p>
          </div>

          <p className="text-subtle">
            This usually means a self-signed certificate or a hostname mismatch. Only continue if
            you trust this server and your network — trusting bypasses both certificate and hostname
            verification, which leaves the connection open to interception on a hostile network.
          </p>

          <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-fg">
            Trusting is remembered for saved sites, so you won't be asked again next time.
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={() => onResolve(false)}
            className="rounded-md border border-border px-4 py-1.5 text-xs text-subtle hover:bg-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => onResolve(true)}
            className="rounded-md bg-warning px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Trust certificate and connect
          </button>
        </footer>
      </div>
    </div>
  );
}
