import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Sparkles,
  ArrowUp,
  X,
  ShieldAlert,
  ShieldCheck,
  Settings as SettingsIcon,
  Paperclip,
  Loader2,
  Brain,
  ChevronDown,
  Check,
  CircleX,
  FolderSearch,
  ArrowDownUp,
  Plug,
  History,
  SquarePen,
  Trash2,
} from "lucide-react";
import { api, pickFiles } from "../lib/api";
import { BrandMark } from "./BrandMark";
import { useChats, type StoredChat } from "../store/useChats";
import { useStore } from "../store/useStore";
import { useSettings } from "../store/useSettings";
import {
  buildRequest,
  parseResponse,
  isWriteTool,
  providerById,
  validateToolArgs,
  type AgentMsg,
  type ToolCall,
} from "../lib/agent";
import type { DirEntry, Transfer } from "../lib/types";

export interface AssistantPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  /** Connect to a saved site by id (runs the app's full connect flow). Returns
   *  the outcome so the assistant can report the real reason on failure. */
  onConnectSite: (siteId: string) => Promise<{ ok: boolean; reason?: string }>;
}

export interface Step {
  label: string;
  detail?: string;
  status: "active" | "done" | "error";
}

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "error"; text: string }
  | { kind: "thought"; steps: Step[]; done: boolean; answer?: string };

interface Pending {
  description: string;
  resolve: (ok: boolean) => void;
}

function fmtErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e)
    return String((e as { message: unknown }).message);
  return String(e);
}

/** A short title for a saved chat: the first user message, trimmed. */
function deriveTitle(items: ChatItem[]): string {
  const first = items.find((i) => i.kind === "user") as { text: string } | undefined;
  const t = (first?.text ?? "").trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "New chat";
}

/** Compact relative time for the history list (e.g. "5m ago"). */
function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * A tool ran but the action did not succeed (e.g. not connected, site not found,
 * connect failed). Throwing this marks the chain-of-thought step - and therefore
 * the turn's status badge - as Failed, while still handing the model a readable
 * message (without an "Error:" prefix) so it can explain or recover.
 */
class ToolFailure extends Error {}
const baseName = (p: string) => {
  const s = p.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
};
const joinPath = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : dir + "/" + name);

/**
 * Resolve a remote directory path tolerantly. Tries the exact path first; if that
 * fails, walks from the root matching each component case- and separator-
 * insensitively (so "Support Custom" finds "support-custom"). Returns the real
 * path and its entries, or throws a helpful ToolFailure listing what's available.
 */
async function resolveRemoteDir(
  sessionId: string,
  input: string,
): Promise<{ path: string; entries: DirEntry[] }> {
  try {
    return { path: input, entries: await api.listRemote(sessionId, input) };
  } catch {
    /* fall back to a tolerant walk from the root */
  }
  const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");
  const parts = input.split("/").filter(Boolean);
  let cur = "/";
  let entries = await api.listRemote(sessionId, cur);
  for (const part of parts) {
    const dirs = entries.filter((e) => e.kind === "directory");
    const hit =
      dirs.find((e) => e.name === part) ??
      dirs.find((e) => e.name.toLowerCase() === part.toLowerCase()) ??
      dirs.find((e) => norm(e.name) === norm(part));
    if (!hit) {
      const avail =
        dirs
          .map((e) => e.name)
          .slice(0, 25)
          .join(", ") || "(no subfolders)";
      throw new ToolFailure(`No folder matching "${part}" in ${cur}. Available: ${avail}.`);
    }
    cur = joinPath(cur, hit.name);
    entries = await api.listRemote(sessionId, cur);
  }
  return { path: cur, entries };
}

const summarize = (entries: DirEntry[]) =>
  entries.length
    ? entries
        .slice(0, 200)
        .map((e) => (e.kind === "directory" ? `[dir] ${e.name}` : `${e.name} (${e.size}B)`))
        .join("\n")
    : "(empty directory)";
const summarizeTransfers = (ts: Transfer[]) =>
  ts.length
    ? ts
        .map((t) => `${t.name}: ${t.direction} ${t.status} ${t.bytesTransferred}/${t.totalBytes}B`)
        .join("\n")
    : "The transfer queue is empty.";

/** Collapse a multi-line tool result to a short single line for the step detail. */
const oneLine = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
};

const joinRemote = (dir: string, name: string) =>
  dir.endsWith("/") ? dir + name : `${dir}/${name}`;
/** Extract a "Version:" header value from a PHP/CSS plugin/theme file. */
const matchVersion = (text: string) => text.match(/^\s*\*?\s*Version:\s*(.+)$/im)?.[1].trim();
/** Unix permission string "world" bits (last triad: r w x). */
const worldReadable = (p?: string) => !!p && p.length >= 10 && p[7] === "r";
const worldWritable = (p?: string) => !!p && p.length >= 10 && p[8] === "w";

/** Best-effort plugin version from its main PHP file's header. */
async function pluginVersion(
  sessionId: string,
  pluginDir: string,
  slug: string,
): Promise<string | undefined> {
  try {
    const v = matchVersion(
      await api.readRemoteText(sessionId, joinRemote(pluginDir, `${slug}.php`), 4000),
    );
    if (v) return v;
  } catch {
    /* fall through to scanning */
  }
  try {
    const files = (await api.listRemote(sessionId, pluginDir))
      .filter((e) => e.kind !== "directory" && e.name.endsWith(".php"))
      .slice(0, 5);
    for (const f of files) {
      try {
        const txt = await api.readRemoteText(sessionId, joinRemote(pluginDir, f.name), 4000);
        if (/Plugin Name:/i.test(txt)) {
          const v = matchVersion(txt);
          if (v) return v;
        }
      } catch {
        /* ignore unreadable file */
      }
    }
  } catch {
    /* ignore unlistable dir */
  }
  return undefined;
}

/**
 * Heuristic WordPress security inventory over SFTP: core version, plugin/theme
 * versions, and exposed/over-permissive files. Returns evidence text for the model
 * to reason over against known CVEs. (Not an authoritative scanner.)
 */
async function wordpressAudit(sessionId: string, rootArg: string): Promise<string> {
  const root = rootArg.replace(/\/+$/, "");
  const at = (p: string) => (root ? root + p : p);
  let rootList: DirEntry[];
  try {
    rootList = await api.listRemote(sessionId, root || "/");
  } catch (e) {
    return `Could not list ${root || "/"}: ${e instanceof Error ? e.message : String(e)}`;
  }
  const byName = new Map(rootList.map((e) => [e.name, e]));
  if (!byName.has("wp-includes") && !byName.has("wp-config.php") && !byName.has("wp-content")) {
    return `No WordPress install detected at ${root || "/"} (no wp-includes / wp-config.php / wp-content). Pass the correct rootPath.`;
  }

  const out: string[] = [`WordPress root: ${root || "/"}`];
  const issues: string[] = [];

  try {
    const v = await api.readRemoteText(sessionId, at("/wp-includes/version.php"), 8000);
    const m = v.match(/\$wp_version\s*=\s*'([^']+)'/);
    out.push(`Core version: ${m ? m[1] : "unknown"}`);
  } catch {
    out.push("Core version: could not read wp-includes/version.php");
  }

  const cfg = byName.get("wp-config.php");
  if (cfg) {
    out.push(`wp-config.php permissions: ${cfg.permissions ?? "?"}`);
    if (worldReadable(cfg.permissions))
      issues.push(
        "wp-config.php is world-readable - database credentials and secret keys are exposed.",
      );
    if (worldWritable(cfg.permissions)) issues.push("wp-config.php is world-writable.");
  }
  for (const f of [
    "readme.html",
    "license.txt",
    "wp-config.php.bak",
    "wp-config.bak",
    ".env",
    ".git",
    "backup.zip",
    "backup.sql",
    "database.sql",
  ]) {
    if (byName.has(f)) issues.push(`Exposed file at web root: ${f}`);
  }
  for (const e of rootList)
    if (e.kind === "directory" && worldWritable(e.permissions))
      issues.push(`World-writable directory: ${e.name} (${e.permissions}).`);
  try {
    const wpc = await api.listRemote(sessionId, at("/wp-content"));
    if (wpc.some((e) => e.name === "debug.log"))
      issues.push("wp-content/debug.log present (may leak paths and errors).");
  } catch {
    /* ignore */
  }

  out.push("\nPlugins:");
  try {
    const plist = (await api.listRemote(sessionId, at("/wp-content/plugins"))).filter(
      (e) => e.kind === "directory",
    );
    const capped = plist.slice(0, 40);
    for (const d of capped) {
      const ver = await pluginVersion(
        sessionId,
        joinRemote(at("/wp-content/plugins"), d.name),
        d.name,
      );
      out.push(`- ${d.name}: ${ver ?? "version unknown"}`);
    }
    if (plist.length > capped.length)
      out.push(`  …and ${plist.length - capped.length} more (not scanned).`);
  } catch {
    out.push("  (could not list wp-content/plugins)");
  }

  out.push("\nThemes:");
  try {
    const tlist = (await api.listRemote(sessionId, at("/wp-content/themes"))).filter(
      (e) => e.kind === "directory",
    );
    for (const d of tlist.slice(0, 20)) {
      let ver: string | undefined;
      try {
        ver = matchVersion(
          await api.readRemoteText(
            sessionId,
            joinRemote(joinRemote(at("/wp-content/themes"), d.name), "style.css"),
            4000,
          ),
        );
      } catch {
        /* ignore */
      }
      out.push(`- ${d.name}: ${ver ?? "version unknown"}`);
    }
  } catch {
    out.push("  (could not list wp-content/themes)");
  }

  out.push("\nPotential issues:");
  out.push(
    issues.length ? issues.map((i) => `- ${i}`).join("\n") : "- None obvious from file inspection.",
  );
  out.push("\n(Heuristic inventory from file inspection - compare versions against known CVEs.)");
  return out.join("\n");
}

export function AssistantPanel({
  open,
  onClose,
  onOpenSettings,
  onConnectSite,
}: AssistantPanelProps) {
  const { tabs, activeTabId, localPath } = useStore();
  const agentProvider = useSettings((s) => s.agentProvider);
  const agentModel = useSettings((s) => s.agentModel);
  const agentBaseUrl = useSettings((s) => s.agentBaseUrl);

  // Only used for human-readable "Confirm action" descriptions; executeTool reads
  // fresh state from the store at call time.
  const remotePath = tabs.find((t) => t.id === activeTabId)?.remotePath ?? "";

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  // Local files staged in the composer (NOT yet uploaded - the user says where).
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Provider-format history, kept across turns (not re-rendered).
  const convo = useRef<AgentMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Chat history (persisted to localStorage via useChats).
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  // Restore the last active chat once on mount (the panel stays mounted).
  useEffect(() => {
    const c = useChats.getState();
    const chat = c.activeId ? c.chats.find((x) => x.id === c.activeId) : null;
    if (chat) {
      setItems(chat.items);
      convo.current = chat.convo;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the active chat once a turn settles (not on every streaming step).
  useEffect(() => {
    if (busy || items.length === 0) return;
    const c = useChats.getState();
    if (!c.activeId) c.newChat();
    useChats.getState().saveActive(items, convo.current, deriveTitle(items));
  }, [items, busy]);

  // Close the history menu on any outside click.
  useEffect(() => {
    if (!showHistory) return;
    const close = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node))
        setShowHistory(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showHistory]);

  const startNewChat = () => {
    // The outgoing chat is already saved by the persist effect above.
    useChats.getState().newChat();
    convo.current = [];
    setItems([]);
    setPending(null);
    setInput("");
    setAttachments([]);
    setShowHistory(false);
  };

  const loadChat = (chat: StoredChat) => {
    useChats.getState().setActive(chat.id);
    convo.current = chat.convo;
    setItems(chat.items);
    setPending(null);
    setShowHistory(false);
  };

  // Auto-grow the composer with content, up to ~3 lines (then it scrolls).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
  }, [input]);

  // Resolve the selected provider: wire format, effective base URL, and whether
  // it's a local (keyless) server like Ollama / LM Studio.
  const info = providerById(agentProvider);
  const baseUrl = agentBaseUrl || info.baseUrl;
  const needsKey = !info.local;
  const ready = !needsKey || hasKey === true;

  useEffect(() => {
    if (!open) return;
    api
      .llmHasKey(agentProvider)
      .then(setHasKey)
      .catch(() => setHasKey(false));
  }, [open, agentProvider]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, pending]);

  const push = (item: ChatItem) => setItems((prev) => [...prev, item]);

  // --- Chain-of-thought: a single collapsible "thought" item per turn that
  // accumulates the reasoning + tool steps the model takes.
  const patchThought = (
    fn: (t: Extract<ChatItem, { kind: "thought" }>) => Extract<ChatItem, { kind: "thought" }>,
  ) =>
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const it = prev[i];
        if (it.kind === "thought" && !it.done) {
          const next = prev.slice();
          next[i] = fn(it);
          return next;
        }
      }
      return prev;
    });
  const addStep = (step: Step) => patchThought((t) => ({ ...t, steps: [...t.steps, step] }));
  const updateLastStep = (status: Step["status"], detail?: string) =>
    patchThought((t) => {
      if (!t.steps.length) return t;
      const steps = t.steps.slice();
      steps[steps.length - 1] = {
        ...steps[steps.length - 1],
        status,
        detail: detail ?? steps[steps.length - 1].detail,
      };
      return { ...t, steps };
    });
  // Finish the open thought. If it has steps, fold the final answer into it (one
  // compact card); if it's empty (the model answered with no tools), drop it (the
  // caller renders a standalone answer instead).
  const finishThought = (answer: string) =>
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].kind === "thought" && !(prev[i] as { done: boolean }).done) {
          const t = prev[i] as Extract<ChatItem, { kind: "thought" }>;
          const next = prev.slice();
          if (t.steps.length === 0) next.splice(i, 1);
          else next[i] = { ...t, done: true, answer: answer.trim() || undefined };
          return next;
        }
      }
      return prev;
    });

  // Ask the user to approve a write action; resolves true/false.
  const confirm = (description: string) =>
    new Promise<boolean>((resolve) => setPending({ description, resolve }));

  const resolvePending = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  async function executeTool(tc: ToolCall): Promise<string> {
    const a = tc.args;
    validateToolArgs(tc.name, a); // reject malformed/dangerous model-supplied args
    // Read fresh state each call so tools after connect_site see the new session.
    const st = useStore.getState();
    const tab = st.tabs.find((t) => t.id === st.activeTabId) ?? null;
    const sess = tab?.session ?? null;
    const remote = tab?.remotePath ?? "";
    const local = st.localPath ?? "";
    switch (tc.name) {
      case "get_context":
        return JSON.stringify({
          connected: !!sess,
          host: sess?.host ?? null,
          user: sess?.username ?? null,
          remotePath: remote || null,
          localPath: local || null,
        });
      case "list_sites": {
        if (st.sites.length === 0) st.setSites(await api.listSites());
        const sites = useStore.getState().sites;
        return sites.length
          ? sites
              .map((s) => `${s.name} - ${s.protocol} ${s.username}@${s.host}:${s.port}`)
              .join("\n")
          : "No saved sites yet.";
      }
      case "connect_site": {
        let sites = st.sites;
        if (sites.length === 0) {
          st.setSites(await api.listSites());
          sites = useStore.getState().sites;
        }
        const q = String(a.name).toLowerCase();
        const site =
          sites.find((s) => s.name.toLowerCase() === q) ??
          sites.find((s) => s.name.toLowerCase().includes(q)) ??
          sites.find((s) => `${s.username}@${s.host}`.toLowerCase().includes(q));
        if (!site)
          throw new ToolFailure(
            `No saved site matches "${a.name}". Use list_sites to see the names.`,
          );
        // Idempotent: if already connected to this site, just focus its tab -
        // never open a duplicate session/tab.
        const open = st.tabs.find((t) => t.siteId === site.id && t.session);
        if (open) {
          st.setActiveTab(open.id);
          return `Already connected to ${site.name} - switched to its tab (current directory ${open.session!.cwd}).`;
        }
        const res = await onConnectSite(site.id);
        const t = useStore.getState();
        const cur = t.tabs.find((x) => x.id === t.activeTabId)?.session;
        if (res.ok && cur) {
          return `Connected to ${cur.username}@${cur.host} (current directory ${cur.cwd}).`;
        }
        throw new ToolFailure(
          `Could not connect to "${site.name}": ${res.reason ?? "unknown error"}.`,
        );
      }
      case "disconnect_site": {
        const tab = st.tabs.find((t) => t.id === st.activeTabId);
        if (!tab?.session) return "No active connection to disconnect.";
        const label = `${tab.session.username}@${tab.session.host}`;
        try {
          await api.disconnect(tab.session.id);
        } catch {
          /* close the tab regardless */
        }
        st.closeTab(tab.id);
        return `Disconnected from ${label}.`;
      }
      case "open_remote_directory": {
        if (!sess)
          throw new ToolFailure("Not connected to a server. Connect first with connect_site.");
        if (!st.activeTabId) throw new ToolFailure("No active session tab.");
        // Tolerant match so e.g. "Support Custom" resolves to "support-custom".
        const { path, entries } = await resolveRemoteDir(sess.id, String(a.path));
        // Navigate the remote pane so the user actually sees the folder.
        st.updateTab(st.activeTabId, { remotePath: path, remoteEntries: entries });
        return `Opened ${path}.\n${summarize(entries)}`;
      }
      case "open_local_directory": {
        const path = String(a.path);
        const entries = await api.listLocal(path);
        st.setLocal(path, entries);
        return `Opened ${path}.\n${summarize(entries)}`;
      }
      case "list_remote_directory":
        if (!sess)
          throw new ToolFailure("Not connected to a server. Connect first with connect_site.");
        return summarize(await api.listRemote(sess.id, String(a.path)));
      case "list_local_directory":
        return summarize(await api.listLocal(String(a.path)));
      case "read_logs": {
        const since = typeof a.sinceMinutes === "number" ? a.sinceMinutes : undefined;
        const lvl = typeof a.level === "string" ? a.level : undefined;
        const cutoff = since ? Date.now() - since * 60000 : 0;
        const rows = st.logs.filter(
          (l) =>
            (!lvl || l.level === lvl) && (!cutoff || new Date(l.timestamp).getTime() >= cutoff),
        );
        return rows.length
          ? rows
              .slice(-120)
              .map((l) => `${l.timestamp} [${l.level}] ${l.scope ?? "-"} ${l.message}`)
              .join("\n")
          : "No matching log entries.";
      }
      case "list_transfers":
        return summarizeTransfers(st.transfers);
      case "read_remote_file": {
        if (!sess)
          throw new ToolFailure("Not connected to a server. Connect first with connect_site.");
        const max = typeof a.maxBytes === "number" ? a.maxBytes : 65536;
        return await api.readRemoteText(sess.id, String(a.path), max);
      }
      case "wordpress_audit": {
        if (!sess)
          throw new ToolFailure("Not connected to a server. Connect first with connect_site.");
        return await wordpressAudit(sess.id, a.rootPath ? String(a.rootPath) : remote || "/");
      }
      case "download_items": {
        if (!sess)
          throw new ToolFailure("Not connected to a server. Connect first with connect_site.");
        const dir = String(a.localDir || local);
        const paths = (a.remotePaths as string[]) ?? [];
        let n = 0;
        for (const p of paths) {
          const q = await api.enqueueDownload(sess.id, p, joinPath(dir, baseName(p)), false);
          q.forEach((t) => st.upsertTransfer(t));
          n += q.length;
        }
        return `Queued ${n} download(s) to ${dir}.`;
      }
      case "upload_items": {
        if (!sess)
          throw new ToolFailure("Not connected to a server. Connect first with connect_site.");
        const dir = String(a.remoteDir || remote);
        const paths = (a.localPaths as string[]) ?? [];
        let n = 0;
        for (const p of paths) {
          const q = await api.enqueueUpload(sess.id, p, joinPath(dir, baseName(p)));
          q.forEach((t) => st.upsertTransfer(t));
          n += q.length;
        }
        return `Queued ${n} upload(s) to ${dir}.`;
      }
      case "delete_item": {
        const path = String(a.path);
        if (a.scope === "remote") {
          if (!sess) throw new ToolFailure("Not connected to a server.");
          await api.deleteRemote(sess.id, path);
        } else {
          await api.deleteLocal(path);
        }
        return `Deleted ${path}.`;
      }
      case "create_directory": {
        const path = String(a.path);
        if (a.scope === "remote") {
          if (!sess) throw new ToolFailure("Not connected to a server.");
          await api.mkdirRemote(sess.id, path);
        } else {
          await api.mkdirLocal(path);
        }
        return `Created directory ${path}.`;
      }
      case "rename_item": {
        const from = String(a.from);
        const to = String(a.to);
        if (a.scope === "remote") {
          if (!sess) throw new ToolFailure("Not connected to a server.");
          await api.renameRemote(sess.id, from, to);
        } else {
          await api.renameLocal(from, to);
        }
        return `Renamed ${from} → ${to}.`;
      }
      case "add_site": {
        const protocol = String(a.protocol) as "sftp" | "ftp" | "ftps";
        const host = String(a.host);
        const username = a.username ? String(a.username) : "";
        const port = typeof a.port === "number" ? a.port : protocol === "sftp" ? 22 : 21;
        const name = a.name ? String(a.name) : `${username || "site"}@${host}`;
        const password = a.password ? String(a.password) : undefined;
        const defaultRemotePath = a.remotePath ? String(a.remotePath) : undefined;
        const saved = await api.saveSite(
          { name, protocol, host, port, username, logonType: "normal", defaultRemotePath },
          password,
        );
        st.setSites(await api.listSites());
        return `Saved site "${saved.name}" (${protocol} ${host}:${port}${
          defaultRemotePath ? `, path ${defaultRemotePath}` : ""
        })${password ? "" : " - no password stored; you'll be asked at connect time"}.`;
      }
      case "delete_site": {
        let sites = st.sites;
        if (sites.length === 0) {
          st.setSites(await api.listSites());
          sites = useStore.getState().sites;
        }
        const q = String(a.name).toLowerCase();
        const site =
          sites.find((s) => s.name.toLowerCase() === q) ??
          sites.find((s) => s.name.toLowerCase().includes(q)) ??
          sites.find((s) => `${s.username}@${s.host}`.toLowerCase().includes(q));
        if (!site)
          throw new ToolFailure(
            `No saved site matches "${a.name}". Use list_sites to see the names.`,
          );
        // If a live session for this site is open, disconnect and close its tab first.
        const open = st.tabs.find((t) => t.siteId === site.id && t.session);
        if (open?.session) {
          try {
            await api.disconnect(open.session.id);
          } catch {
            /* delete the saved entry regardless */
          }
          st.closeTab(open.id);
        }
        await api.deleteSite(site.id);
        st.setSites(await api.listSites());
        return `Deleted saved site "${site.name}"${open?.session ? " and disconnected its session" : ""}.`;
      }
      default:
        return `Unknown tool: ${tc.name}`;
    }
  }

  function describeWrite(tc: ToolCall): string {
    const a = tc.args;
    switch (tc.name) {
      case "download_items":
        return `Download ${((a.remotePaths as string[]) ?? []).length} item(s) to ${a.localDir || localPath}`;
      case "upload_items":
        return `Upload ${((a.localPaths as string[]) ?? []).length} item(s) to ${a.remoteDir || remotePath}`;
      case "delete_item":
        return `Delete ${a.scope} path: ${a.path}`;
      case "create_directory":
        return `Create ${a.scope} directory: ${a.path}`;
      case "rename_item":
        return `Rename ${a.scope}: ${a.from} → ${a.to}`;
      case "add_site":
        return `Add saved site "${a.name || `${a.username || "site"}@${a.host}`}" (${a.protocol} ${a.host})${
          a.password ? "" : " - no password stored"
        }`;
      case "delete_site":
        return `Delete saved site "${a.name}" from the Site Manager`;
      default:
        return tc.name;
    }
  }

  const toolSummary = (tc: ToolCall) => {
    const a = tc.args;
    const key = a.path ?? a.remotePaths ?? a.localPaths ?? a.from ?? "";
    return `${tc.name}${key ? ` ${Array.isArray(key) ? key.join(", ") : key}` : ""}`;
  };

  async function run(userText: string, attached: string[]) {
    setBusy(true);
    push({ kind: "user", text: userText });
    if (attached.length)
      push({ kind: "tool", text: `📎 attached: ${attached.map(baseName).join(", ")}` });
    // Give the model the attached local paths as context (data, not an instruction
    // to upload - it uploads only when the user says where, via upload_items).
    const note = attached.length
      ? `\n\n[Attached local files, staged for upload - upload them with upload_items(localPaths) only when I say the remote destination: ${attached.join(", ")}]`
      : "";
    convo.current.push({ role: "user", text: userText + note });
    // One collapsible chain-of-thought for this turn.
    push({ kind: "thought", steps: [], done: false });
    let finalText = "";
    let hadSteps = false;
    try {
      for (let i = 0; i < 8; i++) {
        const { url, body } = buildRequest(info.kind, agentModel, baseUrl, convo.current);
        const json = await api.llmProxy(agentProvider, url, body);
        const { text, toolCalls } = parseResponse(info.kind, json as Record<string, unknown>);
        convo.current.push({ role: "assistant", text, toolCalls });

        if (!toolCalls.length) {
          finalText = text;
          break;
        }
        // Intermediate reasoning becomes a step in the chain of thought.
        if (text.trim()) {
          addStep({ label: text.trim(), status: "done" });
          hadSteps = true;
        }

        for (const tc of toolCalls) {
          hadSteps = true;
          addStep({ label: toolSummary(tc), status: "active" });
          if (isWriteTool(tc.name)) {
            const ok = await confirm(describeWrite(tc));
            if (!ok) {
              convo.current.push({
                role: "tool",
                id: tc.id,
                name: tc.name,
                content: "User declined this action.",
              });
              updateLastStep("error", "declined");
              continue;
            }
          }
          let result: string;
          let failed = false;
          try {
            result = await executeTool(tc);
          } catch (e) {
            failed = true;
            // A ToolFailure carries a clean message; any other throw is an
            // unexpected error and gets the "Error:" prefix.
            result = e instanceof ToolFailure ? e.message : `Error: ${fmtErr(e)}`;
          }
          convo.current.push({ role: "tool", id: tc.id, name: tc.name, content: result });
          updateLastStep(failed ? "error" : "done", oneLine(result));
        }
      }
    } catch (e) {
      push({ kind: "error", text: fmtErr(e) });
    } finally {
      // Fold the final answer into the thought card; only push a standalone
      // message when the model answered directly with no steps.
      finishThought(finalText);
      if (!hadSteps && finalText.trim()) push({ kind: "assistant", text: finalText });
      setBusy(false);
    }
  }

  const send = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || pending) return;
    const atts = attachments;
    setInput("");
    setAttachments([]);
    void run(text, atts);
  };

  // Stage local files in the composer (does NOT upload). The user then tells the
  // assistant where to put them, and it uploads via the confirmed upload_items tool.
  const attachFiles = async () => {
    let files: string[] = [];
    try {
      files = await pickFiles();
    } catch {
      return;
    }
    if (!files.length) return;
    setAttachments((prev) => Array.from(new Set([...prev, ...files])));
  };
  const removeAttachment = (p: string) => setAttachments((prev) => prev.filter((x) => x !== p));

  if (!open) return null;

  return (
    <div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles size={15} className="text-accent" />
        <span className="text-sm font-semibold">Ask TurboFiles</span>
        <span
          className="ml-1 truncate text-[10px] text-subtle"
          title={`${agentProvider} · ${agentModel}`}
        >
          {agentModel || agentProvider}
        </span>
        <div className="flex-1" />
        <button
          onClick={startNewChat}
          title="New chat"
          className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
        >
          <SquarePen size={15} />
        </button>
        <div className="relative" ref={historyRef}>
          <button
            onClick={() => setShowHistory((v) => !v)}
            title="Chat history"
            className={`rounded p-1 hover:bg-muted hover:text-fg ${
              showHistory ? "bg-muted text-fg" : "text-subtle"
            }`}
          >
            <History size={15} />
          </button>
          {showHistory && (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
              {chats.length === 0 ? (
                <p className="px-3 py-2 text-xs text-subtle">No past chats yet.</p>
              ) : (
                chats.map((c) => (
                  <div key={c.id} className="group flex items-center gap-1 px-1">
                    <button
                      onClick={() => loadChat(c)}
                      className={`min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-muted ${
                        c.id === activeId ? "bg-muted" : ""
                      }`}
                    >
                      <span className="block truncate text-xs text-fg">{c.title}</span>
                      <span className="block text-[10px] text-subtle">{relTime(c.updatedAt)}</span>
                    </button>
                    <button
                      onClick={() => useChats.getState().removeChat(c.id)}
                      title="Delete chat"
                      className="shrink-0 rounded p-1 text-subtle opacity-0 hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-subtle hover:bg-muted hover:text-fg">
          <X size={15} />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3 text-sm">
        {!ready ? (
          <div className="rounded-md border border-border bg-bg p-3 text-xs text-subtle">
            <p className="mb-2 font-medium text-fg">Connect your model</p>
            <p>
              Add an API key for your provider to start - or point the provider at a local model
              (Ollama / LM Studio), which needs no key. Keys are stored in the OS keychain and never
              leave your device.
            </p>
            <button
              onClick={onOpenSettings}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-fg hover:bg-muted"
            >
              <SettingsIcon size={12} /> Open Assistant settings
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-2 pt-8 text-center">
            <BrandMark size={38} />
            <h2 className="mt-5 text-xl font-bold text-fg">Hey,</h2>
            <p className="mt-1 text-base text-fg">How can I help you?</p>
            <p className="mt-6 self-stretch text-left text-[13px] leading-relaxed text-subtle">
              I'm your TurboFiles assistant. I can help you:
            </p>
            <ul className="mt-3 w-full space-y-3.5 text-left">
              <li className="flex items-start gap-3">
                <FolderSearch size={18} className="mt-0.5 shrink-0 text-fg" />
                <span className="text-[13px] leading-snug text-fg">
                  Browse, search and open your remote files
                </span>
              </li>
              <li className="flex items-start gap-3">
                <ArrowDownUp size={18} className="mt-0.5 shrink-0 text-fg" />
                <span className="text-[13px] leading-snug text-fg">
                  Download and upload files in bulk
                </span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-fg" />
                <span className="text-[13px] leading-snug text-fg">
                  Audit sites and read logs for issues
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Plug size={18} className="mt-0.5 shrink-0 text-fg" />
                <span className="text-[13px] leading-snug text-fg">
                  Add and connect to your saved sites
                </span>
              </li>
            </ul>
            <button
              onClick={() => taRef.current?.focus()}
              className="mt-7 w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-accent-fg hover:opacity-90"
            >
              Give it a try
            </button>
          </div>
        ) : null}

        {items.map((it, idx) =>
          it.kind === "thought" ? (
            <ChainOfThought key={idx} steps={it.steps} done={it.done} answer={it.answer} />
          ) : (
            <ChatLine key={idx} item={it} />
          ),
        )}

        {pending && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-fg">
              <ShieldAlert size={13} className="text-warning" /> Confirm action
            </p>
            <p className="mt-1 text-fg">{pending.description}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => resolvePending(true)}
                className="rounded-md bg-accent px-3 py-1 font-medium text-accent-fg hover:opacity-90"
              >
                Approve
              </button>
              <button
                onClick={() => resolvePending(false)}
                className="rounded-md border border-border px-3 py-1 text-fg hover:bg-muted"
              >
                Deny
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-2.5">
        {/* Modern composer: textarea on top, a toolbar row of actions below. */}
        <div className="rounded-2xl border border-border bg-bg px-1.5 pb-1.5 pt-0.5 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1.5 pt-2">
              {attachments.map((p) => (
                <span
                  key={p}
                  title={p}
                  className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-fg"
                >
                  <Paperclip size={11} className="text-subtle" />
                  <span className="max-w-[140px] truncate">{baseName(p)}</span>
                  <button
                    onClick={() => removeAttachment(p)}
                    className="text-subtle hover:text-danger"
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={
              busy
                ? "Working…"
                : attachments.length
                  ? "Where should I upload these?"
                  : "Ask about your files…"
            }
            disabled={busy || !ready}
            className="block w-full resize-none overflow-y-auto bg-transparent px-2 pb-1 pt-2 text-sm leading-5 text-fg placeholder:text-subtle focus:outline-none disabled:opacity-60"
          />
          {/* Action toolbar */}
          <div className="flex items-center gap-1 px-0.5">
            <button
              onClick={attachFiles}
              disabled={busy}
              title="Attach files to the chat (you choose where to upload them)"
              className="flex h-8 w-8 items-center justify-center rounded-full text-subtle hover:bg-muted hover:text-fg disabled:opacity-40"
            >
              <Paperclip size={16} />
            </button>
            {busy && (
              <span className="flex items-center gap-1.5 pl-1 text-[11px] text-subtle">
                <Loader2 size={12} className="animate-spin" /> Working…
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={send}
              disabled={busy || (!input.trim() && attachments.length === 0) || !!pending}
              title="Send"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg hover:opacity-90 disabled:opacity-30"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatLine({ item }: { item: Exclude<ChatItem, { kind: "thought" }> }) {
  if (item.kind === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-1.5 text-accent-fg">
          {item.text}
        </div>
      </div>
    );
  if (item.kind === "assistant")
    return (
      <div className="max-w-[92%] whitespace-pre-wrap text-fg">
        <Markdown text={item.text} />
      </div>
    );
  if (item.kind === "error")
    return <div className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">{item.text}</div>;
  return <div className="font-mono text-[11px] text-subtle">{item.text}</div>;
}

/** Chain of thought: steps stay collapsed; a tiny bold success/failed status and
 *  the final answer sit under the header to keep each turn compact. */
function ChainOfThought({
  steps,
  done,
  answer,
}: {
  steps: Step[];
  done: boolean;
  answer?: string;
}) {
  const [open, setOpen] = useState(false); // collapsed always by default
  const failed = steps.some((s) => s.status === "error");

  const stepIcon = (s: Step["status"]) =>
    s === "active" ? (
      <Loader2 size={12} className="animate-spin text-accent" />
    ) : s === "error" ? (
      <CircleX size={12} className="text-danger" />
    ) : (
      <Check size={12} className="text-success" />
    );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-sm text-subtle hover:bg-muted/50"
      >
        {done ? (
          <Brain size={15} className="text-accent" />
        ) : (
          <Loader2 size={15} className="animate-spin text-accent" />
        )}
        <span className="font-medium text-fg">
          {done
            ? `Worked through ${steps.length} step${steps.length !== 1 ? "s" : ""}`
            : "Thinking…"}
        </span>
        <span className="flex-1" />
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-border px-3 py-2.5 text-sm">
          {steps.length === 0 ? (
            <div className="text-subtle">Working…</div>
          ) : (
            steps.map((s, i) => (
              <div key={i} className="flex gap-2">
                <span className="mt-1 shrink-0">{stepIcon(s.status)}</span>
                <div className="min-w-0">
                  <div className="break-words font-medium text-fg">{s.label}</div>
                  {s.detail && <div className="mt-0.5 line-clamp-2 text-subtle">{s.detail}</div>}
                </div>
              </div>
            ))
          )}
          {answer && (
            <div className="whitespace-pre-wrap text-fg">
              <Markdown text={answer} />
            </div>
          )}
        </div>
      )}

      {/* Glanceable outcome, always visible at the bottom-right. */}
      {done && (
        <div className="flex justify-end border-t border-border px-3 py-1">
          <span
            className={`flex items-center gap-1 text-sm font-semibold ${failed ? "text-danger" : "text-success"}`}
          >
            {failed ? <CircleX size={14} /> : <Check size={14} />}
            {failed ? "Failed" : "Successful"}
          </span>
        </div>
      )}
    </div>
  );
}

/** Minimal inline markdown: **bold**, `code`, and line breaks. No dependencies. */
function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {renderInline(line)}
        </span>
      ))}
    </>
  );
}

function renderInline(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) nodes.push(line.slice(last, m.index));
    if (m[1] != null) nodes.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] != null)
      nodes.push(
        <code key={key++} className="rounded bg-muted px-1 font-sans">
          {m[2]}
        </code>,
      );
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}
