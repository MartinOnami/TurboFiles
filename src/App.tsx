import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  Folder,
  Lock,
  Pencil,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ConnectionBar } from "./components/ConnectionBar";
import { FileBrowser } from "./components/FileBrowser";
import { TransferQueue } from "./components/TransferQueue";
import { LogsPanel } from "./components/LogsPanel";
import { GlobalLogsPanel, GlobalQueuePanel } from "./components/GlobalPanels";
import { SettingsModal } from "./components/SettingsModal";
import { Onboarding } from "./components/Onboarding";
import { AssistantPanel } from "./components/AssistantPanel";
import {
  OverwriteDialog,
  type ConflictResolution,
  type FileConflict,
} from "./components/OverwriteDialog";
import { CertTrustDialog, type CertPrompt } from "./components/CertTrustDialog";
import {
  PasswordPromptDialog,
  type PasswordPrompt,
  type PasswordResult,
} from "./components/PasswordPromptDialog";
import { ThemeToggle } from "./components/ThemeToggle";
import { BrandMark } from "./components/BrandMark";
import { APP_VERSION, GITHUB_REPO, isNewerVersion } from "./lib/appInfo";
import {
  api,
  asApiError,
  isTauri,
  onEditorChange,
  onTransferProgress,
  pickApplication,
  pickXmlFile,
} from "./lib/api";
import { parseFileZillaSites } from "./lib/filezillaImport";
import { NEW_SITE_REQUEST, useStore } from "./store/useStore";
import { useSettings } from "./store/useSettings";
import { setByteFormat, setDateTimeFormat } from "./lib/utils";
import { setLocale } from "./lib/i18n";
import type { DirEntry, LogLevel, ReleaseInfo, Session, Site, Transfer } from "./lib/types";

import type { ConnReq } from "./components/ConnectionBar";
import { demoLocal, demoLogs, demoRemote, demoSites, demoTransfers } from "./lib/demo";

type BottomTab = "queue" | "logs";

function fmtErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err)
    return String((err as Record<string, unknown>).message);
  return String(err);
}

function cleanHost(h: string): string {
  return h
    .replace(/^(sftp|ftp|ftps|ssh):\/\//i, "")
    .replace(/\/$/, "")
    .trim();
}

function parentPath(p: string): string {
  const s = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  const idx = s.lastIndexOf("/");
  return idx <= 0 ? "/" : s.slice(0, idx);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Confirmation text shown when a server's SSH host key has changed. */
function hostKeyPrompt(host: string, message: string): string {
  return (
    `⚠ WARNING: the SSH host key for ${host} has CHANGED.\n\n${message}\n\n` +
    `This can mean the server's key was legitimately rotated, or that someone is ` +
    `intercepting your connection (man-in-the-middle). Only continue if you are sure ` +
    `the key change is expected.\n\nForget the old key and trust the new one?`
  );
}

/** Last path segment of a local or remote path. */
function baseName(p: string): string {
  const s = p.replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** Map a non-"ask" default overwrite preference to a conflict resolution. */
function defaultResolution(pref: "overwrite" | "resume" | "rename" | "skip"): ConflictResolution {
  return pref === "rename" ? { action: "keepBoth" } : { action: pref };
}

/** Derive a non-colliding name like "report (1).pdf" given the names already present. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 1;
  let candidate = `${base} (${i})${ext}`;
  while (taken.has(candidate)) candidate = `${base} (${++i})${ext}`;
  return candidate;
}

export default function App() {
  const {
    sites,
    setSites,
    localEntries,
    localPath,
    setLocal,
    transfers,
    setTransfers,
    upsertTransfer,
    logs,
    log,
    setLogs,
    tabs,
    activeTabId,
    addTab,
    closeTab,
    setActiveTab,
    updateTab,
    requestEditSite,
  } = useStore();

  // Active session derived from the store's tab list.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const session = activeTab?.session ?? null;
  const remotePath = activeTab?.remotePath ?? "";
  const remoteEntries = activeTab?.remoteEntries ?? [];

  const [bottomTab, setBottomTab] = useState<BottomTab>("queue");
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState<DirEntry | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<DirEntry | null>(null);
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const [remoteRefreshing, setRemoteRefreshing] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [busySiteId, setBusySiteId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  // Available app update (newer GitHub release than the running version), or null.
  const [update, setUpdate] = useState<ReleaseInfo | null>(null);
  // null = idle; 0..1 = in-app update download progress
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  // true once the update is installed and waiting for the user to restart.
  const [updateReady, setUpdateReady] = useState(false);
  // TEMP: always show onboarding on launch. For once-only, init from `!onboardingSeen`.
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [bottomExpanded, setBottomExpanded] = useState(true);
  // Global Logs / Queue views opened as their own closable top tabs.
  const [activePanel, setActivePanel] = useState<"logs" | "queue" | null>(null);
  const [openPanels, setOpenPanels] = useState<{ logs: boolean; queue: boolean }>({
    logs: false,
    queue: false,
  });
  // Per-tab dropdown (Edit / Delete / Disconnect) anchored to the tab caret.
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [conflict, setConflict] = useState<FileConflict | null>(null);
  const [certPrompt, setCertPrompt] = useState<CertPrompt | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const conflictResolver = useRef<((r: ConflictResolution) => void) | null>(null);
  const certResolver = useRef<((trust: boolean) => void) | null>(null);
  const passwordResolver = useRef<((r: PasswordResult | null) => void) | null>(null);

  const {
    showHiddenFiles,
    autoOpenQueue,
    directoryComparison,
    synchronizedBrowsing,
    connectionTimeout,
    connectionRetries,
    retryDelay,
    speedLimitEnabled,
    downloadLimitKib,
    uploadLimitKib,
    filesizeFormat,
    swapPanes,
    sortDirsFirst,
    nameSortCaseSensitive,
    filenameFilter,
    overwriteDownload,
    overwriteUpload,
    minTlsVersion,
    sftpCompression,
    useSshAgent,
    ftpTransferMode,
    ftpKeepAlive,
    ftpDataType,
    ftpProxyHost,
    ftpProxyPort,
    preallocate,
    filenameFilterEnabled,
    filenameFilterChars,
    filenameReplacement,
    speedBurstSecs,
    maxConcurrentTransfers,
    dateTimeFormat,
    momentarySpeed,
    preventSleep,
    messageLogPosition,
    onStartup,
    watchEdits,
    defaultEditor,
    fileAssociations,
    logToFile,
    logFilePath,
    dirCompareThreshold,
    language,
    openWithApps,
    set,
    proxyType,
    proxyHost,
    proxyPort,
    proxyUser,
    proxyPass,
  } = useSettings();
  // Apply the byte/date-format and locale preferences before any child renders.
  setByteFormat(filesizeFormat);
  setDateTimeFormat(dateTimeFormat);
  setLocale(language);
  const proxy =
    proxyType === "none" || !proxyHost
      ? undefined
      : {
          type: proxyType,
          host: proxyHost,
          port: proxyPort,
          username: proxyUser || undefined,
          password: proxyPass || undefined,
        };
  const connOpts = {
    timeoutSecs: connectionTimeout,
    retries: connectionRetries,
    retryDelaySecs: retryDelay,
    proxy,
    minTlsVersion,
    sftpCompression,
    useAgent: useSshAgent,
    ftpKeepAlive,
    ftpMode: ftpTransferMode,
    preallocate,
    maxConcurrent: maxConcurrentTransfers,
    ftpDataType,
    ftpProxyHost: ftpProxyHost || undefined,
    ftpProxyPort,
  };
  // Filename sanitizer passed to downloads when enabled.
  const downloadFilter = filenameFilterEnabled
    ? { chars: filenameFilterChars, replacement: filenameReplacement }
    : undefined;

  // Filter (hidden + name filter) and sort entries per the user's preferences.
  const processEntries = (es: DirEntry[]): DirEntry[] => {
    let out = showHiddenFiles ? es : es.filter((e) => !e.name.startsWith("."));
    const f = filenameFilter.trim().toLowerCase();
    if (f) out = out.filter((e) => e.kind === "directory" || e.name.toLowerCase().includes(f));
    const cmp = (a: string, b: string) =>
      nameSortCaseSensitive ? a.localeCompare(b) : a.toLowerCase().localeCompare(b.toLowerCase());
    return [...out].sort((a, b) => {
      if (sortDirsFirst) {
        const da = a.kind === "directory" ? 0 : 1;
        const db = b.kind === "directory" ? 0 : 1;
        if (da !== db) return da - db;
      }
      return cmp(a.name, b.name);
    });
  };
  const visibleLocal = processEntries(localEntries);
  const visibleRemote = processEntries(remoteEntries);

  const revealQueue = () => {
    setBottomTab("queue");
    setBottomExpanded(true);
  };

  // Promise-based file-conflict prompt (resolved by the OverwriteDialog buttons).
  const askConflict = (info: FileConflict) =>
    new Promise<ConflictResolution>((resolve) => {
      conflictResolver.current = resolve;
      setConflict(info);
    });
  const resolveConflict = (r: ConflictResolution) => {
    setConflict(null);
    const fn = conflictResolver.current;
    conflictResolver.current = null;
    fn?.(r);
  };

  // Promise-based certificate-trust prompt (resolved by the CertTrustDialog buttons).
  const askCertTrust = (info: CertPrompt) =>
    new Promise<boolean>((resolve) => {
      certResolver.current = resolve;
      setCertPrompt(info);
    });
  const resolveCertTrust = (trust: boolean) => {
    setCertPrompt(null);
    const fn = certResolver.current;
    certResolver.current = null;
    fn?.(trust);
  };

  // Promise-based password prompt, used when a saved site has no stored secret.
  const askPassword = (info: PasswordPrompt) =>
    new Promise<PasswordResult | null>((resolve) => {
      passwordResolver.current = resolve;
      setPasswordPrompt(info);
    });
  const resolvePassword = (r: PasswordResult | null) => {
    setPasswordPrompt(null);
    const fn = passwordResolver.current;
    passwordResolver.current = null;
    fn?.(r);
  };

  // Map of saved-site id → live session id, so the Site Manager can show which
  // sites are currently connected and offer a Disconnect action.
  const siteConnections: Record<string, string> = {};
  for (const t of tabs) {
    if (t.siteId && t.session) siteConnections[t.siteId] = t.id;
  }

  // Refs for stable reads inside async callbacks / event listeners.
  const sessionRef = useRef<Session | null>(null);
  const remotePathRef = useRef("");
  const localPathRef = useRef("");
  const activeTabIdRef = useRef<string | null>(null);
  sessionRef.current = session;
  remotePathRef.current = remotePath;
  localPathRef.current = localPath;
  activeTabIdRef.current = activeTabId;

  // Tag logs/transfers with the session they relate to, for per-site filtering.
  const sessionLabel = (s: Session | null) => (s ? `${s.username}@${s.host}` : "System");
  const addLog = (level: LogLevel, message: string, scope?: string) => {
    const entry = {
      timestamp: now(),
      level,
      message,
      scope: scope ?? sessionLabel(sessionRef.current),
    };
    log(entry);
    // Persist to durable history (fire-and-forget).
    if (isTauri()) api.appendLog(entry).catch(() => undefined);
  };

  // Open/close the global Logs & Queue top tabs (separate from session tabs).
  const openPanel = (which: "logs" | "queue") => {
    setOpenPanels((p) => ({ ...p, [which]: true }));
    setActivePanel(which);
    setShowNewMenu(false);
  };
  const closePanel = (which: "logs" | "queue") => {
    setOpenPanels((p) => ({ ...p, [which]: false }));
    setActivePanel((cur) => (cur === which ? null : cur));
  };
  const selectSessionTab = (id: string) => {
    setActivePanel(null);
    setActiveTab(id);
  };

  // Tab dropdown actions (Edit / Delete / Disconnect on a session tab).
  const tabMenuTab = tabMenu ? (tabs.find((t) => t.id === tabMenu.tabId) ?? null) : null;
  const tabEditSite = () => {
    if (tabMenuTab?.siteId) requestEditSite(tabMenuTab.siteId);
    setTabMenu(null);
  };
  const tabDeleteSite = () => {
    const siteId = tabMenuTab?.siteId;
    const tabId = tabMenuTab?.id;
    setTabMenu(null);
    if (!siteId) return;
    const site = sites.find((s) => s.id === siteId);
    if (
      !window.confirm(`Delete the saved site "${site?.name ?? siteId}"? This also disconnects it.`)
    )
      return;
    if (tabId) handleCloseTab(tabId);
    handleDeleteSite(siteId).catch((err) => addLog("error", fmtErr(err), "System"));
  };

  // Clear remote selection whenever the active tab changes.
  useEffect(() => {
    setSelectedRemote(null);
  }, [activeTabId]);

  // On launch, quietly check GitHub for a newer release. CSP-safe: the request
  // is proxied through Rust, never the renderer. Failures are ignored.
  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    void api
      .checkLatestRelease(GITHUB_REPO)
      .then((rel) => {
        if (!cancelled && rel && isNewerVersion(rel.version, APP_VERSION)) setUpdate(rel);
      })
      .catch(() => {
        /* offline / no release yet - no update shown */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One-time startup behaviour: optionally surface the connection menu.
  const didStartup = useRef(false);
  useEffect(() => {
    if (didStartup.current) return;
    didStartup.current = true;
    if (onStartup === "site-manager") setShowNewMenu(true);
  }, [onStartup]);

  // Push the log-file preference to the backend when it changes.
  useEffect(() => {
    if (!isTauri()) return;
    api.setLogFile(logToFile ? logFilePath : "").catch(() => undefined);
  }, [logToFile, logFilePath]);

  // Keep the system awake while transfers are active (when the user opted in).
  const hasActiveTransfer = transfers.some(
    (t) => t.status === "transferring" || t.status === "queued",
  );
  useEffect(() => {
    if (!isTauri()) return;
    api.setPreventSleep(preventSleep && hasActiveTransfer).catch(() => undefined);
  }, [preventSleep, hasActiveTransfer]);

  // Push speed limits to the backend whenever they change.
  useEffect(() => {
    if (!isTauri()) return;
    const dl = speedLimitEnabled ? downloadLimitKib : 0;
    const ul = speedLimitEnabled ? uploadLimitKib : 0;
    api
      .setSpeedLimits(dl, ul, speedLimitEnabled ? speedBurstSecs : 0, momentarySpeed)
      .catch(() => undefined);
  }, [speedLimitEnabled, downloadLimitKib, uploadLimitKib, speedBurstSecs, momentarySpeed]);

  // OS drag-in: dropping files/folders from Finder uploads them to the active
  // remote directory (recursively for folders).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const sess = sessionRef.current;
          if (!sess) {
            addLog("warn", "Connect to a server before dropping files to upload", "System");
            return;
          }
          const rp = remotePathRef.current;
          const scope = sessionLabel(sess);
          for (const p of event.payload.paths) {
            const dest = joinPath(rp, baseName(p));
            api
              .enqueueUpload(sess.id, p, dest)
              .then((queued) => queued.forEach((t) => upsertTransfer({ ...t, scope })))
              .catch((err) => addLog("error", fmtErr(err), scope));
          }
          addLog("info", `Uploading ${event.payload.paths.length} dropped item(s) → ${rp}`, scope);
          if (autoOpenQueue) revealQueue();
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A watched edited file was saved: confirm (FileZilla-style) then re-upload.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: Array<() => void> | undefined;
    let cancelled = false;
    onEditorChange(async ({ sessionId, remotePath, localPath }) => {
      const name = remotePath.split("/").pop() || remotePath;
      const host = useStore.getState().tabs.find((t) => t.session?.id === sessionId)?.session?.host;
      // Read the setting live so toggling it does not require re-subscribing.
      if (useSettings.getState().confirmEditUpload) {
        const ok = await api.confirmUploadEdit(name, host);
        if (!ok) {
          addLog("info", `Kept local edits to ${name}; not uploaded.`, "System");
          return;
        }
      }
      try {
        await api.uploadEditedFile(sessionId, localPath, remotePath);
        addLog("info", `Re-uploaded edited file: ${remotePath}`, "System");
        handleRefreshRemote();
      } catch (err) {
        addLog("error", `Edit re-upload failed: ${fmtErr(err)}`, "System");
      }
    })
      .then((fns) => {
        if (cancelled) fns.forEach((f) => f());
        else unlisten = fns;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the "+" new-connection menu on any outside click.
  useEffect(() => {
    if (!showNewMenu) return;
    const close = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showNewMenu]);

  // Close the per-tab dropdown on any outside click.
  useEffect(() => {
    if (!tabMenu) return;
    const close = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) setTabMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [tabMenu]);

  useEffect(() => {
    if (isTauri()) {
      api
        .listSites()
        .then(setSites)
        .catch(() => undefined);
      api
        .homeDir()
        .then((home) => api.listLocal(home).then((e) => setLocal(home, e)))
        .catch(() => undefined);
      // Restore durable history so past logs/transfers are referenceable.
      api
        .listLogs()
        .then(setLogs)
        .catch(() => undefined);
      api
        .listTransferHistory()
        .then(setTransfers)
        .catch(() => undefined);

      const TERMINAL = new Set(["completed", "failed", "cancelled"]);
      const unlisten = onTransferProgress((e) => {
        upsertTransfer(e as unknown as Transfer);
        if (TERMINAL.has(e.status)) {
          // Persist the merged record (carries name/path/scope), not the bare event.
          const merged = useStore.getState().transfers.find((t) => t.id === e.id);
          if (merged) api.recordTransfer(merged, now()).catch(() => undefined);
        }
        if (e.status === "completed") {
          const sess = sessionRef.current;
          const tabId = activeTabIdRef.current;
          if (sess && tabId) {
            api
              .listRemote(sess.id, remotePathRef.current)
              .then((ents) => updateTab(tabId, { remoteEntries: ents }))
              .catch(() => undefined);
          }
          api
            .listLocal(localPathRef.current)
            .then((ents) => setLocal(localPathRef.current, ents))
            .catch(() => undefined);
        }
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }
    // Demo mode - seed with a pre-connected session tab.
    setSites(demoSites);
    setLocal("/Users/johndoe/Documents/Projects", demoLocal);
    addTab({
      id: "demo",
      title: "demo@wpengine.com",
      session: {
        id: "demo",
        protocol: "sftp",
        host: "demo.wpengine.com",
        username: "demo",
        cwd: "/home/john_doe/public_html",
      },
      remotePath: "/home/john_doe/public_html",
      remoteEntries: demoRemote,
    });
    setTransfers(demoTransfers);
    demoLogs.forEach(log);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Session management ────────────────────────────────────────────────────

  const applySession = async (sess: Session, siteId?: string) => {
    const site = siteId ? sites.find((s) => s.id === siteId) : undefined;
    try {
      // Open the site's default remote directory if set, falling back to the
      // server's working directory when the configured path doesn't exist.
      let remotePath = site?.defaultRemotePath || sess.cwd;
      let entries: DirEntry[];
      try {
        entries = await api.listRemote(sess.id, remotePath);
      } catch {
        remotePath = sess.cwd;
        entries = await api.listRemote(sess.id, sess.cwd);
      }
      addTab({
        id: sess.id,
        title: `${sess.username}@${sess.host}`,
        session: sess,
        remotePath,
        remoteEntries: entries,
        siteId,
      });
      addLog("info", `Connected to ${sess.host} (${remotePath})`, sessionLabel(sess));
      // Open the site's default local directory in the left pane if set.
      if (site?.defaultLocalPath) {
        const dir = site.defaultLocalPath;
        api
          .listLocal(dir)
          .then((e) => setLocal(dir, e))
          .catch(() => undefined);
      }
    } catch (err) {
      addLog("error", fmtErr(err));
    }
  };

  const handleCloseTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.session && isTauri()) {
      api.disconnect(tab.session.id).catch(() => undefined);
    }
    closeTab(tabId);
  };

  const handleConnect = async (req: ConnReq, acceptInvalidCert = false) => {
    if (!isTauri()) {
      addLog("info", `Demo: connect to ${req.host}`);
      return;
    }
    setConnecting(true);
    try {
      await applySession(
        await api.connect({
          ...req,
          host: cleanHost(req.host),
          acceptInvalidCert: acceptInvalidCert || req.acceptInvalidCert,
          ...connOpts,
        }),
      );
    } catch (err) {
      const apiErr = asApiError(err);
      if (apiErr?.code === "CERT_UNTRUSTED" && !acceptInvalidCert) {
        setConnecting(false);
        const trust = await askCertTrust({ host: cleanHost(req.host), message: apiErr.message });
        if (trust) return handleConnect(req, true);
        addLog("warn", `Connection cancelled - certificate not trusted (${req.host})`, req.host);
      } else if (apiErr?.code === "HOST_KEY_MISMATCH") {
        setConnecting(false);
        if (window.confirm(hostKeyPrompt(req.host, apiErr.message))) {
          await api.forgetHostKey(cleanHost(req.host), req.port).catch(() => undefined);
          return handleConnect(req, acceptInvalidCert);
        }
        addLog("warn", `Connection blocked - SSH host key changed (${req.host})`, req.host);
      } else {
        addLog("error", fmtErr(err));
      }
    } finally {
      setConnecting(false);
    }
  };

  // Password-based logon types need a secret; key auth uses an (optional) passphrase
  // and anonymous needs none.
  const siteNeedsPassword = (s: Site) => s.logonType !== "anonymous" && s.logonType !== "key";

  // Persist a newly-entered password to the keychain by re-saving the site.
  const persistSitePassword = async (site: Site, password: string) => {
    const { id, createdAt, updatedAt, hasStoredSecret, ...rest } = site;
    void createdAt;
    void updatedAt;
    void hasStoredSecret;
    await api.saveSite({ id, ...rest } as Parameters<typeof api.saveSite>[0], password);
    setSites(await api.listSites());
  };

  type ConnectResult = { ok: boolean; reason?: string };
  const handleConnectSite = async (
    site: Site,
    acceptInvalidCert = false,
    password?: string,
    reason?: string,
    forcePrompt = false,
  ): Promise<ConnectResult> => {
    if (!isTauri()) {
      addLog("info", `Demo: connect to ${site.host}`);
      return { ok: false, reason: "demo mode" };
    }
    const scope = `${site.username}@${site.host}`;

    // Already connected to this site → focus its tab instead of opening a duplicate.
    const existing = tabs.find((t) => t.siteId === site.id && t.session);
    if (existing) {
      setActivePanel(null);
      setActiveTab(existing.id);
      return { ok: true, reason: "already connected" };
    }

    // Ask for a password when the site needs one and none is stored (or a prior
    // attempt failed). The entered password is used for this connect only, unless
    // the user opts to remember it.
    if (!password && siteNeedsPassword(site) && (forcePrompt || !site.hasStoredSecret)) {
      const res = await askPassword({ name: site.name, target: scope, reason });
      if (!res) {
        addLog("warn", `Connection cancelled - no password entered (${site.host})`, scope);
        return { ok: false, reason: "cancelled - no password entered" };
      }
      password = res.password;
      if (res.remember) await persistSitePassword(site, res.password).catch(() => undefined);
    }

    setConnecting(true);
    setBusySiteId(site.id);
    try {
      await applySession(
        await api.connectSite(site.id, acceptInvalidCert || undefined, { ...connOpts, password }),
        site.id,
      );
      return { ok: true };
    } catch (err) {
      const apiErr = asApiError(err);
      if (apiErr?.code === "CERT_UNTRUSTED" && !acceptInvalidCert) {
        setConnecting(false);
        const trust = await askCertTrust({ host: site.host, message: apiErr.message });
        if (trust) return handleConnectSite(site, true, password);
        addLog("warn", `Connection cancelled - certificate not trusted (${site.host})`, scope);
        return { ok: false, reason: "certificate not trusted" };
      } else if (apiErr?.code === "HOST_KEY_MISMATCH") {
        setConnecting(false);
        if (window.confirm(hostKeyPrompt(site.host, apiErr.message))) {
          await api.forgetHostKey(site.host, site.port).catch(() => undefined);
          return handleConnectSite(site, acceptInvalidCert, password);
        }
        addLog("warn", `Connection blocked - SSH host key changed (${site.host})`, scope);
        return { ok: false, reason: "SSH host key changed - connection blocked" };
      } else if (apiErr?.code === "AUTH" && siteNeedsPassword(site)) {
        // Wrong or missing password → ask again (forcing a prompt) and retry.
        setConnecting(false);
        return handleConnectSite(
          site,
          acceptInvalidCert,
          undefined,
          "Authentication failed. Check the password and try again.",
          true,
        );
      } else {
        addLog("error", fmtErr(err));
        return { ok: false, reason: apiErr?.message ?? fmtErr(err) };
      }
    } finally {
      setConnecting(false);
      setBusySiteId(null);
    }
  };

  // Disconnect from a Site Manager row, showing a spinner on that row while it
  // tears down (the tab id equals the session id).
  const handleDisconnectSite = async (sessionId: string, siteId?: string) => {
    if (siteId) setBusySiteId(siteId);
    try {
      if (isTauri()) await api.disconnect(sessionId).catch(() => undefined);
    } finally {
      setBusySiteId(null);
      closeTab(sessionId);
    }
  };

  const handleSaveSite: React.ComponentProps<typeof Sidebar>["onSaveSite"] = async (
    site,
    password,
  ) => {
    if (!isTauri()) return;
    try {
      const saved = await api.saveSite(site as Parameters<typeof api.saveSite>[0], password);
      setSites(await api.listSites());
      addLog("info", `Saved site: ${saved.name}`, "System");
    } catch (err) {
      const msg = fmtErr(err);
      addLog("error", `Save failed: ${msg}`, "System");
      throw err;
    }
  };

  const handleSaveFromBar = async (req: ConnReq) => {
    if (!isTauri()) return;
    setSaving(true);
    try {
      const host = cleanHost(req.host);
      const displayName =
        req.logonType === "anonymous" ? `anonymous@${host}` : `${req.username}@${host}`;
      const site = await api.saveSite(
        {
          name: displayName,
          protocol: req.protocol,
          host,
          port: req.port,
          username: req.username,
          logonType: req.logonType,
          ftpEncryption: req.ftpEncryption,
        },
        req.password || undefined,
      );
      setSites(await api.listSites());
      addLog("info", `Saved site: ${site.name}`, "System");
    } catch (err) {
      addLog("error", fmtErr(err), "System");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!isTauri()) return;
    await api.deleteSite(siteId);
    setSites(await api.listSites());
    addLog("info", "Site deleted", "System");
  };

  const handleImportFileZilla = async () => {
    if (!isTauri()) return;
    const path = await pickXmlFile();
    if (!path) return;
    try {
      const xml = await api.readKeyFile(path); // reads any UTF-8 text file
      const imported = parseFileZillaSites(xml);
      if (imported.length === 0) {
        addLog("warn", "No sites found in that file", "System");
        return;
      }
      let ok = 0;
      for (const { site, password } of imported) {
        try {
          await api.saveSite(site as Parameters<typeof api.saveSite>[0], password || undefined);
          ok++;
        } catch {
          /* skip individual failures, keep importing the rest */
        }
      }
      setSites(await api.listSites());
      addLog("info", `Imported ${ok} of ${imported.length} site(s) from FileZilla`, "System");
    } catch (err) {
      addLog("error", `Import failed: ${fmtErr(err)}`, "System");
    }
  };

  // ─── Navigation ────────────────────────────────────────────────────────────

  const navigateRemote = async (path: string) => {
    if (!session || !activeTabId) return;
    const entries = await api.listRemote(session.id, path);
    updateTab(activeTabId, { remotePath: path, remoteEntries: entries });
  };

  const navigateLocal = async (path: string) => {
    const e = await api.listLocal(path);
    setLocal(path, e);
  };

  // ── Synchronized browsing: navigate both panes by the same directory name ──
  const openLocalDir = (p: string) => {
    if (!isTauri()) return;
    navigateLocal(p).catch(() => undefined);
    if (synchronizedBrowsing && session)
      navigateRemote(joinPath(remotePath, baseName(p))).catch(() => undefined);
    setSelectedLocal(null);
  };
  const openRemoteDir = (p: string) => {
    if (!isTauri()) return;
    navigateRemote(p).catch(() => undefined);
    if (synchronizedBrowsing)
      navigateLocal(joinPath(localPath, baseName(p))).catch(() => undefined);
    setSelectedRemote(null);
  };
  const navUpLocal = () => {
    if (!isTauri() || !localPath) return;
    navigateLocal(parentPath(localPath)).catch(() => undefined);
    if (synchronizedBrowsing && session && remotePath)
      navigateRemote(parentPath(remotePath)).catch(() => undefined);
    setSelectedLocal(null);
  };
  const navUpRemote = () => {
    if (!isTauri() || !remotePath) return;
    navigateRemote(parentPath(remotePath)).catch(() => undefined);
    if (synchronizedBrowsing && localPath)
      navigateLocal(parentPath(localPath)).catch(() => undefined);
    setSelectedRemote(null);
  };

  const handleRefreshLocal = async () => {
    if (!isTauri() || !localPath) return;
    setLocalRefreshing(true);
    try {
      await navigateLocal(localPath);
    } catch (err) {
      addLog("error", fmtErr(err));
    } finally {
      setLocalRefreshing(false);
    }
  };

  // Force-refresh both panes on F5 (re-fetches listings; nothing is cached).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        handleRefreshLocal();
        handleRefreshRemote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleRefreshRemote = async () => {
    if (!isTauri() || !session || !remotePath || !activeTabId) return;
    setRemoteRefreshing(true);
    try {
      const entries = await api.listRemote(session.id, remotePath);
      updateTab(activeTabId, { remoteEntries: entries });
    } catch (err) {
      addLog("error", fmtErr(err));
    } finally {
      setRemoteRefreshing(false);
    }
  };

  // ─── Transfers ─────────────────────────────────────────────────────────────

  const handleUpload = async (entry?: DirEntry) => {
    const file = entry ?? selectedLocal;
    if (!isTauri() || !session || !file) return;
    const isDir = file.kind === "directory";
    let destName = file.name;
    let resume = false;
    // Single-file overwrite rules. (Directory merges resolve per-file on the
    // backend; a recursive conflict UI is a separate follow-up.)
    if (!isDir) {
      const existing = remoteEntries.find((e) => e.name === file.name && e.kind !== "directory");
      if (existing) {
        const res =
          overwriteUpload === "ask"
            ? await askConflict({
                name: file.name,
                direction: "upload",
                destLabel: "on the server",
                sourceSize: file.size,
                sourceModified: file.modified,
                destSize: existing.size,
                destModified: existing.modified,
              })
            : defaultResolution(overwriteUpload);
        if (res.action === "skip") return;
        if (res.action === "rename") destName = res.newName;
        if (res.action === "keepBoth")
          destName = uniqueName(file.name, new Set(remoteEntries.map((e) => e.name)));
        if (res.action === "resume") resume = true;
      }
    }
    const dest = joinPath(remotePath, destName);
    try {
      const scope = sessionLabel(session);
      const queued = await api.enqueueUpload(session.id, file.path, dest, resume);
      queued.forEach((t) => upsertTransfer({ ...t, scope }));
      addLog(
        "info",
        `Upload queued: ${file.name} → ${dest} (${queued.length} file${queued.length !== 1 ? "s" : ""})`,
        scope,
      );
      if (autoOpenQueue) revealQueue();
    } catch (err) {
      addLog("error", fmtErr(err));
    }
  };

  const handleDownload = async (entry?: DirEntry) => {
    const file = entry ?? selectedRemote;
    if (!isTauri() || !session || !file) return;
    const isDir = file.kind === "directory";
    let destName = file.name;
    let resume = false;
    if (!isDir) {
      const existing = localEntries.find((e) => e.name === file.name && e.kind !== "directory");
      if (existing) {
        const res =
          overwriteDownload === "ask"
            ? await askConflict({
                name: file.name,
                direction: "download",
                destLabel: "in this folder",
                sourceSize: file.size,
                sourceModified: file.modified,
                destSize: existing.size,
                destModified: existing.modified,
              })
            : defaultResolution(overwriteDownload);
        if (res.action === "skip") return;
        if (res.action === "rename") destName = res.newName;
        if (res.action === "keepBoth")
          destName = uniqueName(file.name, new Set(localEntries.map((e) => e.name)));
        if (res.action === "resume") resume = true;
      }
    }
    const dest = joinPath(localPath, destName);
    try {
      const scope = sessionLabel(session);
      const queued = await api.enqueueDownload(
        session.id,
        file.path,
        dest,
        isDir,
        resume,
        downloadFilter,
      );
      queued.forEach((t) => upsertTransfer({ ...t, scope }));
      addLog(
        "info",
        `Download queued: ${file.name} → ${dest} (${queued.length} file${queued.length !== 1 ? "s" : ""})`,
        scope,
      );
      if (autoOpenQueue) revealQueue();
    } catch (err) {
      addLog("error", fmtErr(err));
    }
  };

  const handleClearCompleted = () => {
    setTransfers(transfers.filter((t) => t.status !== "completed" && t.status !== "cancelled"));
    if (isTauri()) api.clearTransferHistory().catch(() => undefined);
  };

  const handleRetry = async (t: Transfer) => {
    if (!isTauri() || !session) return;
    try {
      // Retried items are always single files (the queue holds expanded files).
      const queued =
        t.direction === "upload"
          ? await api.enqueueUpload(session.id, t.localPath, t.remotePath)
          : await api.enqueueDownload(
              session.id,
              t.remotePath,
              t.localPath,
              false,
              false,
              downloadFilter,
            );
      const scope = t.scope ?? sessionLabel(session);
      queued.forEach((q) => upsertTransfer({ ...q, scope }));
      revealQueue();
    } catch (err) {
      addLog("error", fmtErr(err));
    }
  };

  // ─── File management ───────────────────────────────────────────────────────

  const handleDeleteLocal = async (entry: DirEntry) => {
    await api.deleteLocal(entry.path);
    await navigateLocal(localPath);
  };

  const handleDeleteRemote = async (entry: DirEntry) => {
    if (!session) return;
    await api.deleteRemote(session.id, entry.path);
    await navigateRemote(remotePath);
  };

  const handleRenameLocal = async (entry: DirEntry, newName: string) => {
    const newPath = joinPath(parentPath(entry.path), newName);
    await api.renameLocal(entry.path, newPath);
    await navigateLocal(localPath);
  };

  const handleRenameRemote = async (entry: DirEntry, newName: string) => {
    if (!session) return;
    const dir = entry.path.substring(0, entry.path.lastIndexOf("/"));
    const newPath = `${dir}/${newName}`;
    await api.renameRemote(session.id, entry.path, newPath);
    await navigateRemote(remotePath);
  };

  const handleMkdirLocal = async (parentDir: string, name: string) => {
    await api.mkdirLocal(joinPath(parentDir, name));
    await navigateLocal(localPath);
  };

  const handleMkdirRemote = async (parentDir: string, name: string) => {
    if (!session) return;
    await api.mkdirRemote(session.id, joinPath(parentDir, name));
    await navigateRemote(remotePath);
  };

  const handleRevealInFinder = (path: string) => {
    if (!isTauri()) return;
    api.revealInFinder(path).catch(() => undefined);
  };

  // Open a local file with its default OS application.
  const handleOpenLocalFile = (entry: DirEntry) => {
    if (!isTauri()) return;
    api.openPath(entry.path).catch((err) => addLog("error", fmtErr(err)));
  };

  const extOf = (name: string) =>
    name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";

  // Remember the chosen app for this file's extension so it can be offered next time.
  const rememberApp = (name: string, app: string) => {
    const ext = extOf(name);
    if (ext) set("openWithApps", { ...openWithApps, [ext]: app });
  };

  // "Open With…": open a (local) file with a chosen app. When `app` is omitted
  // the native application picker is shown first.
  const handleOpenLocalFileWith = async (entry: DirEntry, app?: string) => {
    if (!isTauri()) return;
    try {
      const chosen = app ?? (await pickApplication()) ?? undefined;
      if (!chosen) return;
      await api.openWith(entry.path, chosen);
      rememberApp(entry.name, chosen);
    } catch (err) {
      addLog("error", fmtErr(err));
    }
  };

  // "Open With…" for a remote file: download to temp, then open with the chosen app.
  const handleOpenRemoteFileWith = async (entry: DirEntry, app?: string) => {
    if (!isTauri() || !session) return;
    const scope = sessionLabel(session);
    try {
      const chosen = app ?? (await pickApplication()) ?? undefined;
      if (!chosen) return;
      addLog("info", `Opening ${entry.name}…`, scope);
      const tmp = await api.downloadToTemp(session.id, entry.path);
      await api.openWith(tmp, chosen);
      rememberApp(entry.name, chosen);
    } catch (err) {
      addLog("error", `Could not open ${entry.name}: ${fmtErr(err)}`, scope);
    }
  };

  // Resolve the editor command for a filename from per-extension associations,
  // falling back to the configured default editor (empty = OS default app).
  const resolveEditor = (name: string): string | undefined => {
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    for (const line of fileAssociations.split("\n")) {
      const [k, ...rest] = line.split("=");
      if (k.trim().toLowerCase().replace(/^\./, "") === ext && rest.length) {
        return rest.join("=").trim();
      }
    }
    return defaultEditor.trim() || undefined;
  };

  // Open a remote file. With "watch edits" on, edits are re-uploaded on save;
  // otherwise it's a one-shot download-and-open.
  const handleOpenRemoteFile = async (entry: DirEntry) => {
    if (!isTauri() || !session) return;
    const scope = sessionLabel(session);
    try {
      const editor = resolveEditor(entry.name);
      if (watchEdits) {
        addLog("info", `Editing ${entry.name} (changes re-upload on save)…`, scope);
        await api.startFileEdit(session.id, entry.path, editor);
      } else {
        addLog("info", `Opening ${entry.name}…`, scope);
        const tmp = await api.downloadToTemp(session.id, entry.path);
        await api.openPath(tmp);
      }
    } catch (err) {
      addLog("error", `Could not open ${entry.name}: ${fmtErr(err)}`, scope);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  // TEMP: onboarding shows on every launch (dismiss hides it for this session only).
  // To restore once-only: re-add `onboardingSeen` to the useSettings destructure and
  // change the condition below to `!onboardingSeen`.
  if (showOnboarding) {
    return (
      <Onboarding
        onContinue={() => {
          setShowOnboarding(false);
          set("onboardingSeen", true);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-1.5">
          <BrandMark size={20} />
          <span className="text-sm font-semibold tracking-tight">TurboFiles</span>
        </div>
        <div className="flex items-center gap-1">
          {update && (
            <button
              onClick={() => {
                // Already installed: clicking restarts to finish.
                if (updateReady) {
                  void api.relaunchApp();
                  return;
                }
                if (updateProgress !== null) return;
                setUpdateProgress(0);
                void api
                  .installUpdate((f) => setUpdateProgress(f))
                  .then(async (ok) => {
                    // ok === false/throw → no signed artifact, open the page.
                    if (!ok) {
                      setUpdateProgress(null);
                      void api.openPath(update.url);
                      return;
                    }
                    // Installed: ask whether to restart now or later.
                    setUpdateProgress(null);
                    setUpdateReady(true);
                    if (await api.confirmRestart(update.version)) {
                      void api.relaunchApp();
                    }
                  })
                  .catch(() => {
                    setUpdateProgress(null);
                    void api.openPath(update.url);
                  });
              }}
              title={
                updateReady
                  ? "Update installed - restart to finish"
                  : `Version ${update.version} is available - click to update`
              }
              className="flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-70"
              disabled={updateProgress !== null}
            >
              <Download size={14} />
              {updateReady
                ? "Restart to update"
                : updateProgress !== null
                  ? `Updating… ${Math.round(updateProgress * 100)}%`
                  : "Update available"}
            </button>
          )}
          <button
            onClick={() => setShowAssistant((v) => !v)}
            title="Ask TurboFiles"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
              showAssistant
                ? "bg-accent/15 text-accent"
                : "text-subtle hover:bg-muted hover:text-fg"
            }`}
          >
            <Sparkles size={14} /> Ask
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          onConnectSite={handleConnectSite}
          onSaveSite={handleSaveSite}
          onDeleteSite={handleDeleteSite}
          onImportFileZilla={handleImportFileZilla}
          onDisconnect={handleDisconnectSite}
          connectedSiteSessions={siteConnections}
          busySiteId={busySiteId}
          onShowQueue={() => openPanel("queue")}
          onShowLogs={() => openPanel("logs")}
          onOpenSettings={() => setShowSettings(true)}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Session tab bar - the scrollable tab strip and the "+" menu are
              siblings so the dropdown is never clipped by overflow-x-auto. */}
          <div className="flex items-end border-b border-border bg-surface pr-1 pt-2">
            <div className="flex min-w-0 flex-1 items-end gap-0 overflow-x-auto pl-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.length === 0 ? (
                <div className="flex items-center gap-2 rounded-t-md border border-b-0 border-border bg-bg px-3 py-1.5 text-xs text-subtle">
                  Not connected
                </div>
              ) : (
                tabs.map((tab) => (
                  <div
                    key={tab.id}
                    role="tab"
                    aria-selected={tab.id === activeTabId && !activePanel}
                    onClick={() => selectSessionTab(tab.id)}
                    className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors ${
                      tab.id === activeTabId && !activePanel
                        ? "border-border bg-bg text-fg"
                        : "border-transparent text-subtle hover:bg-muted hover:text-fg"
                    }`}
                  >
                    {/* Green live indicator */}
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500 shadow-[0_0_4px_1px_rgba(34,197,94,0.5)]" />
                    <span className="max-w-36 truncate">{tab.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setTabMenu({ tabId: tab.id, x: r.left, y: r.bottom + 2 });
                      }}
                      title="Tab actions"
                      className="shrink-0 rounded p-0.5 text-subtle hover:bg-muted hover:text-fg"
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(tab.id);
                      }}
                      title="Disconnect and close"
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted hover:text-fg group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))
              )}

              {/* Global Logs / Queue panel tabs - opened from the sidebar, closable. */}
              {openPanels.queue && (
                <PanelTab
                  label="Transfer Queue"
                  badge={transfers.length || undefined}
                  active={activePanel === "queue"}
                  onSelect={() => setActivePanel("queue")}
                  onClose={() => closePanel("queue")}
                />
              )}
              {openPanels.logs && (
                <PanelTab
                  label="Logs"
                  active={activePanel === "logs"}
                  onSelect={() => setActivePanel("logs")}
                  onClose={() => closePanel("logs")}
                />
              )}
            </div>

            <div className="relative ml-1 shrink-0 self-center" ref={newMenuRef}>
              <button
                onClick={() => setShowNewMenu((v) => !v)}
                title="New connection"
                className={`rounded p-1 hover:bg-muted hover:text-fg ${showNewMenu ? "bg-muted text-fg" : "text-subtle"}`}
              >
                <Plus size={15} />
              </button>

              {showNewMenu && (
                <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-border bg-surface py-1 shadow-lg">
                  <button
                    onClick={() => {
                      setShowNewMenu(false);
                      requestEditSite(NEW_SITE_REQUEST);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg hover:bg-muted"
                  >
                    <Plug size={13} className="shrink-0 text-accent" />
                    New connection…
                  </button>

                  {sites.length > 0 && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <p className="px-3 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
                        Saved sites
                      </p>
                      <div className="max-h-64 overflow-y-auto">
                        {sites.map((site) => (
                          <button
                            key={site.id}
                            onClick={() => {
                              setShowNewMenu(false);
                              setActivePanel(null);
                              handleConnectSite(site);
                            }}
                            className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                            title={`Connect to ${site.host}`}
                          >
                            <Folder size={13} className="shrink-0 text-subtle" />
                            <span className="min-w-0 flex-1 overflow-hidden">
                              <span className="block truncate text-xs text-fg">{site.name}</span>
                              <span className="block truncate text-[10px] text-subtle">
                                {site.protocol === "ftps" ? "FTP" : site.protocol.toUpperCase()} ·{" "}
                                {site.host}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Per-tab dropdown menu (Edit / Delete / Disconnect) */}
          {tabMenu && tabMenuTab && (
            <div
              ref={tabMenuRef}
              className="fixed z-50 min-w-44 rounded-md border border-border bg-surface py-1 shadow-lg"
              style={{ top: tabMenu.y, left: tabMenu.x }}
            >
              {tabMenuTab.siteId ? (
                <>
                  <MenuItem
                    onClick={tabEditSite}
                    icon={<Pencil size={12} className="text-subtle" />}
                  >
                    Edit site
                  </MenuItem>
                  <MenuItem onClick={tabDeleteSite} icon={<Trash2 size={12} />} danger>
                    Delete site
                  </MenuItem>
                  <div className="my-1 border-t border-border" />
                </>
              ) : (
                <p className="px-3 pb-1 pt-0.5 text-[10px] text-subtle">Quick-connect session</p>
              )}
              <MenuItem
                onClick={() => {
                  const id = tabMenu.tabId;
                  setTabMenu(null);
                  handleCloseTab(id);
                }}
                icon={<Unplug size={12} />}
                danger
              >
                Disconnect
              </MenuItem>
            </div>
          )}

          {activePanel === "queue" ? (
            <GlobalQueuePanel
              transfers={transfers}
              onPause={(id) => isTauri() && api.pauseTransfer(id)}
              onResume={(id) => isTauri() && api.resumeTransfer(id)}
              onCancel={(id) => isTauri() && api.cancelTransfer(id)}
              onRetry={handleRetry}
              onClearCompleted={handleClearCompleted}
            />
          ) : activePanel === "logs" ? (
            <GlobalLogsPanel logs={logs} />
          ) : (
            <>
              <ConnectionBar
                onConnect={handleConnect}
                onSave={handleSaveFromBar}
                connecting={connecting}
                saving={saving}
              />

              <div
                className={`flex min-h-0 flex-1 flex-col ${messageLogPosition === "top" ? "flex-col-reverse" : ""}`}
              >
                <div className="flex min-h-0 flex-1 gap-2 p-3">
                  <div className="flex min-w-0 flex-1" style={{ order: swapPanes ? 3 : 1 }}>
                    <FileBrowser
                      title="Local site"
                      path={localPath}
                      entries={visibleLocal}
                      selected={selectedLocal?.path}
                      isRefreshing={localRefreshing}
                      onSelect={setSelectedLocal}
                      onOpenDir={openLocalDir}
                      onNavigateUp={navUpLocal}
                      onTransfer={(e) => handleUpload(e)}
                      onRefresh={handleRefreshLocal}
                      onDelete={handleDeleteLocal}
                      onRename={handleRenameLocal}
                      onMkdir={handleMkdirLocal}
                      onRevealInFinder={handleRevealInFinder}
                      onOpenFile={handleOpenLocalFile}
                      onOpenFileWith={handleOpenLocalFileWith}
                      paneKind="local"
                      onDropEntry={(e) => handleDownload(e)}
                      compareWith={directoryComparison ? visibleRemote : undefined}
                      compareThreshold={dirCompareThreshold}
                    />
                  </div>
                  <div
                    className="flex shrink-0 flex-col items-center justify-center gap-2"
                    style={{ order: 2 }}
                  >
                    <button
                      onClick={() => handleUpload()}
                      disabled={!selectedLocal || !session}
                      className="rounded-md border border-border bg-surface p-2 text-subtle hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                      title={
                        selectedLocal
                          ? `Upload ${selectedLocal.name}${selectedLocal.kind === "directory" ? " (folder)" : ""}`
                          : "Select a local file or folder to upload"
                      }
                    >
                      <ArrowRight size={16} className={swapPanes ? "rotate-180" : ""} />
                    </button>
                    <button
                      onClick={() => handleDownload()}
                      disabled={!selectedRemote || !session}
                      className="rounded-md border border-border bg-surface p-2 text-subtle hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                      title={
                        selectedRemote
                          ? `Download ${selectedRemote.name}${selectedRemote.kind === "directory" ? " (folder)" : ""}`
                          : "Select a remote file or folder to download"
                      }
                    >
                      <ArrowRight size={16} className={swapPanes ? "" : "rotate-180"} />
                    </button>
                    <button
                      className="rounded-md border border-border bg-surface p-2 text-subtle hover:bg-muted"
                      title="Sync"
                    >
                      <ArrowLeftRight size={16} />
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-1" style={{ order: swapPanes ? 1 : 3 }}>
                    <FileBrowser
                      title="Remote site"
                      path={remotePath}
                      entries={visibleRemote}
                      remote
                      selected={selectedRemote?.path}
                      isRefreshing={remoteRefreshing}
                      onSelect={setSelectedRemote}
                      onOpenDir={openRemoteDir}
                      onNavigateUp={navUpRemote}
                      onTransfer={(e) => handleDownload(e)}
                      onRefresh={handleRefreshRemote}
                      onDelete={handleDeleteRemote}
                      onRename={handleRenameRemote}
                      onMkdir={handleMkdirRemote}
                      onOpenFile={handleOpenRemoteFile}
                      onOpenFileWith={handleOpenRemoteFileWith}
                      paneKind="remote"
                      onDropEntry={(e) => handleUpload(e)}
                      compareWith={directoryComparison ? visibleLocal : undefined}
                      compareThreshold={dirCompareThreshold}
                    />
                  </div>
                </div>

                <div
                  className={`flex flex-col border-t border-border bg-surface ${bottomExpanded ? "h-56" : "shrink-0"}`}
                >
                  <div className="flex items-center gap-4 border-b border-border px-3">
                    <TabButton
                      active={bottomExpanded && bottomTab === "queue"}
                      onClick={() => {
                        setBottomTab("queue");
                        setBottomExpanded(true);
                      }}
                    >
                      Transfer Queue
                      {transfers.length > 0 && (
                        <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[10px] text-accent-fg">
                          {transfers.length}
                        </span>
                      )}
                    </TabButton>
                    <TabButton
                      active={bottomExpanded && bottomTab === "logs"}
                      onClick={() => {
                        setBottomTab("logs");
                        setBottomExpanded(true);
                      }}
                    >
                      Logs
                    </TabButton>
                    <div className="flex-1" />
                    <button
                      onClick={() => setBottomExpanded((v) => !v)}
                      title={bottomExpanded ? "Collapse panel" : "Expand panel"}
                      className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
                    >
                      {bottomExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                    </button>
                  </div>
                  {bottomExpanded && (
                    <div className="min-h-0 flex-1">
                      {bottomTab === "queue" ? (
                        <TransferQueue
                          transfers={transfers}
                          onPause={(id) => isTauri() && api.pauseTransfer(id)}
                          onResume={(id) => isTauri() && api.resumeTransfer(id)}
                          onCancel={(id) => isTauri() && api.cancelTransfer(id)}
                          onRetry={handleRetry}
                          onClearCompleted={handleClearCompleted}
                        />
                      ) : (
                        <LogsPanel logs={logs} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
        <AssistantPanel
          open={showAssistant}
          onClose={() => setShowAssistant(false)}
          onOpenSettings={() => {
            setShowAssistant(false);
            setShowSettings(true);
          }}
          onConnectSite={async (siteId) => {
            // Read the live store, not this render's `sites` closure: the assistant
            // may have just created the site via add_site in the same run, so the
            // closed-over snapshot can be stale ("site not found" despite list_sites).
            const site = useStore.getState().sites.find((s) => s.id === siteId);
            if (!site) return { ok: false, reason: "site not found" };
            return handleConnectSite(site);
          }}
        />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-1.5 text-xs text-subtle">
        <span className="flex min-w-0 items-center gap-1.5">
          <Lock size={12} className={`shrink-0 ${session ? "text-green-500" : ""}`} />
          {session ? (
            <>
              <span className="shrink-0">
                {tabs.length} session{tabs.length !== 1 ? "s" : ""}
              </span>
              <span className="shrink-0 text-border">·</span>
              <span className="truncate" title={`${session.username}@${session.host}`}>
                {session.username}@{session.host}
              </span>
            </>
          ) : (
            "Not connected"
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          {sites.length} saved sites · Queue: {transfers.length}
        </span>
      </footer>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <OverwriteDialog conflict={conflict} onResolve={resolveConflict} />
      <CertTrustDialog prompt={certPrompt} onResolve={resolveCertTrust} />
      <PasswordPromptDialog prompt={passwordPrompt} onResolve={resolvePassword} />
    </div>
  );
}

/** A single row in a dropdown menu. */
function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
        danger ? "text-danger hover:bg-danger/10" : "text-fg hover:bg-muted"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** A closable global-panel tab (Logs / Transfer Queue) in the top tab strip. */
function PanelTab({
  label,
  badge,
  active,
  onSelect,
  onClose,
}: {
  label: string;
  badge?: number;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-border bg-bg text-fg"
          : "border-transparent text-subtle hover:bg-muted hover:text-fg"
      }`}
    >
      <span>{label}</span>
      {badge !== undefined && (
        <span className="rounded-full bg-accent px-1.5 text-[10px] text-accent-fg">{badge}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close tab"
        className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted hover:text-fg group-hover:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 py-2 text-sm ${active ? "border-accent text-fg" : "border-transparent text-subtle hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

// ISO timestamps so logs/history can be grouped by date in the timeline view.
const now = () => new Date().toISOString();
