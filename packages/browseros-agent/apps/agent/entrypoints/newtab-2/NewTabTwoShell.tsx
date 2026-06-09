import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { Composer } from './Composer'
import { ComposerProvider } from './ComposerProvider'
import { ChatScreen } from './chat/ChatScreen'
import { ChatSessionProvider } from './chat/ChatSessionProvider'
import { VoiceBottom } from './chat/VoiceBottom'
import { NewTabTwo } from './NewTabTwo'

export const NewTabTwoShell: FC = () => {
  const location = useLocation()
  return (
    <ComposerProvider>
      <ChatSessionProvider>
        <div className="relative h-screen w-screen overflow-hidden">
          <AnimatePresence initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route index element={<NewTabTwo />} />
              <Route path="chat" element={<ChatScreen />} />
            </Routes>
          </AnimatePresence>

          <BottomLayer />
        </div>
      </ChatSessionProvider>
    </ComposerProvider>
  )
}

const BottomLayer: FC = () => {
  const location = useLocation()
  const isChat = location.pathname.endsWith('/chat')
  const isVoice =
    isChat && new URLSearchParams(location.search).get('mode') === 'voice'

  const autoFocusKey = isChat ? null : location.pathname

  return (
    <>
      <motion.div
        layout
        aria-hidden={isVoice}
        className={cn(
          'pointer-events-none absolute left-1/2 z-20 -translate-x-1/2',
          isChat ? 'bottom-[18px]' : 'top-1/2 -translate-y-1/2',
        )}
        animate={{ opacity: isVoice ? 0 : 1 }}
        transition={{
          layout: { duration: 0.42, ease: [0.32, 0.72, 0, 1] },
          opacity: { duration: isVoice ? 0.14 : 0.22 },
        }}
      >
        <div
          className={isVoice ? 'pointer-events-none' : 'pointer-events-auto'}
        >
          <Composer autoFocusKey={autoFocusKey} />
        </div>
      </motion.div>

      <AnimatePresence>
        {isVoice && (
          <motion.div
            key="voice-bottom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.22 } }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
            className="pointer-events-auto absolute right-0 bottom-0 left-0 z-20 flex flex-col items-center pb-[26px]"
          >
            <VoiceBottom />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
