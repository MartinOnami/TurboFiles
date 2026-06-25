import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Monitor,
  ArrowDownUp,
  ChevronDown,
  Download,
  Info,
  Moon,
  Pencil,
  Plug,
  ScrollText,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { useSettings } from "@/store/useSettings";
import { api, isTauri } from "@/lib/api";
import { LOCALES, t } from "@/lib/i18n";
import { PROVIDERS, providerById } from "@/lib/agent";
import { APP_VERSION, GITHUB_REPO, RELEASES_URL, isNewerVersion } from "@/lib/appInfo";
import changelogRaw from "../../CHANGELOG.md?raw";
import type { ReleaseInfo } from "@/lib/types";

export type SettingsCategory =
  | "interface"
  | "connection"
  | "filelists"
  | "transfers"
  | "editing"
  | "assistant"
  | "changelog"
  | "about";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Category to show when the modal opens (defaults to "interface"). */
  initialCategory?: SettingsCategory;
}

type Category = SettingsCategory;

// Labels come from i18n (`settings.<value>`); see the render below.
const CATEGORIES: { value: Category; icon: typeof Monitor }[] = [
  { value: "interface", icon: Monitor },
  { value: "connection", icon: Plug },
  { value: "filelists", icon: FileText },
  { value: "transfers", icon: ArrowDownUp },
  { value: "editing", icon: Pencil },
  { value: "assistant", icon: Sparkles },
  { value: "changelog", icon: ScrollText },
  { value: "about", icon: Info },
];

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function SettingsModal({ open, onClose, initialCategory }: SettingsModalProps) {
  const [category, setCategory] = useState<Category>(initialCategory ?? "interface");

  // Jump to the requested category each time the modal is (re)opened.
  useEffect(() => {
    if (open && initialCategory) setCategory(initialCategory);
  }, [open, initialCategory]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[min(88vh,46rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
            aria-label="Close settings"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Category list (FileZilla-style left rail) */}
          <nav className="w-40 shrink-0 overflow-y-auto border-r border-border bg-elevated p-2">
            {CATEGORIES.map(({ value, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setCategory(value)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  category === value
                    ? "bg-accent text-accent-fg"
                    : "text-subtle hover:bg-muted hover:text-fg"
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {t(`settings.${value}`)}
              </button>
            ))}
          </nav>

          {/* Active category panel */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {category === "interface" && <InterfacePanel />}
            {category === "connection" && <ConnectionPanel />}
            {category === "filelists" && <FileListsPanel />}
            {category === "transfers" && <TransfersPanel />}
            {category === "editing" && <FileEditingPanel />}
            {category === "assistant" && <AssistantSettingsPanel />}
            {category === "changelog" && <ChangelogPanel />}
            {category === "about" && <AboutPanel />}
          </div>
        </div>

        <footer className="flex justify-end border-t border-border px-4 py-2.5">
          <button
            onClick={onClose}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function InterfacePanel() {
  const { theme, setTheme } = useTheme();
  const swapPanes = useSettings((s) => s.swapPanes);
  const filesizeFormat = useSettings((s) => s.filesizeFormat);
  const doubleClickFile = useSettings((s) => s.doubleClickFile);
  const doubleClickDir = useSettings((s) => s.doubleClickDir);
  const dateTimeFormat = useSettings((s) => s.dateTimeFormat);
  const messageLogPosition = useSettings((s) => s.messageLogPosition);
  const onStartup = useSettings((s) => s.onStartup);
  const momentarySpeed = useSettings((s) => s.momentarySpeed);
  const preventSleep = useSettings((s) => s.preventSleep);
  const language = useSettings((s) => s.language);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Theme" hint="Color scheme for the application.">
        <div className="flex gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                theme === value
                  ? "border-accent bg-accent/10 text-fg"
                  : "border-border text-subtle hover:bg-muted hover:text-fg"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </Field>

      <SelectField
        label="File size format"
        value={filesizeFormat}
        options={[
          { value: "binary", label: "Binary (KiB, MiB)" },
          { value: "decimal", label: "Decimal (KB, MB)" },
        ]}
        onChange={(v) => set("filesizeFormat", v as "binary" | "decimal")}
      />
      <SelectField
        label="Double-click a file"
        value={doubleClickFile}
        options={[
          { value: "transfer", label: "Transfer" },
          { value: "none", label: "Do nothing" },
        ]}
        onChange={(v) => set("doubleClickFile", v as "transfer" | "none")}
      />
      <SelectField
        label="Double-click a folder"
        value={doubleClickDir}
        options={[
          { value: "enter", label: "Enter directory" },
          { value: "none", label: "Do nothing" },
        ]}
        onChange={(v) => set("doubleClickDir", v as "enter" | "none")}
      />
      <Toggle
        label="Swap local and remote panes"
        hint="Show the remote site on the left and the local site on the right."
        checked={swapPanes}
        onChange={(v) => set("swapPanes", v)}
      />
      <SelectField
        label={t("settings.language")}
        value={language}
        options={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
        onChange={(v) => set("language", v as "en" | "es")}
      />
      <SelectField
        label="Date/time format"
        value={dateTimeFormat}
        options={[
          { value: "short", label: "Short (24-hour)" },
          { value: "locale", label: "System locale" },
          { value: "iso", label: "ISO (HH:MM:SS)" },
        ]}
        onChange={(v) => set("dateTimeFormat", v as "locale" | "iso" | "short")}
      />
      <SelectField
        label="Message log position"
        value={messageLogPosition}
        options={[
          { value: "bottom", label: "Below the file panes" },
          { value: "top", label: "Above the file panes" },
        ]}
        onChange={(v) => set("messageLogPosition", v as "bottom" | "top")}
      />
      <SelectField
        label="On startup"
        value={onStartup}
        options={[
          { value: "restore", label: "Restore previous session" },
          { value: "site-manager", label: "Open the Site Manager" },
          { value: "empty", label: "Start with nothing open" },
        ]}
        onChange={(v) => set("onStartup", v as "restore" | "site-manager" | "empty")}
      />
      <Toggle
        label="Show momentary transfer speed"
        hint="Display the instantaneous speed instead of the session average."
        checked={momentarySpeed}
        onChange={(v) => set("momentarySpeed", v)}
      />
      <Toggle
        label="Prevent system sleep during transfers"
        hint="Keep the computer awake while transfers are active (best-effort per OS)."
        checked={preventSleep}
        onChange={(v) => set("preventSleep", v)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <span className="text-xs font-medium text-fg">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ConnectionPanel() {
  const connectionTimeout = useSettings((s) => s.connectionTimeout);
  const connectionRetries = useSettings((s) => s.connectionRetries);
  const retryDelay = useSettings((s) => s.retryDelay);
  const minTlsVersion = useSettings((s) => s.minTlsVersion);
  const sftpCompression = useSettings((s) => s.sftpCompression);
  const useSshAgent = useSettings((s) => s.useSshAgent);
  const ftpTransferMode = useSettings((s) => s.ftpTransferMode);
  const ftpKeepAlive = useSettings((s) => s.ftpKeepAlive);
  const ftpDataType = useSettings((s) => s.ftpDataType);
  const ftpProxyHost = useSettings((s) => s.ftpProxyHost);
  const ftpProxyPort = useSettings((s) => s.ftpProxyPort);
  const proxyType = useSettings((s) => s.proxyType);
  const proxyHost = useSettings((s) => s.proxyHost);
  const proxyPort = useSettings((s) => s.proxyPort);
  const proxyUser = useSettings((s) => s.proxyUser);
  const proxyPass = useSettings((s) => s.proxyPass);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Timeout (seconds)"
        hint="Give up establishing a connection after this many seconds (10-9999, 0 to disable)."
        value={connectionTimeout}
        min={0}
        max={9999}
        onChange={(v) => set("connectionTimeout", v)}
      />
      <NumberField
        label="Maximum retries"
        hint="How many times to retry a failed connection (not authentication)."
        value={connectionRetries}
        min={0}
        max={99}
        onChange={(v) => set("connectionRetries", v)}
      />
      <NumberField
        label="Delay between retries (seconds)"
        hint="Wait this long before retrying a failed connection."
        value={retryDelay}
        min={0}
        max={999}
        onChange={(v) => set("retryDelay", v)}
      />

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
        FTPS / SFTP
      </p>
      <SelectField
        label="Minimum TLS version"
        value={minTlsVersion}
        options={[
          { value: "1.0", label: "TLS 1.0" },
          { value: "1.1", label: "TLS 1.1" },
          { value: "1.2", label: "TLS 1.2 (recommended)" },
        ]}
        onChange={(v) => set("minTlsVersion", v as "1.0" | "1.1" | "1.2" | "1.3")}
      />
      <Toggle
        label="Enable SFTP compression"
        hint="Request zlib compression on SFTP connections. Helps on slow links; may slow fast ones."
        checked={sftpCompression}
        onChange={(v) => set("sftpCompression", v)}
      />
      <Toggle
        label="Use SSH agent"
        hint="Try keys loaded in the SSH agent (SSH_AUTH_SOCK) before falling back to the configured password or key."
        checked={useSshAgent}
        onChange={(v) => set("useSshAgent", v)}
      />

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">FTP</p>
      <SelectField
        label="Default transfer mode"
        value={ftpTransferMode}
        options={[
          { value: "default", label: "Default (passive)" },
          { value: "active", label: "Active" },
          { value: "passive", label: "Passive" },
        ]}
        onChange={(v) => set("ftpTransferMode", v as "default" | "active" | "passive")}
      />
      <SelectField
        label="Transfer type"
        value={ftpDataType}
        options={[
          { value: "auto", label: "Auto (by file type)" },
          { value: "ascii", label: "ASCII" },
          { value: "binary", label: "Binary" },
        ]}
        onChange={(v) => set("ftpDataType", v as "auto" | "ascii" | "binary")}
      />
      <Toggle
        label="Keep connection alive"
        hint="Send a periodic FTP NOOP so an idle control connection isn't dropped by the server."
        checked={ftpKeepAlive}
        onChange={(v) => set("ftpKeepAlive", v)}
      />
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            FTP proxy (USER user@host)
          </span>
          <input
            value={ftpProxyHost}
            onChange={(e) => set("ftpProxyHost", e.target.value)}
            className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="proxy host (plain FTP only)"
          />
        </label>
        <label className="flex w-20 flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">Port</span>
          <input
            value={String(ftpProxyPort)}
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
              set("ftpProxyPort", isNaN(n) ? 0 : n);
            }}
            className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </div>

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">Proxy</p>
      <SelectField
        label="Proxy type"
        value={proxyType}
        options={[
          { value: "none", label: "None" },
          { value: "socks4", label: "SOCKS 4" },
          { value: "socks5", label: "SOCKS 5" },
          { value: "http", label: "HTTP CONNECT" },
        ]}
        onChange={(v) => set("proxyType", v as "none" | "socks4" | "socks5" | "http")}
      />
      {proxyType !== "none" && (
        <>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                Proxy host
              </span>
              <input
                value={proxyHost}
                onChange={(e) => set("proxyHost", e.target.value)}
                className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="proxy.example.com"
              />
            </label>
            <label className="flex w-20 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                Port
              </span>
              <input
                value={String(proxyPort)}
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                  set("proxyPort", isNaN(n) ? 0 : n);
                }}
                className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                Proxy user
              </span>
              <input
                value={proxyUser}
                onChange={(e) => set("proxyUser", e.target.value)}
                className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="optional"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                Proxy password
              </span>
              <input
                type="password"
                value={proxyPass}
                onChange={(e) => set("proxyPass", e.target.value)}
                className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="not saved to disk"
              />
            </label>
          </div>
          <p className="text-[11px] text-subtle">
            The proxy password is kept in memory only and is never written to disk; you'll re-enter
            it after restarting.
          </p>
        </>
      )}
    </div>
  );
}

function FileListsPanel() {
  const showHiddenFiles = useSettings((s) => s.showHiddenFiles);
  const confirmDelete = useSettings((s) => s.confirmDelete);
  const directoryComparison = useSettings((s) => s.directoryComparison);
  const dirCompareThreshold = useSettings((s) => s.dirCompareThreshold);
  const synchronizedBrowsing = useSettings((s) => s.synchronizedBrowsing);
  const sortDirsFirst = useSettings((s) => s.sortDirsFirst);
  const nameSortCaseSensitive = useSettings((s) => s.nameSortCaseSensitive);
  const filenameFilter = useSettings((s) => s.filenameFilter);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex flex-col gap-3">
      <Toggle
        label="Show hidden files"
        hint="Display dot-files such as .env and .gitignore in both panes."
        checked={showHiddenFiles}
        onChange={(v) => set("showHiddenFiles", v)}
      />
      <Toggle
        label="Confirm before deleting"
        hint="Ask for confirmation before deleting files or folders."
        checked={confirmDelete}
        onChange={(v) => set("confirmDelete", v)}
      />
      <Toggle
        label="Directory comparison"
        hint="Highlight files that exist on only one side (green) or differ in size (amber)."
        checked={directoryComparison}
        onChange={(v) => set("directoryComparison", v)}
      />
      {directoryComparison && (
        <NumberField
          label="Size difference threshold (bytes)"
          hint="Ignore size differences at or below this many bytes when comparing (0 = exact)."
          value={dirCompareThreshold}
          min={0}
          max={1000000000}
          onChange={(v) => set("dirCompareThreshold", v)}
        />
      )}
      <Toggle
        label="Synchronized browsing"
        hint="When you enter or leave a folder in one pane, the other pane follows by name."
        checked={synchronizedBrowsing}
        onChange={(v) => set("synchronizedBrowsing", v)}
      />

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
        Sorting & filtering
      </p>
      <SelectField
        label="Sorting mode"
        value={sortDirsFirst ? "dirs" : "mixed"}
        options={[
          { value: "dirs", label: "Directories first" },
          { value: "mixed", label: "Mixed (alphabetical)" },
        ]}
        onChange={(v) => set("sortDirsFirst", v === "dirs")}
      />
      <SelectField
        label="Name sorting"
        value={nameSortCaseSensitive ? "sensitive" : "insensitive"}
        options={[
          { value: "insensitive", label: "Case-insensitive" },
          { value: "sensitive", label: "Case-sensitive" },
        ]}
        onChange={(v) => set("nameSortCaseSensitive", v === "sensitive")}
      />
      <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
        <span className="flex flex-col">
          <span className="text-xs font-medium text-fg">Filename filter</span>
          <span className="mt-0.5 text-[11px] text-subtle">
            Show only files whose name contains this text (directories always shown).
          </span>
        </span>
        <input
          value={filenameFilter}
          onChange={(e) => set("filenameFilter", e.target.value)}
          placeholder="e.g. .php"
          className="h-7 w-36 shrink-0 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
    </div>
  );
}

function TransfersPanel() {
  const overwriteDownload = useSettings((s) => s.overwriteDownload);
  const overwriteUpload = useSettings((s) => s.overwriteUpload);
  const autoOpenQueue = useSettings((s) => s.autoOpenQueue);
  const speedLimitEnabled = useSettings((s) => s.speedLimitEnabled);
  const downloadLimitKib = useSettings((s) => s.downloadLimitKib);
  const uploadLimitKib = useSettings((s) => s.uploadLimitKib);
  const speedBurstSecs = useSettings((s) => s.speedBurstSecs);
  const maxConcurrentTransfers = useSettings((s) => s.maxConcurrentTransfers);
  const preallocate = useSettings((s) => s.preallocate);
  const filenameFilterEnabled = useSettings((s) => s.filenameFilterEnabled);
  const filenameFilterChars = useSettings((s) => s.filenameFilterChars);
  const filenameReplacement = useSettings((s) => s.filenameReplacement);
  const set = useSettings((s) => s.set);
  const fileExistsOptions = [
    { value: "ask", label: "Ask for action" },
    { value: "overwrite", label: "Overwrite" },
    { value: "resume", label: "Resume" },
    { value: "rename", label: "Keep both (rename)" },
    { value: "skip", label: "Skip" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
        When a target file exists
      </p>
      <SelectField
        label="Downloads"
        value={overwriteDownload}
        options={fileExistsOptions}
        onChange={(v) => set("overwriteDownload", v as typeof overwriteDownload)}
      />
      <SelectField
        label="Uploads"
        value={overwriteUpload}
        options={fileExistsOptions}
        onChange={(v) => set("overwriteUpload", v as typeof overwriteUpload)}
      />
      <Toggle
        label="Open the queue on transfer"
        hint="Automatically reveal the Transfer Queue panel when a transfer starts."
        checked={autoOpenQueue}
        onChange={(v) => set("autoOpenQueue", v)}
      />
      <Toggle
        label="Enable speed limits"
        hint="Cap transfer throughput. Applies to transfers started after the change."
        checked={speedLimitEnabled}
        onChange={(v) => set("speedLimitEnabled", v)}
      />
      {speedLimitEnabled && (
        <>
          <NumberField
            label="Download limit (KiB/s)"
            hint="0 means no limit."
            value={downloadLimitKib}
            min={0}
            max={1000000}
            onChange={(v) => set("downloadLimitKib", v)}
          />
          <NumberField
            label="Upload limit (KiB/s)"
            hint="0 means no limit."
            value={uploadLimitKib}
            min={0}
            max={1000000}
            onChange={(v) => set("uploadLimitKib", v)}
          />
          <NumberField
            label="Burst tolerance (seconds)"
            hint="Allow a transfer to briefly exceed the limit by this many seconds' worth of data (0 = strict)."
            value={speedBurstSecs}
            min={0}
            max={30}
            onChange={(v) => set("speedBurstSecs", v)}
          />
        </>
      )}

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
        Downloaded files
      </p>
      <Toggle
        label="Preallocate space"
        hint="Reserve the full file size on disk before an SFTP download to reduce fragmentation."
        checked={preallocate}
        onChange={(v) => set("preallocate", v)}
      />
      <Toggle
        label="Filter illegal filename characters"
        hint="Replace characters that are illegal in local filenames (path separators are always replaced)."
        checked={filenameFilterEnabled}
        onChange={(v) => set("filenameFilterEnabled", v)}
      />
      {filenameFilterEnabled && (
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
              Characters to replace
            </span>
            <input
              value={filenameFilterChars}
              onChange={(e) => set("filenameFilterChars", e.target.value)}
              className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder={':*?"<>|'}
            />
          </label>
          <label className="flex w-24 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
              Replace with
            </span>
            <input
              value={filenameReplacement}
              maxLength={1}
              onChange={(e) => set("filenameReplacement", e.target.value)}
              className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="_"
            />
          </label>
        </div>
      )}
      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">
        Concurrency
      </p>
      <NumberField
        label="Max simultaneous transfers"
        hint="Transfers per session that run at once. Above 1 opens extra connections (a site's own limit, if set, still applies)."
        value={maxConcurrentTransfers}
        min={1}
        max={10}
        onChange={(v) => set("maxConcurrentTransfers", v)}
      />
      <p className="rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-subtle">
        Each session keeps one interactive connection for browsing; transfers use a pool sized by
        this limit. Different sessions always transfer in parallel.
      </p>
    </div>
  );
}

function FileEditingPanel() {
  const watchEdits = useSettings((s) => s.watchEdits);
  const confirmEditUpload = useSettings((s) => s.confirmEditUpload);
  const defaultEditor = useSettings((s) => s.defaultEditor);
  const fileAssociations = useSettings((s) => s.fileAssociations);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex flex-col gap-3">
      <Toggle
        label="Watch opened files and re-upload on save"
        hint="When you open a remote file, saving it locally re-uploads the changes to the server."
        checked={watchEdits}
        onChange={(v) => set("watchEdits", v)}
      />
      {watchEdits && (
        <Toggle
          label="Confirm before uploading edits"
          hint="When a watched file is saved, ask before uploading the new version (like FileZilla). Turn off to upload silently."
          checked={confirmEditUpload}
          onChange={(v) => set("confirmEditUpload", v)}
        />
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
          Default editor
        </span>
        <input
          value={defaultEditor}
          onChange={(e) => set("defaultEditor", e.target.value)}
          placeholder="leave empty to use the OS default app"
          className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span className="text-[11px] text-subtle">
          On macOS this is an application name (e.g. "Visual Studio Code"); elsewhere a command.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
          Filetype associations
        </span>
        <textarea
          value={fileAssociations}
          onChange={(e) => set("fileAssociations", e.target.value)}
          placeholder={"md=Typora\nconf=nano"}
          rows={4}
          className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <span className="text-[11px] text-subtle">
          One <code>extension=editor</code> per line; overrides the default editor for that type.
        </span>
      </label>
    </div>
  );
}

function AssistantSettingsPanel() {
  const agentProvider = useSettings((s) => s.agentProvider);
  const agentModel = useSettings((s) => s.agentModel);
  const agentBaseUrl = useSettings((s) => s.agentBaseUrl);
  const set = useSettings((s) => s.set);
  const [keyInput, setKeyInput] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const info = providerById(agentProvider);
  const isLocal = !!info.local;
  const baseUrl = agentBaseUrl || info.baseUrl;

  useEffect(() => {
    if (!isTauri()) return;
    api
      .llmHasKey(agentProvider)
      .then(setHasKey)
      .catch(() => setHasKey(false));
    setModels([]);
    setModelError(null);
  }, [agentProvider]);

  // Auto-fetch the model list so the picker is a real dropdown (avoids typos).
  // Waits until we know whether a key exists; local servers need none.
  useEffect(() => {
    if (!isTauri() || hasKey === null) return;
    if (isLocal || hasKey) void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentProvider, hasKey]);

  // Switching provider prefills its base URL + default model.
  const changeProvider = (id: string) => {
    const p = providerById(id);
    set("agentProvider", id);
    set("agentBaseUrl", p.baseUrl);
    if (p.defaultModel) set("agentModel", p.defaultModel);
  };

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    try {
      await api.llmSetKey(agentProvider, keyInput.trim());
      setKeyInput("");
      setHasKey(true);
    } finally {
      setSaving(false);
    }
  };
  const clearKey = async () => {
    await api.llmClearKey(agentProvider).catch(() => undefined);
    setHasKey(false);
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setModelError(null);
    try {
      const list = await api.llmListModels(agentProvider, baseUrl);
      setModels(list);
      // Only auto-fill when nothing is chosen yet - never override the user's pick.
      if (list.length > 0 && !agentModel) set("agentModel", list[0]);
    } catch (e) {
      setModelError(
        e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e),
      );
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-bg px-3 py-2 text-[11px] text-subtle">
        Each provider keeps its own API key in your OS keychain, and the call is proxied through
        TurboFiles so the key never touches the web layer. Local servers need no key.
      </div>

      <SelectField
        label="Provider"
        value={agentProvider}
        options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
        onChange={changeProvider}
      />

      {info.kind === "openai" && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            Base URL
          </span>
          <input
            value={agentBaseUrl}
            onChange={(e) => set("agentBaseUrl", e.target.value)}
            placeholder={info.baseUrl || "https://api.openai.com/v1"}
            className="h-7 rounded border border-border bg-bg px-2 font-mono text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-subtle">
          <span>Model</span>
          <button
            onClick={loadModels}
            disabled={loadingModels}
            className="rounded border border-border px-2 py-0.5 text-[10px] normal-case text-subtle hover:bg-muted hover:text-fg disabled:opacity-50"
          >
            {loadingModels ? "Loading…" : "Reload"}
          </button>
        </span>
        {models.length > 0 ? (
          <select
            value={agentModel}
            onChange={(e) => set("agentModel", e.target.value)}
            className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {agentModel && !models.includes(agentModel) && (
              <option value={agentModel}>{agentModel} (current)</option>
            )}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={agentModel}
            onChange={(e) => set("agentModel", e.target.value)}
            placeholder={info.defaultModel || "model id"}
            className="h-7 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          />
        )}
        {modelError ? (
          <span className="text-[11px] text-danger">{modelError}</span>
        ) : models.length ? (
          <span className="text-[11px] text-subtle">
            {models.length} models available. Pick one.
          </span>
        ) : loadingModels ? (
          <span className="text-[11px] text-subtle">Loading models…</span>
        ) : (
          <span className="text-[11px] text-subtle">
            Add a key (or start your local server), then models load automatically.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
          API key {hasKey ? "· stored ✓" : isLocal ? "· optional for local" : ""}
        </span>
        <div className="flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={
              hasKey
                ? "•••••••• (stored in keychain)"
                : isLocal
                  ? "leave blank for local models"
                  : `Paste your ${info.label} API key`
            }
            className="h-7 flex-1 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={saveKey}
            disabled={saving || !keyInput.trim()}
            className="rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>
          {hasKey && (
            <button
              onClick={clearKey}
              className="rounded-md border border-border px-3 text-xs text-fg hover:bg-muted"
            >
              Clear
            </button>
          )}
        </div>
      </label>
    </div>
  );
}

/** Render a line of changelog markdown: **bold**, `code`, and [text](url) links. */
function renderChangelogInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // [text](url) -> text ; **bold** ; `code`
  const re = /\[([^\]]+)\]\([^)]+\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<span key={k++}>{m[1]}</span>);
    else if (m[2] !== undefined)
      out.push(
        <strong key={k++} className="font-semibold text-fg">
          {m[2]}
        </strong>,
      );
    else if (m[3] !== undefined)
      out.push(
        <code key={k++} className="rounded bg-muted px-1 font-mono text-[11px]">
          {m[3]}
        </code>,
      );
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Render the body lines of one release (### subsections + bullets).
function renderChangelogBody(body: string[]): React.ReactNode[] {
  return body.map((line, i) => {
    if (/^###\s+/.test(line))
      return (
        <p
          key={i}
          className="mt-2.5 text-[10px] font-semibold uppercase tracking-wide text-accent first:mt-0"
        >
          {line.replace(/^###\s+/, "")}
        </p>
      );
    if (/^\s*[-*]\s+/.test(line))
      return (
        <p key={i} className="ml-1 mt-1 flex gap-1.5 text-subtle">
          <span className="text-fg">•</span>
          <span>{renderChangelogInline(line.replace(/^\s*[-*]\s+/, ""))}</span>
        </p>
      );
    if (line === "") return null;
    return (
      <p key={i} className="mt-1 text-subtle">
        {renderChangelogInline(line)}
      </p>
    );
  });
}

function ChangelogPanel() {
  // Split the changelog into one collapsible section per release ("## " heading).
  const sections = useMemo(() => {
    const out: { title: string; body: string[] }[] = [];
    let cur: { title: string; body: string[] } | null = null;
    for (const raw of changelogRaw.split("\n")) {
      const line = raw.trimEnd();
      if (/^#\s+/.test(line) && !/^##/.test(line)) continue; // skip the doc title
      const h2 = line.match(/^##\s+(.*)$/);
      if (h2) {
        cur = { title: h2[1].replace(/[[\]]/g, ""), body: [] };
        out.push(cur);
      } else if (cur) {
        cur.body.push(line);
      }
    }
    return out;
  }, []);

  // Open the running version by default, else the newest (first) release.
  const initial = Math.max(
    0,
    sections.findIndex((s) => s.title.includes(APP_VERSION)),
  );
  const [open, setOpen] = useState<number>(initial);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs text-subtle">
        <p className="font-medium text-fg">What's new</p>
        <p className="mt-0.5">
          You're running <span className="font-mono text-fg">v{APP_VERSION}</span>. Select a release
          to expand its notes.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {sections.map((s, i) => {
          const isOpen = open === i;
          const isCurrent = s.title.includes(APP_VERSION);
          return (
            <div key={i} className="overflow-hidden rounded-md border border-border bg-bg">
              <button
                onClick={() => setOpen(isOpen ? -1 : i)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                  {s.title}
                  {isCurrent && (
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                      current
                    </span>
                  )}
                </span>
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-subtle transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="border-t border-border px-3 pb-2.5 pt-1.5 text-xs leading-relaxed">
                  {renderChangelogBody(s.body)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AboutPanel() {
  const logToFile = useSettings((s) => s.logToFile);
  const logFilePath = useSettings((s) => s.logFilePath);
  const set = useSettings((s) => s.set);
  const [info, setInfo] = useState<Record<string, string> | null>(null);
  const [rel, setRel] = useState<ReleaseInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  // null = idle; 0..1 = download progress; "error" = install failed
  const [installing, setInstalling] = useState<number | "error" | null>(null);
  // true once the update is installed and only a restart remains.
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    api
      .debugInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const installUpdate = async () => {
    if (!isTauri() || installing !== null) return;
    setInstalling(0);
    try {
      // `true` means installed (we then ask the user when to restart); `false`
      // means no signed artifact yet (fall back to the releases page).
      const ok = await api.installUpdate((f) => setInstalling(f));
      if (!ok) {
        setInstalling(null);
        if (rel) await api.openPath(rel.url);
        return;
      }
      setInstalling(null);
      setInstalled(true);
      if (await api.confirmRestart(rel?.version)) {
        await api.relaunchApp();
      }
    } catch {
      setInstalling("error");
    }
  };

  const checkNow = () => {
    if (!isTauri() || checking) return;
    setChecking(true);
    api
      .checkLatestRelease(GITHUB_REPO)
      .then((r) => setRel(r))
      .catch(() => setRel(null))
      .finally(() => {
        setChecking(false);
        setChecked(true);
      });
  };

  const hasUpdate = !!rel && isNewerVersion(rel.version, APP_VERSION);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs text-subtle">
        <div className="flex items-center justify-between">
          <p className="font-medium text-fg">TurboFiles</p>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-fg">
            v{APP_VERSION}
          </span>
        </div>
        <p className="mt-0.5">
          A modern, fast and secure SFTP/FTP/FTPS client. Secrets are stored in your OS keychain -
          never on disk or in logs.
        </p>
      </div>

      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">Logging</p>
      <Toggle
        label="Log to file"
        hint="Mirror every log line to a file on disk (in addition to the in-app log)."
        checked={logToFile}
        onChange={(v) => set("logToFile", v)}
      />
      {logToFile && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
            Log file path
          </span>
          <input
            value={logFilePath}
            onChange={(e) => set("logFilePath", e.target.value)}
            placeholder="/path/to/turbofiles.log"
            className="h-7 rounded border border-border bg-bg px-2 font-mono text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      )}

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">Updates</p>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={checkNow}
            disabled={checking}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-fg hover:bg-muted disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {checked &&
            !checking &&
            (hasUpdate ? (
              <span className="text-xs font-medium text-accent">
                Version {rel!.version} is available.
              </span>
            ) : (
              <span className="text-xs text-subtle">You're on the latest version.</span>
            ))}
        </div>
        {installed && (
          <div className="flex flex-col gap-1.5 self-start">
            <button
              onClick={() => isTauri() && void api.relaunchApp()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
            >
              <Download size={13} />
              Restart now to finish
            </button>
            <span className="text-[11px] text-subtle">
              Update installed. It applies the next time you restart TurboFiles.
            </span>
          </div>
        )}
        {!installed && hasUpdate && (
          <div className="flex flex-col gap-1.5 self-start">
            <button
              onClick={() => void installUpdate()}
              disabled={typeof installing === "number"}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-70"
            >
              <Download size={13} />
              {typeof installing === "number"
                ? `Installing… ${Math.round(installing * 100)}%`
                : `Update to v${rel!.version}`}
            </button>
            {typeof installing === "number" && (
              <div className="h-1 w-44 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${Math.round(installing * 100)}%` }}
                />
              </div>
            )}
            {installing === "error" && (
              <span className="text-[11px] text-danger">
                Update failed.{" "}
                <button
                  className="underline hover:text-fg"
                  onClick={() => isTauri() && api.openPath(rel!.url).catch(() => undefined)}
                >
                  Download manually
                </button>
              </span>
            )}
          </div>
        )}
        <a
          href={RELEASES_URL}
          onClick={(e) => {
            if (isTauri()) {
              e.preventDefault();
              api.openPath(RELEASES_URL).catch(() => undefined);
            }
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-[11px] text-subtle underline hover:text-fg"
        >
          View all releases and changelog on GitHub
        </a>
      </div>

      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-subtle">Debug</p>
      <div className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-[11px] text-subtle">
        {info ? (
          Object.entries(info).map(([k, v]) => (
            <div key={k}>
              <span className="text-fg">{k}</span>: {v}
            </div>
          ))
        ) : (
          <span>Debug info is available in the desktop app.</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-fg">{label}</p>
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
      {children}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <span className="flex flex-col">
        <span className="text-xs font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 text-[11px] text-subtle">{hint}</span>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="h-7 w-20 shrink-0 rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5 hover:bg-muted/50">
      <span className="flex flex-col">
        <span className="text-xs font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 text-[11px] text-subtle">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-accent" : "bg-muted"}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </label>
  );
}
