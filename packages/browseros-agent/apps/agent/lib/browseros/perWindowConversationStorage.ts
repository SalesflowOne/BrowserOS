import { storage } from '@wxt-dev/storage'

/**
 * Maps a window id to the conversation its side panel is on, so a window-scoped
 * panel resumes that window's conversation when it (re)mounts instead of
 * starting blank. Session-scoped: window ids are not stable across restarts.
 */
export const perWindowConversationStorage = storage.defineItem<
  Record<number, string>
>('session:browseros.side_panel.window_conversations', { fallback: {} })
