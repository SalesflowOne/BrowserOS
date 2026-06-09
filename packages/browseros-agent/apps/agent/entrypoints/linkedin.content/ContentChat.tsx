import type { FC } from 'react'
import { Composer } from '@/entrypoints/newtab-2/Composer'
import { ComposerProvider } from '@/entrypoints/newtab-2/ComposerProvider'
import { AgentChat } from '@/entrypoints/newtab-2/chat/AgentChat'
import { ChatSessionProvider } from '@/entrypoints/newtab-2/chat/ChatSessionProvider'

// AgentChat's text mode wants an onSwitchToVoice handler. The popup hides the
// header mic in compact mode and the compact Composer drops its mic, so this
// callback is never reached. Voice in the popup is a follow-up.
const NO_OP = () => {}

export const ContentChat: FC = () => (
  <ComposerProvider>
    <ChatSessionProvider>
      <PopupChat />
    </ChatSessionProvider>
  </ComposerProvider>
)

const PopupChat: FC = () => (
  <div className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
    <div className="min-h-0 flex-1">
      <AgentChat compact mode="text" onSwitchToVoice={NO_OP} />
    </div>
    <div className="shrink-0 border-border border-t bg-background px-3 py-2">
      <Composer compact placeholder="Reply to the agent…" />
    </div>
  </div>
)
