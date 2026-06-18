import { useEffect, useRef, useState } from "react";
import {
  Bookmark, Check, Download, Folder, FolderOpen, ListTree, Loader2, Pencil, Plug, Plus, ScrollText,
  Search, Settings, Trash2, Unplug, X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { useSettings } from "@/store/useSettings";
import { pickDirectory, pickKeyFile } from "@/lib/api";
import type { FtpEncryption, FtpMode, LogonType, Protocol, Site } from "@/lib/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

// UI only shows sftp and ftp; "ftps" sites are loaded as ftp + encryption.
const PROTOCOLS: { value: Protocol; label: string; defaultPort: number }[] = [
  { value: "sftp", label: "SFTP – SSH File Transfer", defaultPort: 22 },
  { value: "ftp",  label: "FTP – File Transfer",      defaultPort: 21 },
];

const FTP_ENCRYPTION: { value: FtpEncryption; label: string; port: number }[] = [
  { value: "explicit_tls_if_available", label: "Use explicit FTP over TLS if available", port: 21 },
  { value: "require_explicit_tls",      label: "Require explicit FTP over TLS",          port: 21 },
  { value: "require_implicit_tls",      label: "Require implicit FTP over TLS",          port: 990 },
  { value: "plain",                     label: "Only use plain FTP (insecure) ⚠",        port: 21 },
];

const LOGON_TYPES: { value: LogonType; label: string; protocols: Protocol[] }[] = [
  { value: "normal",      label: "Normal",      protocols: ["sftp", "ftp", "ftps"] },
  { value: "anonymous",   label: "Anonymous",   protocols: ["ftp", "ftps"] },
  { value: "interactive", label: "Interactive", protocols: ["sftp"] },
  { value: "key",         label: "Key file",    protocols: ["sftp"] },
];

type EditState = {
  siteId: string | null;
  name: string;
  protocol: Protocol;
  logonType: LogonType;
  ftpEncryption: FtpEncryption;
  ftpMode: FtpMode;
  host: string;
  port: number;
  username: string;
  password: string;
  keyPath: string;
  defaultLocalPath: string;
  defaultRemotePath: string;
  /** Empty string = use the global default. */
  connectionLimit: string;
  /** Server time offset in minutes (empty = none). */
  timezoneOffsetMinutes: string;
  encoding: "auto" | "utf8";
  bypassProxy: boolean;
};

function blankEdit(): EditState {
  return {
    siteId: null, name: "", protocol: "sftp", logonType: "normal",
    ftpEncryption: "explicit_tls_if_available", ftpMode: "default",
    host: "", port: 22, username: "", password: "", keyPath: "",
    defaultLocalPath: "", defaultRemotePath: "", connectionLimit: "",
    timezoneOffsetMinutes: "", encoding: "auto", bypassProxy: false,
  };
}

function siteToEdit(s: Site): EditState {
  // Legacy "ftps" sites are shown as ftp + require_explicit_tls.
  const protocol: Protocol = s.protocol === "ftps" ? "ftp" : s.protocol;
  const ftpEncryption: FtpEncryption =
    s.ftpEncryption ??
    (s.protocol === "ftps" ? "require_explicit_tls" : "explicit_tls_if_available");
  return {
    siteId: s.id, name: s.name, protocol, logonType: s.logonType,
    ftpEncryption, ftpMode: s.ftpMode ?? "default",
    host: s.host, port: s.port, username: s.username,
    password: "", keyPath: s.privateKeyPath ?? "",
    defaultLocalPath: s.defaultLocalPath ?? "", defaultRemotePath: s.defaultRemotePath ?? "",
    connectionLimit: s.connectionLimit ? String(s.connectionLimit) : "",
    timezoneOffsetMinutes:
      s.timezoneOffsetMinutes != null ? String(s.timezoneOffsetMinutes) : "",
    encoding: s.encoding === "utf8" ? "utf8" : "auto",
    bypassProxy: s.bypassProxy ?? false,
  };
}

export interface SidebarProps {
  onConnectSite: (site: Site) => void;
  onSaveSite: (site: Omit<Site, "id" | "createdAt" | "updatedAt" | "hasStoredSecret"> & { id?: string }, password?: string) => Promise<void>;
  onDeleteSite: (siteId: string) => Promise<void>;
  /** Import sites from a FileZilla sitemanager.xml export. */
  onImportFileZilla: () => void;
  /** Disconnect a live session by its session id (siteId for spinner feedback). */
  onDisconnect: (sessionId: string, siteId?: string) => void;
  /** Map of saved-site id → live session id for currently-connected sites. */
  connectedSiteSessions: Record<string, string>;
  /** Site id currently connecting or disconnecting (shows a spinner). */
  busySiteId?: string | null;
  onShowQueue: () => void;
  onShowLogs: () => void;
  onOpenSettings: () => void;
}

type ContextMenuState = { site: Site; x: number; y: number };

export function Sidebar({
  onConnectSite, onSaveSite, onDeleteSite, onImportFileZilla,
  onDisconnect, connectedSiteSessions, busySiteId,
  onShowQueue, onShowLogs, onOpenSettings,
}: SidebarProps) {
  const sites = useStore((s) => s.sites);
  const editSiteRequest = useStore((s) => s.editSiteRequest);
  const requestEditSite = useStore((s) => s.requestEditSite);
  const bookmarks = useSettings((s) => s.bookmarks);
  const toggleBookmark = useSettings((s) => s.toggleBookmark);
  const [search, setSearch] = useState("");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disconnectOnDelete, setDisconnectOnDelete] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isBookmarked = (id: string) => bookmarks.includes(id);

  const nav = [
    {
      icon: Bookmark,
      label: bookmarksOnly ? "Show all sites" : "Show bookmarks only",
      active: bookmarksOnly,
      onClick: () => setBookmarksOnly((v) => !v),
    },
    { icon: ListTree, label: "Transfer Queue", active: false, onClick: () => { setBookmarksOnly(false); onShowQueue(); } },
    { icon: ScrollText, label: "Logs", active: false, onClick: () => { setBookmarksOnly(false); onShowLogs(); } },
    { icon: Settings, label: "Settings", active: false, onClick: () => { setBookmarksOnly(false); onOpenSettings(); } },
  ];

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  // Open the editor when another component (e.g. a session tab) requests it.
  useEffect(() => {
    if (!editSiteRequest) return;
    const site = sites.find((s) => s.id === editSiteRequest);
    if (site) { setDeleting(null); setEditing(siteToEdit(site)); }
    requestEditSite(null);
  }, [editSiteRequest, sites, requestEditSite]);

  const filtered = sites
    .filter((s) => {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.host.toLowerCase().includes(q);
    })
    .filter((s) => !bookmarksOnly || isBookmarked(s.id))
    // Bookmarked sites sort to the top, then alphabetically (sites already come sorted by name).
    .sort((a, b) => Number(isBookmarked(b.id)) - Number(isBookmarked(a.id)));

  const startEdit = (site: Site, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(null);
    setEditing(siteToEdit(site));
  };

  const startDelete = (site: Site, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(null);
    setDisconnectOnDelete(true);
    setDeleting(site.id);
  };

  const cancelEdit = () => setEditing(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      // Disconnect the live session first (if the user opted to) before removing the site.
      const sessionId = connectedSiteSessions[deleting];
      if (sessionId && disconnectOnDelete) onDisconnect(sessionId, deleting);
      await onDeleteSite(deleting);
    } finally { setSaving(false); setDeleting(null); }
  };

  const submitEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await onSaveSite(
        {
          ...(editing.siteId ? { id: editing.siteId } : {}),
          name: editing.name || `${editing.username}@${editing.host}`,
          protocol: editing.protocol,
          logonType: editing.logonType,
          ftpEncryption: editing.protocol === "ftp" ? editing.ftpEncryption : undefined,
          ftpMode: editing.protocol === "ftp" ? editing.ftpMode : undefined,
          privateKeyPath: editing.logonType === "key" ? (editing.keyPath || undefined) : undefined,
          defaultLocalPath: editing.defaultLocalPath || undefined,
          defaultRemotePath: editing.defaultRemotePath || undefined,
          connectionLimit: editing.connectionLimit ? Number(editing.connectionLimit) : undefined,
          timezoneOffsetMinutes: editing.timezoneOffsetMinutes
            ? Number(editing.timezoneOffsetMinutes)
            : undefined,
          encoding: editing.encoding === "utf8" ? "utf8" : undefined,
          bypassProxy: editing.bypassProxy || undefined,
          host: editing.host,
          port: editing.port,
          username: editing.logonType === "anonymous" ? "anonymous" : editing.username,
        },
        // For key auth the secret is the key passphrase; otherwise the password.
        editing.password || undefined,
      );
      setEditing(null);
    } finally { setSaving(false); }
  };

  const onProtoChange = (p: Protocol) => {
    if (!editing) return;
    const defaultPort = p === "sftp" ? 22
      : FTP_ENCRYPTION.find((e) => e.value === editing.ftpEncryption)?.port ?? 21;
    const validLogon = LOGON_TYPES.filter((l) => l.protocols.includes(p));
    const logonType = validLogon.find((l) => l.value === editing.logonType)
      ? editing.logonType
      : validLogon[0].value;
    setEditing({ ...editing, protocol: p, port: defaultPort, logonType });
  };

  const onEncChange = (enc: FtpEncryption) => {
    if (!editing) return;
    const encDef = FTP_ENCRYPTION.find((e) => e.value === enc)!;
    setEditing({ ...editing, ftpEncryption: enc, port: encDef.port });
  };

  const browseKey = async () => {
    const path = await pickKeyFile(editing?.keyPath);
    if (path) setEditing((e) => (e ? { ...e, keyPath: path } : e));
  };

  const browseLocalDir = async () => {
    const path = await pickDirectory(editing?.defaultLocalPath);
    if (path) setEditing((e) => (e ? { ...e, defaultLocalPath: path } : e));
  };

  const showUser = editing?.logonType !== "anonymous";
  const showPass = editing?.logonType === "normal" || editing?.logonType === "interactive";
  const showKey  = editing?.logonType === "key";
  const showEnc  = editing?.protocol === "ftp";
  const availableLogonTypes = editing
    ? LOGON_TYPES.filter((l) => l.protocols.includes(editing.protocol))
    : [];

  return (
    <aside className="flex w-60 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
      {/* Header */}
      <div className="px-3 pb-1 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Site Manager</h2>
          <div className="flex items-center gap-0.5">
            <button
              onClick={onImportFileZilla}
              className="rounded p-0.5 text-subtle hover:bg-muted hover:text-fg"
              title="Import from FileZilla (sitemanager.xml)"
            >
              <Download size={14} />
            </button>
            <button
              onClick={() => { setDeleting(null); setEditing(blankEdit()); }}
              className="rounded p-0.5 text-subtle hover:bg-muted hover:text-fg"
              title="New site"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-2">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites…"
            className="h-7 w-full rounded border border-border bg-bg pl-6 pr-2 text-xs text-fg placeholder-subtle focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Edit / Add form */}
      {editing !== null && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={cancelEdit}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-fg">{editing.siteId ? "Edit site" : "New site"}</h2>
              <button
                onClick={cancelEdit}
                title="Close"
                className="rounded p-1 text-subtle hover:bg-muted hover:text-fg"
              >
                <X size={15} />
              </button>
            </header>

            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* Connection */}
              <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
                <FormField label="Name" className="col-span-3">
                  <Input
                    className="h-7 text-xs"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="My Server"
                  />
                </FormField>

                <FormField label="Protocol">
                  <select
                    value={editing.protocol}
                    onChange={(e) => onProtoChange(e.target.value as Protocol)}
                    className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {PROTOCOLS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Port">
                  <Input
                    className="h-7 text-xs"
                    value={String(editing.port)}
                    onChange={(e) => {
                      const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                      setEditing({ ...editing, port: isNaN(n) ? editing.port : n });
                    }}
                    placeholder="22"
                  />
                </FormField>
                <FormField label="Logon Type">
                  <select
                    value={editing.logonType}
                    onChange={(e) => setEditing({ ...editing, logonType: e.target.value as LogonType })}
                    className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {availableLogonTypes.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </FormField>

                {showEnc && (
                  <FormField label="Encryption">
                    <select
                      value={editing.ftpEncryption}
                      onChange={(e) => onEncChange(e.target.value as FtpEncryption)}
                      className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {FTP_ENCRYPTION.map((e) => (
                        <option key={e.value} value={e.value}>{e.label}</option>
                      ))}
                    </select>
                  </FormField>
                )}

                {showEnc && (
                  <FormField label="Transfer mode">
                    <select
                      value={editing.ftpMode}
                      onChange={(e) => setEditing({ ...editing, ftpMode: e.target.value as FtpMode })}
                      className="h-7 w-full rounded border border-border bg-surface px-1.5 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="default">Default</option>
                      <option value="passive">Passive</option>
                      <option value="active">Active</option>
                    </select>
                  </FormField>
                )}

                <FormField label="Host / IP" className="col-span-3">
                  <Input
                    className="h-7 text-xs"
                    value={editing.host}
                    onChange={(e) => setEditing({ ...editing, host: e.target.value })}
                    placeholder="hostname or IP"
                  />
                </FormField>

                {showUser && (
                  <FormField label="Username">
                    <Input
                      className="h-7 text-xs"
                      value={editing.username}
                      onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                      placeholder="user"
                      autoComplete="username"
                    />
                  </FormField>
                )}

                {showPass && (
                  <FormField label="Password" className="col-span-2">
                    <Input
                      type="password"
                      className="h-7 text-xs"
                      value={editing.password}
                      onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                      placeholder={editing.siteId ? "leave blank to keep" : ""}
                      autoComplete="current-password"
                    />
                  </FormField>
                )}

                {showKey && (
                  <>
                    <FormField label="Key file" className="col-span-2">
                      <div className="flex gap-1">
                        <Input
                          className="h-7 min-w-0 flex-1 font-mono text-xs"
                          value={editing.keyPath}
                          onChange={(e) => setEditing({ ...editing, keyPath: e.target.value })}
                          placeholder="~/.ssh/id_ed25519"
                        />
                        <button
                          type="button"
                          onClick={browseKey}
                          title="Browse for key file"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-surface text-subtle hover:bg-muted hover:text-fg"
                        >
                          <FolderOpen size={12} />
                        </button>
                      </div>
                    </FormField>
                    <FormField label="Key passphrase">
                      <Input
                        type="password"
                        className="h-7 text-xs"
                        value={editing.password}
                        onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                        placeholder={editing.siteId ? "leave blank to keep" : "optional"}
                        autoComplete="off"
                      />
                    </FormField>
                  </>
                )}
              </div>

              {/* Advanced — default directories opened on connect, and per-site options */}
              <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 border-t border-border pt-3">
                <FormField label="Default local directory" className="col-span-2">
                  <div className="flex gap-1">
                    <Input
                      className="h-7 min-w-0 flex-1 font-mono text-xs"
                      value={editing.defaultLocalPath}
                      onChange={(e) => setEditing({ ...editing, defaultLocalPath: e.target.value })}
                      placeholder="optional"
                    />
                    <button
                      type="button"
                      onClick={browseLocalDir}
                      title="Browse for a folder"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-surface text-subtle hover:bg-muted hover:text-fg"
                    >
                      <FolderOpen size={12} />
                    </button>
                  </div>
                </FormField>
                <FormField label="Connection limit">
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    min={0}
                    max={10}
                    value={editing.connectionLimit}
                    onChange={(e) => setEditing({ ...editing, connectionLimit: e.target.value })}
                    placeholder="global default"
                  />
                </FormField>

                <FormField label="Default remote directory" className="col-span-2">
                  <Input
                    className="h-7 font-mono text-xs"
                    value={editing.defaultRemotePath}
                    onChange={(e) => setEditing({ ...editing, defaultRemotePath: e.target.value })}
                    placeholder="e.g. /public_html"
                  />
                </FormField>
                <FormField label="Filename charset">
                  <select
                    className="h-7 w-full rounded border border-border bg-bg px-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
                    value={editing.encoding}
                    onChange={(e) => setEditing({ ...editing, encoding: e.target.value as "auto" | "utf8" })}
                  >
                    <option value="auto">Autodetect</option>
                    <option value="utf8">Force UTF-8</option>
                  </select>
                </FormField>

                <FormField label="Time offset (min)">
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    min={-1440}
                    max={1440}
                    value={editing.timezoneOffsetMinutes}
                    onChange={(e) => setEditing({ ...editing, timezoneOffsetMinutes: e.target.value })}
                    placeholder="0"
                  />
                </FormField>
                <label className="col-span-2 flex items-center gap-2 self-end pb-1.5 text-xs text-fg">
                  <input
                    type="checkbox"
                    checked={editing.bypassProxy}
                    onChange={(e) => setEditing({ ...editing, bypassProxy: e.target.checked })}
                  />
                  Bypass the global proxy for this site
                </label>
              </div>
            </div>

            <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button size="sm" variant="secondary" className="px-3 text-xs" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="px-4 text-xs"
                loading={saving}
                onClick={submitEdit}
                disabled={!editing.host || (showKey && !editing.keyPath)}
              >
                <Check size={13} /> Save
              </Button>
            </footer>
          </div>
        </div>
      )}

      {/* Site list */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-xs text-subtle">
            {search ? "No sites match your search." : "No saved sites yet."}
          </p>
        )}

        {filtered.map((site) => {
          const sessionId = connectedSiteSessions[site.id];
          const connected = !!sessionId;
          const bookmarked = isBookmarked(site.id);
          const busy = busySiteId === site.id;
          return (
            <div key={site.id}>
              {deleting === site.id ? (
                <div className="mb-0.5 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="flex-1 truncate text-fg">Delete "{site.name}"?</span>
                    <button
                      onClick={confirmDelete}
                      disabled={saving}
                      className="rounded px-1.5 py-0.5 text-danger hover:bg-danger/10 disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeleting(null)}
                      className="rounded px-1.5 py-0.5 text-subtle hover:bg-muted"
                    >
                      No
                    </button>
                  </div>
                  {connected && (
                    <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-subtle">
                      <input
                        type="checkbox"
                        checked={disconnectOnDelete}
                        onChange={(e) => setDisconnectOnDelete(e.target.checked)}
                        className="h-3 w-3"
                      />
                      It's connected — disconnect the session too
                    </label>
                  )}
                </div>
              ) : (
                <div
                  className="group relative mb-0.5 flex items-center rounded-md hover:bg-muted"
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ site, x: e.clientX, y: e.clientY }); }}
                >
                  <button
                    onClick={() => { if (!busy) onConnectSite(site); }}
                    disabled={busy}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left disabled:cursor-wait"
                    title={busy ? "Connecting…" : connected ? `Connected to ${site.host}` : `Connect to ${site.host}`}
                  >
                    <span className="relative shrink-0">
                      {busy
                        ? <Loader2 size={14} className="animate-spin text-accent" />
                        : <Folder size={14} className="text-subtle" />}
                      {connected && !busy && (
                        <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-green-500 ring-1 ring-surface" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-xs font-medium text-fg">{site.name}</span>
                        {bookmarked && <Bookmark size={10} className="shrink-0 fill-accent text-accent" />}
                      </span>
                      <span className="block truncate text-[10px] text-subtle">
                        {busy ? "Connecting…" : `${site.protocol === "ftps" ? "FTP" : site.protocol.toUpperCase()} · ${site.host}`}
                      </span>
                    </span>
                  </button>

                  {/* Action cluster — solid panel so it reads clearly over the row */}
                  <div className={`absolute inset-y-0 right-1 flex items-center transition-opacity ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    <div className="flex items-center gap-0.5 rounded-md border border-border bg-elevated px-0.5 shadow-sm">
                      <RowBtn
                        title={bookmarked ? "Remove bookmark" : "Bookmark site"}
                        onClick={(e) => { e.stopPropagation(); toggleBookmark(site.id); }}
                        className={bookmarked ? "text-accent" : ""}
                      >
                        <Bookmark size={12} className={bookmarked ? "fill-accent" : ""} />
                      </RowBtn>
                      {busy ? (
                        <RowBtn title="Working…" onClick={(e) => e.stopPropagation()}>
                          <Loader2 size={12} className="animate-spin text-accent" />
                        </RowBtn>
                      ) : connected ? (
                        <RowBtn
                          title="Disconnect"
                          onClick={(e) => { e.stopPropagation(); onDisconnect(sessionId, site.id); }}
                          className="hover:text-danger"
                        >
                          <Unplug size={12} />
                        </RowBtn>
                      ) : (
                        <RowBtn
                          title="Connect"
                          onClick={(e) => { e.stopPropagation(); onConnectSite(site); }}
                        >
                          <Plug size={12} />
                        </RowBtn>
                      )}
                      <RowBtn title="Edit" onClick={(e) => startEdit(site, e)}>
                        <Pencil size={12} />
                      </RowBtn>
                      <RowBtn title="Delete" onClick={(e) => startDelete(site, e)} className="hover:text-danger">
                        <Trash2 size={12} />
                      </RowBtn>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {ctxMenu && (() => {
          const sessionId = connectedSiteSessions[ctxMenu.site.id];
          const bookmarked = isBookmarked(ctxMenu.site.id);
          return (
            <div
              ref={ctxRef}
              className="fixed z-50 min-w-40 rounded-md border border-border bg-surface py-1 shadow-lg"
              style={{ top: ctxMenu.y, left: ctxMenu.x }}
            >
              {sessionId ? (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
                  onClick={() => { onDisconnect(sessionId, ctxMenu.site.id); setCtxMenu(null); }}
                >
                  <Unplug size={12} /> Disconnect
                </button>
              ) : (
                <button
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-muted"
                  onClick={() => { onConnectSite(ctxMenu.site); setCtxMenu(null); }}
                >
                  <Plug size={12} className="text-subtle" /> Connect
                </button>
              )}
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-muted"
                onClick={() => { toggleBookmark(ctxMenu.site.id); setCtxMenu(null); }}
              >
                <Bookmark size={12} className={bookmarked ? "fill-accent text-accent" : "text-subtle"} />
                {bookmarked ? "Remove bookmark" : "Bookmark"}
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-muted"
                onClick={(e) => { startEdit(ctxMenu.site, e); setCtxMenu(null); }}
              >
                <Pencil size={12} className="text-subtle" /> Edit
              </button>
              <div className="my-1 border-t border-border" />
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
                onClick={(e) => { startDelete(ctxMenu.site, e); setCtxMenu(null); }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>
          );
        })()}
      </div>

      {/* Nav */}
      <nav className="flex items-center justify-around border-t border-border px-2 py-1.5">
        {nav.map(({ icon: Icon, label, active, onClick }) => (
          <button
            key={label}
            title={label}
            onClick={onClick}
            className={`rounded-md p-2 hover:bg-muted hover:text-fg ${active ? "bg-accent/15 text-accent" : "text-subtle"}`}
          >
            <Icon size={15} />
          </button>
        ))}
      </nav>
    </aside>
  );
}

function RowBtn({
  children, title, onClick, className = "",
}: {
  children: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded p-1 text-subtle hover:bg-muted hover:text-fg ${className}`}
    >
      {children}
    </button>
  );
}

function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">{label}</span>
      {children}
    </label>
  );
}
