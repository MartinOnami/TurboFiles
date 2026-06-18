import { useState } from "react";
import { ArrowUp, ShieldCheck, Sparkles } from "lucide-react";
import { BrandMark } from "./BrandMark";

export interface OnboardingProps {
  /** Called when onboarding is dismissed (persist the flag in the caller). */
  onContinue: () => void;
}

interface OnbStep {
  badge: string;
  title: string;
  body: string;
  visual: "panes" | "secure" | "assistant";
}

const STEPS: OnbStep[] = [
  {
    badge: "Welcome",
    title: "Move files anywhere, fast",
    body: "TurboFiles is a fast, modern SFTP, FTP and FTPS client. Browse local and remote side by side, queue transfers, resume interrupted uploads, and drag and drop to move files in seconds.",
    visual: "panes",
  },
  {
    badge: "Secure",
    title: "Secure file transfers by default",
    body: "Passwords and SSH keys stay in your operating system keychain, never on disk and never in logs. Every connection is verified with SSH host keys or TLS, so your data stays private.",
    visual: "secure",
  },
  {
    badge: "New",
    title: "A built-in AI assistant",
    body: "Ask TurboFiles in plain English to open folders, move files, read logs, or audit a site for security issues. Bring your own key or run a local model. Reads happen automatically, and anything that changes files asks you first.",
    visual: "assistant",
  },
];

/**
 * First-run onboarding: a full-page, split-screen, multi-step flow. The left half
 * carries the copy and controls; the right half is a deep-blue gradient hero with
 * a stylized TurboFiles app mockup that changes per step.
 */
export function Onboarding({ onContinue }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(false);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  void dontShow; // dismissing always persists; the checkbox mirrors the reference UI.

  return (
    <div className="relative flex h-screen w-screen bg-bg">
      {/* Left: copy + controls */}
      <div className="flex w-full flex-col justify-between px-12 py-14 md:w-1/2 lg:px-16">
        <div className="mt-6 max-w-xl">
          <span className="inline-block rounded-md bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent">
            {s.badge}
          </span>
          <h1 className="mt-10 text-5xl font-bold leading-[1.05] tracking-tight text-fg">{s.title}</h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-subtle">{s.body}</p>
        </div>

        <div className="max-w-xl">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-subtle">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Do not show this again
          </label>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  aria-label={`Step ${i + 1}`}
                  className={`h-2.5 w-2.5 rounded-full transition-colors ${
                    i === step ? "bg-accent" : "bg-subtle/30 hover:bg-subtle/50"
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => (last ? onContinue() : setStep((p) => p + 1))}
              className="rounded-xl bg-accent px-8 py-2.5 text-base font-medium text-accent-fg shadow-sm transition-opacity hover:opacity-90"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>

      {/* Right: deep-blue gradient hero with a stylized app mockup */}
      <div className="relative hidden w-1/2 overflow-hidden md:block">
        <HeroVisual visual={s.visual} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- hero visuals */

function HeroVisual({ visual }: { visual: OnbStep["visual"] }) {
  return (
    <div
      className="relative h-full w-full"
      style={{ background: "linear-gradient(155deg,#0b2559 0%,#1456cc 52%,#4f86e8 100%)" }}
    >
      {/* soft glows */}
      <div className="absolute -left-12 top-8 h-44 w-44 rounded-full bg-white/20 blur-3xl" />
      <div className="absolute bottom-6 right-2 h-52 w-52 rounded-full bg-blue-300/30 blur-3xl" />

      {/* floating app window */}
      <div className="absolute left-12 top-1/2 w-[480px] -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* title bar */}
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3.5 py-2.5">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-green-400" />
          <div className="ml-2 flex items-center gap-1.5">
            <BrandMark size={14} />
            <span className="text-[11px] font-semibold tracking-tight text-slate-600">TurboFiles</span>
          </div>
        </div>

        {/* dual panes */}
        <div className="flex h-[300px]">
          <Pane title="Local site" rows={6} />
          <div className="flex w-10 shrink-0 flex-col items-center justify-center gap-2 bg-slate-50/60">
            <Chip>→</Chip>
            <Chip>←</Chip>
          </div>
          <Pane title="Remote site" rows={6} remote />
        </div>

        {/* per-step accent overlay sits just under the remote-site rows */}
        {visual === "secure" && (
          <div className="absolute bottom-5 left-[44%] right-5 flex items-center gap-2.5 rounded-xl bg-white/95 px-3.5 py-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <ShieldCheck size={18} className="text-emerald-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">Keychain &amp; TLS</div>
              <div className="text-xs text-slate-500">Host-key verified · secrets never on disk</div>
            </div>
          </div>
        )}
      </div>

      {visual === "assistant" && (
        <div className="absolute bottom-10 right-8 w-[260px] rounded-2xl bg-white/95 p-3 shadow-xl ring-1 ring-black/5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600">
            <Sparkles size={12} /> Ask TurboFiles
          </div>
          <div className="mt-2 flex justify-end">
            <span className="rounded-2xl rounded-br-sm bg-blue-600 px-2.5 py-1 text-[11px] text-white">
              audit this site
            </span>
          </div>
          <div className="mt-2 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
            ✓ Worked through 3 steps
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">No critical CVEs · wp-config not exposed.</div>
          <div className="mt-2 flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1">
            <span className="flex-1 text-[11px] text-slate-400">Ask anything…</span>
            <ArrowUp size={12} className="text-blue-600" />
          </div>
        </div>
      )}
    </div>
  );
}

function Pane({ title, rows, remote = false }: { title: string; rows: number; remote?: boolean }) {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {title}
      </div>
      <div className="py-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-[5px]">
            <div className={`h-3 w-3 shrink-0 rounded-[3px] ${remote ? "bg-sky-400/70" : "bg-blue-400/70"}`} />
            <div className="h-2 rounded bg-slate-200" style={{ width: `${45 + ((i * 13) % 45)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs text-slate-500 shadow-sm ring-1 ring-black/5">
      {children}
    </span>
  );
}
