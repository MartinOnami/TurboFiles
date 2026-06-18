import { create } from "zustand";
import type { DirEntry, LogEntry, Session, Site, Transfer } from "@/lib/types";

/** A connection tab in the workspace (mirrors FileZilla's session tabs). */
export interface Tab {
  id: string;
  title: string;
  session: Session | null;
  remotePath: string;
  remoteEntries: DirEntry[];
  /** Id of the saved site this session came from, if any (for "connected" badges). */
  siteId?: string;
}

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  sites: Site[];
  localPath: string;
  localEntries: DirEntry[];
  transfers: Transfer[];
  logs: LogEntry[];
  /** Site id the UI has asked the Site Manager to open for editing (consumed by Sidebar). */
  editSiteRequest: string | null;

  setSites: (s: Site[]) => void;
  requestEditSite: (id: string | null) => void;
  setLocal: (path: string, entries: DirEntry[]) => void;
  addTab: (tab: Tab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | null) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  upsertTransfer: (t: Transfer) => void;
  setTransfers: (t: Transfer[]) => void;
  log: (entry: LogEntry) => void;
  setLogs: (logs: LogEntry[]) => void;
}

export const useStore = create<AppState>((set) => ({
  tabs: [],
  activeTabId: null,
  sites: [],
  localPath: "",
  localEntries: [],
  transfers: [],
  logs: [],
  editSiteRequest: null,

  setSites: (sites) => set({ sites }),
  requestEditSite: (editSiteRequest) => set({ editSiteRequest }),
  setLocal: (localPath, localEntries) => set({ localPath, localEntries }),
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id })),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId = s.activeTabId === id ? (tabs[0]?.id ?? null) : s.activeTabId;
      return { tabs, activeTabId };
    }),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  upsertTransfer: (t) =>
    set((s) => {
      const idx = s.transfers.findIndex((x) => x.id === t.id);
      if (idx === -1) return { transfers: [...s.transfers, t] };
      const e = s.transfers[idx];
      const TERMINAL = new Set<Transfer["status"]>(["completed", "failed", "cancelled"]);
      const next = [...s.transfers];
      next[idx] = {
        ...e,
        // Preserve name/path fields — progress events don't carry them
        name: t.name || e.name,
        localPath: t.localPath || e.localPath,
        remotePath: t.remotePath || e.remotePath,
        direction: t.direction ?? e.direction,
        scope: t.scope || e.scope,
        timestamp: t.timestamp || e.timestamp,
        error: t.error !== undefined ? t.error : e.error,
        etaSeconds: t.etaSeconds !== undefined ? t.etaSeconds : e.etaSeconds,
        speed: t.speed ?? e.speed,
        // Never regress progress — picks up real totalBytes once the worker knows it
        bytesTransferred: Math.max(e.bytesTransferred, t.bytesTransferred ?? 0),
        totalBytes: Math.max(e.totalBytes, t.totalBytes ?? 0),
        // Never step backwards from a terminal status
        status: TERMINAL.has(e.status) ? e.status : (t.status ?? e.status),
      };
      return { transfers: next };
    }),
  setTransfers: (transfers) => set({ transfers }),
  // Keep a generous in-memory window; the full history lives in SQLite.
  log: (entry) => set((s) => ({ logs: [...s.logs.slice(-1999), entry] })),
  setLogs: (logs) => set({ logs }),
}));
