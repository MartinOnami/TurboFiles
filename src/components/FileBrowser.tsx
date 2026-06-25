import { useEffect, useRef, useState } from "react";
import {
  ChevronUp,
  ExternalLink,
  File,
  Folder,
  FolderPlus,
  FolderUp,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { DirEntry } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { useSettings } from "@/store/useSettings";

/** Identifies which pane an entry was dragged from. */
export type PaneKind = "local" | "remote";
/** Custom MIME type carrying the dragged entry between panes. */
const DND_TYPE = "application/x-turbofiles-entry";

export interface FileBrowserProps {
  title: string;
  path: string;
  entries: DirEntry[];
  remote?: boolean;
  selected?: string;
  isRefreshing?: boolean;
  /** Which pane this browser represents (drives drag-and-drop direction). */
  paneKind: PaneKind;
  onOpenDir: (path: string) => void;
  onNavigateUp: () => void;
  onTransfer: (entry: DirEntry) => void;
  onSelect?: (entry: DirEntry | null) => void;
  onRefresh?: () => void;
  onDelete?: (entry: DirEntry) => Promise<void>;
  onRename?: (entry: DirEntry, newName: string) => Promise<void>;
  onMkdir?: (parentPath: string, name: string) => Promise<void>;
  onRevealInFinder?: (path: string) => void;
  /** Open a file with the OS default application. */
  onOpenFile?: (entry: DirEntry) => void;
  /** Open a file with a chosen application ("Open With…"); omit `app` to pick one. */
  onOpenFileWith?: (entry: DirEntry, app?: string) => void;
  /** Called when an entry dragged from the *other* pane is dropped here. */
  onDropEntry?: (entry: DirEntry) => void;
  /** The other pane's entries, for directory comparison highlighting (off when undefined). */
  compareWith?: DirEntry[];
  /** Ignore size differences at or below this many bytes (0 = exact). */
  compareThreshold?: number;
}

type CompareState = "only" | "differs" | "same";

/** Classify an entry against the other pane: only-here, size-differs, or identical. */
function compareEntry(
  entry: DirEntry,
  otherByName: Map<string, DirEntry>,
  threshold: number,
): CompareState {
  const other = otherByName.get(entry.name);
  if (!other) return "only";
  if (
    entry.kind !== "directory" &&
    other.kind !== "directory" &&
    Math.abs(entry.size - other.size) > threshold
  ) {
    return "differs";
  }
  return "same";
}

const COMPARE_CLS: Record<CompareState, string> = {
  only: "bg-success/10",
  differs: "bg-warning/10",
  same: "",
};

/** Lowercased extension of a filename, or "" when it has none. */
function extOf(name: string): string {
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

/** Friendly app name from an app path (drops directory + `.app`/`.exe` suffix). */
function appLabel(appPath: string): string {
  const base =
    appPath
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? appPath;
  return base.replace(/\.(app|exe|AppImage)$/i, "");
}

type CtxMenu = { x: number; y: number; entry: DirEntry | null };

export function FileBrowser({
  title,
  path,
  entries,
  remote,
  selected,
  isRefreshing,
  paneKind,
  onOpenDir,
  onNavigateUp,
  onTransfer,
  onSelect,
  onRefresh,
  onDelete,
  onRename,
  onMkdir,
  onRevealInFinder,
  onOpenFile,
  onOpenFileWith,
  onDropEntry,
  compareWith,
  compareThreshold = 0,
}: FileBrowserProps) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Column-click sort (null = keep the incoming order from the app's preferences).
  const [sortBy, setSortBy] = useState<null | "name" | "size" | "modified">(null);
  const [sortAsc, setSortAsc] = useState(true);
  const toggleSort = (col: "name" | "size" | "modified") => {
    if (sortBy === col) setSortAsc((a) => !a);
    else {
      setSortBy(col);
      setSortAsc(true);
    }
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Pane width drives which columns fit. Start wide so nothing flashes hidden.
  const [paneW, setPaneW] = useState(9999);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setPaneW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const confirmDelete = useSettings((s) => s.confirmDelete);
  const enterDirs = useSettings((s) => s.doubleClickDir) === "enter";
  const transferFiles = useSettings((s) => s.doubleClickFile) === "transfer";
  const openWithApps = useSettings((s) => s.openWithApps);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [!!ctxMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCtx = (e: React.MouseEvent, entry: DirEntry | null) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleTransferFromCtx = () => {
    if (ctxMenu?.entry) onTransfer(ctxMenu.entry);
    setCtxMenu(null);
  };

  const handleOpenFileFromCtx = () => {
    const entry = ctxMenu?.entry;
    setCtxMenu(null);
    if (entry && entry.kind !== "directory") onOpenFile?.(entry);
  };

  const handleOpenFromCtx = () => {
    if (ctxMenu?.entry?.kind === "directory") onOpenDir(ctxMenu.entry.path);
    setCtxMenu(null);
  };

  const handleRename = () => {
    const entry = ctxMenu?.entry;
    setCtxMenu(null);
    if (!entry) return;
    const newName = window.prompt("Rename to:", entry.name);
    if (newName && newName !== entry.name) {
      onRename?.(entry, newName).catch(console.error);
    }
  };

  const handleDelete = () => {
    const entry = ctxMenu?.entry;
    setCtxMenu(null);
    if (!entry) return;
    if (!confirmDelete || window.confirm(`Delete "${entry.name}"?`)) {
      onDelete?.(entry).catch(console.error);
    }
  };

  const handleMkdir = () => {
    setCtxMenu(null);
    const name = window.prompt("New folder name:");
    if (name) onMkdir?.(path, name).catch(console.error);
  };

  // ── Drag-and-drop between panes ──────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, entry: DirEntry) => {
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: paneKind, entry }));
    e.dataTransfer.effectAllowed = "copy";
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!onDropEntry || !e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  };
  const handleDrop = (e: React.DragEvent) => {
    setDragOver(false);
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw || !onDropEntry) return;
    e.preventDefault();
    try {
      const payload = JSON.parse(raw) as { kind: PaneKind; entry: DirEntry };
      // Only cross-pane drops transfer (local↔remote); ignore same-pane drops.
      if (payload.kind !== paneKind) onDropEntry(payload.entry);
    } catch {
      /* ignore malformed payload */
    }
  };

  const compareMap = compareWith ? new Map(compareWith.map((e) => [e.name, e])) : null;

  const folders = entries.filter((e) => e.kind === "directory").length;
  const files = entries.filter((e) => e.kind !== "directory");
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // Apply column-click sorting on top of the incoming order, keeping folders first.
  const sortedEntries = sortBy
    ? [...entries].sort((a, b) => {
        const dirA = a.kind === "directory" ? 0 : 1;
        const dirB = b.kind === "directory" ? 0 : 1;
        if (dirA !== dirB) return dirA - dirB;
        let cmp = 0;
        if (sortBy === "name") cmp = a.name.localeCompare(b.name);
        else if (sortBy === "size") cmp = a.size - b.size;
        else cmp = (a.modified ?? "").localeCompare(b.modified ?? "");
        return sortAsc ? cmp : -cmp;
      })
    : entries;
  const sortArrow = (col: "name" | "size" | "modified") =>
    sortBy === col ? (sortAsc ? " ▲" : " ▼") : "";

  // Show columns based on the pane's own width (not the viewport), so the Name
  // column stays readable when the pane is squeezed (e.g. the assistant is open).
  const showModified = paneW >= 360;
  const showPermsOwner = remote && paneW >= 560;
  const extraCls = showPermsOwner ? "" : "hidden";
  const modifiedCls = showModified ? "" : "hidden";

  return (
    <section
      className="flex min-w-0 flex-1 flex-col border border-border bg-surface"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) openCtx(e, null);
      }}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-subtle">{title}</span>
        <code className="min-w-0 flex-1 truncate rounded bg-elevated px-2 py-1 text-xs text-fg">
          {path || "-"}
        </code>
        {onMkdir && (
          <button
            onClick={handleMkdir}
            title="Create directory"
            className="shrink-0 rounded p-1 text-subtle hover:bg-muted hover:text-fg"
          >
            <FolderPlus size={14} />
          </button>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Refresh"
            disabled={isRefreshing}
            className="shrink-0 rounded p-1 text-subtle hover:bg-muted hover:text-fg disabled:opacity-40"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          </button>
        )}
        <button
          onClick={onNavigateUp}
          title="Up one level"
          className="shrink-0 rounded p-1 text-subtle hover:bg-muted hover:text-fg"
        >
          <ChevronUp size={16} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className={`relative flex-1 overflow-auto ${dragOver ? "ring-2 ring-inset ring-accent" : ""}`}
        onContextMenu={(e) => {
          e.stopPropagation();
          openCtx(e, null);
        }}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <table className="w-full min-w-0 table-fixed text-sm">
          <colgroup>
            <col />
            <col className="w-16" />
            <col className={showModified ? "w-28" : "hidden"} />
            <col className={showPermsOwner ? "w-24" : "hidden"} />
            <col className={showPermsOwner ? "w-12" : "hidden"} />
          </colgroup>
          <thead className="sticky top-0 bg-elevated text-left text-xs text-subtle">
            <tr>
              {[
                <th
                  key="n"
                  className="cursor-pointer select-none px-3 py-2 font-medium hover:text-fg"
                  onClick={() => toggleSort("name")}
                >
                  Name{sortArrow("name")}
                </th>,
                <th
                  key="s"
                  className="cursor-pointer select-none px-3 py-2 text-right font-medium hover:text-fg"
                  onClick={() => toggleSort("size")}
                >
                  Size{sortArrow("size")}
                </th>,
                <th
                  key="m"
                  className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-fg ${modifiedCls}`}
                  onClick={() => toggleSort("modified")}
                >
                  Modified{sortArrow("modified")}
                </th>,
                <th key="p" className={`px-3 py-2 font-medium ${extraCls}`}>
                  Permissions
                </th>,
                <th key="o" className={`px-3 py-2 font-medium ${extraCls}`}>
                  Owner
                </th>,
              ]}
            </tr>
          </thead>
          <tbody>
            <ParentRow
              onNavigateUp={onNavigateUp}
              onSelect={onSelect}
              extraCls={extraCls}
              modifiedCls={modifiedCls}
            />
            {sortedEntries.map((entry) => (
              <EntryRow
                key={entry.path}
                entry={entry}
                isSelected={selected === entry.path}
                extraCls={extraCls}
                modifiedCls={modifiedCls}
                compareCls={
                  compareMap ? COMPARE_CLS[compareEntry(entry, compareMap, compareThreshold)] : ""
                }
                onSelect={onSelect}
                onOpenDir={onOpenDir}
                onTransfer={onTransfer}
                enterDirs={enterDirs}
                transferFiles={transferFiles}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  openCtx(e, entry);
                }}
                onDragStart={(e) => handleDragStart(e, entry)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-border px-3 py-1.5 text-xs text-subtle">
        {folders} folders, {files.length} files - {formatBytes(totalSize)}
      </footer>

      {ctxMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-40 rounded-md border border-border bg-surface py-1 shadow-lg"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          {ctxMenu.entry && (
            <CtxItem onClick={handleTransferFromCtx}>
              {remote ? "⬇ Download" : "⬆ Upload"}
              {ctxMenu.entry.kind === "directory" ? " folder" : ""}
            </CtxItem>
          )}
          {ctxMenu.entry?.kind === "directory" && (
            <CtxItem onClick={handleOpenFromCtx}>Open</CtxItem>
          )}
          {ctxMenu.entry && ctxMenu.entry.kind !== "directory" && onOpenFile && (
            <CtxItem onClick={handleOpenFileFromCtx}>
              <span className="flex items-center gap-1.5">
                <ExternalLink size={11} /> Open with default app
              </span>
            </CtxItem>
          )}
          {ctxMenu.entry && ctxMenu.entry.kind !== "directory" && onOpenFileWith && (
            <>
              {(() => {
                const remembered = openWithApps[extOf(ctxMenu.entry.name)];
                return remembered ? (
                  <CtxItem
                    onClick={() => {
                      const e = ctxMenu.entry!;
                      setCtxMenu(null);
                      onOpenFileWith(e, remembered);
                    }}
                  >
                    Open with {appLabel(remembered)}
                  </CtxItem>
                ) : null;
              })()}
              <CtxItem
                onClick={() => {
                  const e = ctxMenu.entry!;
                  setCtxMenu(null);
                  onOpenFileWith(e);
                }}
              >
                Open With…
              </CtxItem>
            </>
          )}
          <CtxSep />
          <CtxItem
            onClick={() => {
              setCtxMenu(null);
              onRefresh?.();
            }}
          >
            Refresh
          </CtxItem>
          <CtxItem
            onClick={() => {
              setCtxMenu(null);
              handleMkdir();
            }}
          >
            <span className="flex items-center gap-1.5">
              <FolderPlus size={11} /> Create directory
            </span>
          </CtxItem>
          {!remote && onRevealInFinder && (
            <CtxItem
              onClick={() => {
                const p = ctxMenu.entry?.path ?? path;
                setCtxMenu(null);
                onRevealInFinder(p);
              }}
            >
              <span className="flex items-center gap-1.5">
                <ExternalLink size={11} /> Reveal in Finder
              </span>
            </CtxItem>
          )}
          {ctxMenu.entry && (
            <>
              <CtxSep />
              <CtxItem onClick={handleRename}>Rename</CtxItem>
              <CtxItem onClick={handleDelete} className="text-danger hover:bg-danger/10">
                <span className="flex items-center gap-1.5">
                  <Trash2 size={11} /> Delete
                </span>
              </CtxItem>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Extracted row components - array children ensure no whitespace text nodes ──

function ParentRow({
  onNavigateUp,
  onSelect,
  extraCls,
  modifiedCls,
}: {
  onNavigateUp: () => void;
  onSelect?: (e: DirEntry | null) => void;
  extraCls: string;
  modifiedCls: string;
}) {
  return (
    <tr
      className="cursor-pointer border-b border-border/50 hover:bg-muted"
      onDoubleClick={onNavigateUp}
      onClick={() => onSelect?.(null)}
    >
      {[
        <td key="n" className="px-3 py-1.5 text-subtle">
          <div className="flex items-center gap-2">
            <FolderUp size={16} className="shrink-0" />
            <span>..</span>
          </div>
        </td>,
        <td key="s" />,
        <td key="m" className={modifiedCls} />,
        <td key="p" className={extraCls} />,
        <td key="o" className={extraCls} />,
      ]}
    </tr>
  );
}

function EntryRow({
  entry,
  isSelected,
  extraCls,
  modifiedCls,
  compareCls,
  onSelect,
  onOpenDir,
  onTransfer,
  enterDirs,
  transferFiles,
  onContextMenu,
  onDragStart,
}: {
  entry: DirEntry;
  isSelected: boolean;
  extraCls: string;
  modifiedCls: string;
  compareCls: string;
  onSelect?: (e: DirEntry | null) => void;
  onOpenDir: (path: string) => void;
  onTransfer: (e: DirEntry) => void;
  enterDirs: boolean;
  transferFiles: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const isDir = entry.kind === "directory";
  const onDoubleClick = () => {
    if (isDir) {
      if (enterDirs) onOpenDir(entry.path);
    } else if (transferFiles) onTransfer(entry);
  };
  return (
    <tr
      draggable
      className={`cursor-pointer border-b border-border/50 hover:bg-muted ${compareCls}${isSelected ? " bg-accent/10 hover:bg-accent/15" : ""}`}
      onClick={() => onSelect?.(isSelected ? null : entry)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      title={isDir ? "Double-click to open · drag to transfer" : "Double-click or drag to transfer"}
    >
      {[
        <td key="n" className="px-3 py-1.5 text-fg">
          <div className="flex min-w-0 items-center gap-2">
            {isDir ? (
              <Folder size={15} className="shrink-0 text-accent" />
            ) : (
              <File size={15} className="shrink-0 text-subtle" />
            )}
            <span className="truncate">{entry.name}</span>
          </div>
        </td>,
        <td key="s" className="px-3 py-1.5 text-right text-subtle">
          {isDir ? null : formatBytes(entry.size)}
        </td>,
        <td key="m" className={`px-3 py-1.5 text-subtle ${modifiedCls}`}>
          {entry.modified ?? null}
        </td>,
        <td key="p" className={`px-3 py-1.5 font-mono text-xs text-subtle ${extraCls}`}>
          {entry.permissions ?? null}
        </td>,
        <td key="o" className={`px-3 py-1.5 text-subtle ${extraCls}`}>
          {entry.owner ?? null}
        </td>,
      ]}
    </tr>
  );
}

function CtxItem({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={`flex w-full items-center px-3 py-1.5 text-left text-xs text-fg hover:bg-muted ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CtxSep() {
  return <div className="my-1 border-t border-border" />;
}
