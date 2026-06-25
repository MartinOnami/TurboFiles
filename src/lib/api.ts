/**
 * Typed bridge to the Rust backend.
 *
 * Every function here maps 1:1 to a `#[tauri::command]` in src-tauri/src/commands.
 * The full contract (parameters, return shapes, errors, events) is documented in
 * docs/API.md. All commands reject with an `ApiError` on failure.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { check as checkTauriUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type {
  ConnectionRequest,
  DirEntry,
  FtpMode,
  LogEntry,
  ProxyConfig,
  ReleaseInfo,
  Session,
  Site,
  Transfer,
  TransferProgressEvent,
} from "./types";

export interface ApiError {
  code: string;
  message: string;
}

/** Narrow an unknown caught value to an ApiError (the `{ code, message }` shape). */
export function asApiError(err: unknown): ApiError | null {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    return err as ApiError;
  }
  return null;
}

/** True when running inside the Tauri shell (false in plain browser/dev/test). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Open the native file picker to choose a private key file. Returns the
 * absolute path, or `null` if the dialog was cancelled. SSH keys are often
 * extensionless (e.g. `id_ed25519`), so "All files" is always selectable.
 */
export async function pickKeyFile(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Select private key file",
    defaultPath: defaultPath || undefined,
    filters: [
      { name: "Private keys", extensions: ["pem", "key", "ppk", "pub", "rsa", "ed25519"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

/** Open the native picker for a FileZilla `sitemanager.xml` export. */
export async function pickXmlFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Import FileZilla sites",
    filters: [
      { name: "FileZilla site manager", extensions: ["xml"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Open the native picker to choose an application to open a file with. On macOS
 * this defaults to /Applications (where `.app` bundles are selectable); on other
 * platforms the user picks an executable.
 */
export async function pickApplication(): Promise<string | null> {
  if (!isTauri()) return null;
  const isMac = navigator.userAgent.includes("Macintosh");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "Choose Application",
    defaultPath: isMac ? "/Applications" : undefined,
  });
  return typeof selected === "string" ? selected : null;
}

/** Open the native picker to choose one or more files to upload. */
export async function pickFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const selected = await open({
    multiple: true,
    directory: false,
    title: "Select files to upload",
  });
  return Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
}

/** Open the native folder picker. Returns the absolute path, or `null` if cancelled. */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    multiple: false,
    directory: true,
    title: "Select a directory",
    defaultPath: defaultPath || undefined,
  });
  return typeof selected === "string" ? selected : null;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/* ---------------------------------------------------------------- Sessions */

export const api = {
  /** Open a connection. Returns a session handle used for subsequent calls. */
  connect: (req: ConnectionRequest) => call<Session>("connect", { req }),
  /**
   * Connect to a saved site using its stored credentials.
   * Pass `acceptInvalidCert: true` to retry trusting an otherwise-invalid TLS cert.
   */
  connectSite: (
    siteId: string,
    acceptInvalidCert?: boolean,
    opts?: {
      timeoutSecs?: number;
      retries?: number;
      retryDelaySecs?: number;
      proxy?: ProxyConfig;
      minTlsVersion?: string;
      sftpCompression?: boolean;
      useAgent?: boolean;
      ftpKeepAlive?: boolean;
      ftpMode?: FtpMode;
      preallocate?: boolean;
      maxConcurrent?: number;
      ftpDataType?: string;
      ftpProxyHost?: string;
      ftpProxyPort?: number;
      /** One-shot password entered at connect time (when no secret is stored). */
      password?: string;
    },
  ) =>
    call<Session>("connect_site", {
      siteId,
      acceptInvalidCert,
      timeoutSecs: opts?.timeoutSecs,
      retries: opts?.retries,
      retryDelaySecs: opts?.retryDelaySecs,
      proxy: opts?.proxy,
      minTlsVersion: opts?.minTlsVersion,
      sftpCompression: opts?.sftpCompression,
      useAgent: opts?.useAgent,
      ftpKeepAlive: opts?.ftpKeepAlive,
      ftpMode: opts?.ftpMode,
      preallocate: opts?.preallocate,
      maxConcurrent: opts?.maxConcurrent,
      ftpDataType: opts?.ftpDataType,
      ftpProxyHost: opts?.ftpProxyHost,
      ftpProxyPort: opts?.ftpProxyPort,
      passwordOverride: opts?.password,
    }),
  /** Forget a remembered SSH host key (to re-trust a rotated key). */
  forgetHostKey: (host: string, port: number) => call<void>("forget_host_key", { host, port }),
  /** Close a session and release its connection. */
  disconnect: (sessionId: string) => call<void>("disconnect", { sessionId }),
  /** List a remote directory. */
  listRemote: (sessionId: string, path: string) =>
    call<DirEntry[]>("list_remote", { sessionId, path }),

  /* ------------------------------------------------------------ Local FS */
  listLocal: (path: string) => call<DirEntry[]>("list_local", { path }),
  /** The user's home directory, used as the default local root. */
  homeDir: () => call<string>("home_dir"),
  /** Read a private key file from the local filesystem (for SFTP Key auth). */
  readKeyFile: (path: string) => call<string>("read_key_file", { path }),

  /* ------------------------------------------------------------ Transfers */
  /** Queue an upload (file or directory tree). Returns one transfer per file. */
  enqueueUpload: (sessionId: string, localPath: string, remotePath: string, resume = false) =>
    call<Transfer[]>("enqueue_upload", { sessionId, localPath, remotePath, resume }),
  /** Queue a download (file or directory tree). Returns one transfer per file. */
  enqueueDownload: (
    sessionId: string,
    remotePath: string,
    localPath: string,
    isDirectory = false,
    resume = false,
    filter?: { chars: string; replacement: string },
  ) =>
    call<Transfer[]>("enqueue_download", {
      sessionId,
      remotePath,
      localPath,
      isDirectory,
      resume,
      filenameFilterChars: filter?.chars,
      filenameReplacement: filter?.replacement,
    }),
  /** Set global download/upload speed caps in KiB/s (0 = unlimited) + burst headroom (s). */
  setSpeedLimits: (downloadKib: number, uploadKib: number, burstSecs = 0, momentarySpeed = false) =>
    call<void>("set_speed_limits", { downloadKib, uploadKib, burstSecs, momentarySpeed }),
  /** Keep the system awake while transfers are active (best-effort per OS). */
  setPreventSleep: (active: boolean) => call<void>("set_prevent_sleep", { active }),
  pauseTransfer: (id: string) => call<void>("pause_transfer", { id }),
  resumeTransfer: (id: string) => call<void>("resume_transfer", { id }),
  cancelTransfer: (id: string) => call<void>("cancel_transfer", { id }),
  listTransfers: () => call<Transfer[]>("list_transfers"),

  /* ------------------------------------------------------ Remote FS ops */
  deleteRemote: (sessionId: string, path: string) =>
    call<void>("delete_remote", { sessionId, path }),
  renameRemote: (sessionId: string, from: string, to: string) =>
    call<void>("rename_remote", { sessionId, from, to }),
  mkdirRemote: (sessionId: string, path: string) => call<void>("mkdir_remote", { sessionId, path }),

  /* ------------------------------------------------------- Local FS ops */
  deleteLocal: (path: string) => call<void>("delete_local", { path }),
  renameLocal: (from: string, to: string) => call<void>("rename_local", { from, to }),
  mkdirLocal: (path: string) => call<void>("mkdir_local", { path }),
  revealInFinder: (path: string) => call<void>("reveal_in_finder", { path }),
  /** Open a local path with the OS default application. */
  openPath: (path: string) => call<void>("open_path", { path }),
  /** Open a local path with a specific application (the "Open With…" flow). */
  openWith: (path: string, app: string) => call<void>("open_with", { path, app }),
  /** Download a remote file to a temp dir; returns the local path for opening. */
  downloadToTemp: (sessionId: string, remotePath: string) =>
    call<string>("download_to_temp", { sessionId, remotePath }),
  /** Read a (small) remote text file's content, capped at `maxBytes` (≤ 1 MiB). */
  readRemoteText: (sessionId: string, path: string, maxBytes = 65536) =>
    call<string>("read_remote_text", { sessionId, path, maxBytes }),
  /**
   * Open a remote file for editing and watch it: each save emits `editor://changed`.
   * `editor` is an optional editor command/app (empty = OS default). Returns the
   * temp path. Listen via `onEditorChange`, then upload with `uploadEditedFile`.
   */
  startFileEdit: (sessionId: string, remotePath: string, editor?: string) =>
    call<string>("start_file_edit", { sessionId, remotePath, editor }),
  /** Upload a locally-edited temp file back to its remote path. */
  uploadEditedFile: (sessionId: string, localPath: string, remotePath: string) =>
    call<void>("upload_edited_file", { sessionId, localPath, remotePath }),
  /** Ask the user to confirm uploading a changed local file back to the server. */
  confirmUploadEdit: async (filename: string, host?: string): Promise<boolean> =>
    ask(`The file "${filename}" was changed. Upload the new version${host ? ` to ${host}` : ""}?`, {
      title: "File changed",
      kind: "info",
      okLabel: "Upload",
      cancelLabel: "Discard",
    }),

  /* ------------------------------------------------------------- History */
  /** Append a log line to durable history. */
  appendLog: (entry: LogEntry) => call<void>("append_log", { entry }),
  /** Load recent persisted log lines (oldest-first). */
  listLogs: () => call<LogEntry[]>("list_logs"),
  clearLogs: () => call<void>("clear_logs"),
  /** Enable (path) or disable (empty) mirroring logs to a file on disk. */
  setLogFile: (path: string) => call<void>("set_log_file", { path: path || null }),
  /** Diagnostic info for the Debug page (version, OS, paths, session count). */
  debugInfo: () => call<Record<string, string>>("debug_info"),
  /** Record (upsert) a finished transfer into durable history. */
  recordTransfer: (transfer: Transfer, finishedAt: string) =>
    call<void>("record_transfer", { transfer, finishedAt }),
  /** Load recent persisted transfer history (oldest-first). */
  listTransferHistory: () => call<Transfer[]>("list_transfer_history"),
  /** Purge completed/cancelled transfers from history. */
  clearTransferHistory: () => call<void>("clear_transfer_history"),

  /* --------------------------------------------------------- Assistant */
  /** Store (or clear, if empty) the BYOK API key for a provider in the keychain. */
  llmSetKey: (provider: string, key: string) => call<void>("llm_set_key", { provider, key }),
  /** Whether an API key is stored for a provider (the key is never returned). */
  llmHasKey: (provider: string) => call<boolean>("llm_has_key", { provider }),
  /** Remove the stored API key for a provider. */
  llmClearKey: (provider: string) => call<void>("llm_clear_key", { provider }),
  /** Proxy a chat-completion request, injecting the stored key server-side. */
  llmProxy: (provider: string, url: string, body: unknown) =>
    call<Record<string, unknown>>("llm_proxy", { provider, url, body }),
  /** List models available from the provider (Anthropic, OpenAI, or local Ollama/LM Studio). */
  llmListModels: (provider: string, baseUrl: string) =>
    call<string[]>("llm_list_models", { provider, baseUrl }),

  /* ------------------------------------------------------------ Updates */
  /** Latest published GitHub release for `repo` ("owner/name"), or null if none. */
  checkLatestRelease: (repo: string) => call<ReleaseInfo | null>("check_latest_release", { repo }),

  /**
   * Download and install the available signed update in-app, reporting download
   * progress as a 0..1 fraction. Resolves `true` once the update is installed
   * (the caller then asks the user whether to relaunch, via `confirmRestart` /
   * `relaunchApp`), or `false` when no signed update is available (e.g. the
   * published release has no updater artifacts yet) so callers can fall back to
   * opening the page. This no longer relaunches on its own.
   */
  installUpdate: async (onProgress?: (fraction: number) => void): Promise<boolean> => {
    const update = await checkTauriUpdate();
    if (!update) return false;
    let total = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        onProgress?.(0);
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(1, downloaded / total));
      } else if (event.event === "Finished") {
        onProgress?.(1);
      }
    });
    return true;
  },

  /**
   * Ask the user whether to restart now to finish applying an installed update.
   * Returns `true` for "Restart now", `false` for "Later".
   */
  confirmRestart: async (version?: string): Promise<boolean> => {
    return ask(
      `The update${version ? ` to v${version}` : ""} has been installed. Restart TurboFiles now to finish?`,
      { title: "Update ready", kind: "info", okLabel: "Restart now", cancelLabel: "Later" },
    );
  },

  /** Relaunch the app to finish applying an installed update. */
  relaunchApp: async (): Promise<void> => {
    await relaunch();
  },

  /* ----------------------------------------------------------- Site mgr */
  listSites: () => call<Site[]>("list_sites"),
  saveSite: (
    site: Omit<Site, "id" | "createdAt" | "updatedAt" | "hasStoredSecret">,
    secret?: string,
  ) => call<Site>("save_site", { site, secret }),
  deleteSite: (id: string) => call<void>("delete_site", { id }),
};

/* -------------------------------------------------------------- Events */

/** Subscribe to live transfer progress. Returns an unlisten function. */
export function onTransferProgress(
  handler: (e: TransferProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<TransferProgressEvent>("transfer://progress", (event) => handler(event.payload));
}

/** A watched file opened for editing was saved locally. */
export interface EditorChange {
  sessionId: string;
  remotePath: string;
  localPath: string;
}

/** Subscribe to "a watched edited file was saved" notices (`editor://changed`). */
export function onEditorChange(handler: (info: EditorChange) => void): Promise<UnlistenFn[]> {
  return Promise.all([listen<EditorChange>("editor://changed", (e) => handler(e.payload))]);
}
