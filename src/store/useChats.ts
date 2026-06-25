import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentMsg } from "../lib/agent";
import type { ChatItem } from "../components/AssistantPanel";

/** A saved assistant conversation (rendered items + provider-format history). */
export interface StoredChat {
  id: string;
  title: string;
  updatedAt: number;
  items: ChatItem[];
  convo: AgentMsg[];
}

/** Keep history bounded so localStorage cannot grow without limit. */
const MAX_CHATS = 50;

interface ChatsState {
  chats: StoredChat[];
  /** The conversation currently shown in the panel (null = a fresh, unsaved chat). */
  activeId: string | null;
  /** Start a new (empty) chat and make it active; returns its id. */
  newChat: () => string;
  setActive: (id: string) => void;
  /** Upsert the active chat from the panel's current items/history. No-op if empty. */
  saveActive: (items: ChatItem[], convo: AgentMsg[], title: string) => void;
  removeChat: (id: string) => void;
}

function newId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useChats = create<ChatsState>()(
  persist(
    (set, get) => ({
      chats: [],
      activeId: null,
      newChat: () => {
        const id = newId();
        set({ activeId: id });
        return id;
      },
      setActive: (activeId) => set({ activeId }),
      saveActive: (items, convo, title) => {
        const { activeId, chats } = get();
        if (!activeId || items.length === 0) return;
        const existing = chats.find((c) => c.id === activeId);
        const chat: StoredChat = {
          id: activeId,
          title: title || existing?.title || "New chat",
          updatedAt: Date.now(),
          items,
          convo,
        };
        // Most-recent first, deduped, capped.
        set({ chats: [chat, ...chats.filter((c) => c.id !== activeId)].slice(0, MAX_CHATS) });
      },
      removeChat: (id) =>
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
    }),
    { name: "turbofiles-chats" },
  ),
);
