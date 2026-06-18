import { storage } from '@wxt-dev/storage'

export const openWindowSidePanelIdsStorage = storage.defineItem<number[]>(
  'session:browseros.side_panel.open_window_ids',
  { fallback: [] },
)
