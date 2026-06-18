import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Default action when a transfer's target file already exists. */
export type OverwriteAction = "ask" | "overwrite" | "resume" | "rename" | "skip";

/**
 * User preferences, persisted to localStorage. These are wired into the UI so
 * each toggle has a real effect (see App.tsx / FileBrowser.tsx).
 */
export interface Settings {
  /** Show dot-files (e.g. ".env") in the file browsers. */
  showHiddenFiles: boolean;
  /** Ask for confirmation before deleting a file or folder. */
  confirmDelete: boolean;
  /** Re-open the bottom panel (queue/logs) automatically when a transfer starts. */
  autoOpenQueue: boolean;
  /** Highlight differences between the local and remote panes. */
  directoryComparison: boolean;
  /** Navigate both panes together (enter/leave the same-named directory). */
  synchronizedBrowsing: boolean;
  /** TCP connect timeout in seconds. */
  connectionTimeout: number;
  /** Number of times to retry a failed connection. */
  connectionRetries: number;
  /** Delay between connection retries, in seconds. */
  retryDelay: number;
  /** Enable transfer speed limits. */
  speedLimitEnabled: boolean;
  /** Download speed cap in KiB/s (0 = unlimited). */
  downloadLimitKib: number;
  /** Upload speed cap in KiB/s (0 = unlimited). */
  uploadLimitKib: number;
  /** File size unit format: binary (KiB) or decimal (KB). */
  filesizeFormat: "binary" | "decimal";
  /** Show the remote pane on the left and local on the right. */
  swapPanes: boolean;
  /** Proxy type for the control connection. */
  proxyType: "none" | "socks4" | "socks5" | "http";
  proxyHost: string;
  proxyPort: number;
  proxyUser: string;
  /** Proxy password - kept in memory only, never persisted to disk. */
  proxyPass: string;
  /** What double-clicking a file does. */
  doubleClickFile: "transfer" | "none";
  /** What double-clicking a directory does. */
  doubleClickDir: "enter" | "none";
  /** List directories before files (vs. mixed alphabetical). */
  sortDirsFirst: boolean;
  /** Case-sensitive name sorting (vs. case-insensitive). */
  nameSortCaseSensitive: boolean;
  /** Hide files whose name doesn't contain this text (empty = show all). */
  filenameFilter: string;
  /** Default action when a download target already exists. */
  overwriteDownload: OverwriteAction;
  /** Default action when an upload target already exists. */
  overwriteUpload: OverwriteAction;
  /** Minimum TLS version accepted for FTPS connections. */
  minTlsVersion: "1.0" | "1.1" | "1.2" | "1.3";
  /** Enable zlib compression for SFTP connections. */
  sftpCompression: boolean;
  /** Try the SSH agent (SSH_AUTH_SOCK) before password/key for SFTP. */
  useSshAgent: boolean;
  /** Default FTP data-connection mode (applied when a site uses "Default"). */
  ftpTransferMode: "default" | "active" | "passive";
  /** Periodically send FTP NOOP to keep an idle control connection alive. */
  ftpKeepAlive: boolean;
  /** FTP transfer representation: auto (by type), ascii, or binary. */
  ftpDataType: "auto" | "ascii" | "binary";
  /** Legacy "USER user@host" FTP proxy host (empty = none). Plain FTP only. */
  ftpProxyHost: string;
  /** Legacy FTP proxy port (default 21). */
  ftpProxyPort: number;
  /** Preallocate the full file size on disk before an SFTP download. */
  preallocate: boolean;
  /** Replace illegal characters in downloaded filenames. */
  filenameFilterEnabled: boolean;
  /** Characters (beyond path separators/control chars) to replace in filenames. */
  filenameFilterChars: string;
  /** Replacement character for filtered filename characters. */
  filenameReplacement: string;
  /** Seconds of burst headroom the speed limiter tolerates (0 = strict). */
  speedBurstSecs: number;
  /** Maximum simultaneous transfers per session (1 = sequential). */
  maxConcurrentTransfers: number;
  /** How timestamps are rendered in logs and file lists. */
  dateTimeFormat: "locale" | "iso" | "short";
  /** Where the message log / queue panel sits relative to the file panes. */
  messageLogPosition: "bottom" | "top";
  /** What the app does on startup. */
  onStartup: "restore" | "site-manager" | "empty";
  /** Show instantaneous transfer speed instead of the session average. */
  momentarySpeed: boolean;
  /** Keep the system awake while transfers are active. */
  preventSleep: boolean;
  /** UI language. */
  language: "en" | "es";
  /** Mirror log lines to a file on disk. */
  logToFile: boolean;
  /** Path of the log file (when logToFile is on). */
  logFilePath: string;
  /** Ignore size differences below this many bytes in directory comparison. */
  dirCompareThreshold: number;
  /** Watch files opened from the remote and re-upload them when saved. */
  watchEdits: boolean;
  /** Default editor command/app for opened files (empty = OS default app). */
  defaultEditor: string;
  /** Per-extension editor overrides as "ext=command" lines (one per line). */
  fileAssociations: string;
  /** Remembered "Open With" application per lowercased file extension. */
  openWithApps: Record<string, string>;
  /** BYOK assistant: provider id (see PROVIDERS in lib/agent). */
  agentProvider: string;
  /** Model id, e.g. "claude-3-5-sonnet-latest" or "gpt-4o". */
  agentModel: string;
  /** Base URL for OpenAI-compatible providers (blank = api.openai.com). */
  agentBaseUrl: string;
  /** Whether the first-run welcome/onboarding screen has been dismissed. */
  onboardingSeen: boolean;
  /** Ids of sites the user has bookmarked. */
  bookmarks: string[];

  set: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
  toggleBookmark: (siteId: string) => void;
}

type SettingsValues = Omit<Settings, "set" | "toggleBookmark">;

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      showHiddenFiles: false,
      confirmDelete: true,
      autoOpenQueue: true,
      directoryComparison: false,
      synchronizedBrowsing: false,
      connectionTimeout: 20,
      connectionRetries: 2,
      retryDelay: 5,
      speedLimitEnabled: false,
      downloadLimitKib: 1000,
      uploadLimitKib: 100,
      filesizeFormat: "binary",
      swapPanes: false,
      doubleClickFile: "transfer",
      doubleClickDir: "enter",
      sortDirsFirst: true,
      nameSortCaseSensitive: false,
      filenameFilter: "",
      overwriteDownload: "ask",
      overwriteUpload: "ask",
      proxyType: "none",
      proxyHost: "",
      proxyPort: 1080,
      proxyUser: "",
      proxyPass: "",
      minTlsVersion: "1.2",
      sftpCompression: false,
      useSshAgent: false,
      ftpTransferMode: "default",
      ftpKeepAlive: false,
      ftpDataType: "auto",
      ftpProxyHost: "",
      ftpProxyPort: 21,
      preallocate: false,
      filenameFilterEnabled: false,
      filenameFilterChars: ':*?"<>|',
      filenameReplacement: "_",
      speedBurstSecs: 0,
      maxConcurrentTransfers: 1,
      dateTimeFormat: "short",
      messageLogPosition: "bottom",
      onStartup: "restore",
      momentarySpeed: false,
      preventSleep: false,
      language: "en",
      logToFile: false,
      logFilePath: "",
      dirCompareThreshold: 0,
      watchEdits: true,
      defaultEditor: "",
      fileAssociations: "",
      openWithApps: {},
      agentProvider: "anthropic",
      agentModel: "claude-3-5-sonnet-latest",
      agentBaseUrl: "",
      onboardingSeen: false,
      bookmarks: [],
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      toggleBookmark: (siteId) =>
        set((s) => ({
          bookmarks: s.bookmarks.includes(siteId)
            ? s.bookmarks.filter((id) => id !== siteId)
            : [...s.bookmarks, siteId],
        })),
    }),
    {
      name: "turbofiles-settings",
      // Never write the proxy password to disk (it is a secret); blank it in the
      // persisted snapshot so it only ever lives in memory.
      partialize: (s) => ({ ...s, proxyPass: "" }),
    },
  ),
);
