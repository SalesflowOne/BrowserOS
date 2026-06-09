import { AnimatePresence, motion } from 'motion/react'
import { type FC, useMemo } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { Composer } from './Composer'
import { ComposerProvider } from './ComposerProvider'
import { ChatScreen } from './chat/ChatScreen'
import { ChatSessionProvider } from './chat/ChatSessionProvider'
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

          <ComposerLayer />
        </div>
      </ChatSessionProvider>
    </ComposerProvider>
  )
}

const ComposerLayer: FC = () => {
  const location = useLocation()
  const isChat = location.pathname.endsWith('/chat')
  const isVoice = useMemo(() => {
    if (!isChat) return false
    return new URLSearchParams(location.search).get('mode') === 'voice'
  }, [isChat, location.search])

  const autoFocusKey = isChat ? null : location.pathname

  return (
    <motion.div
      layout
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
      <div className={isVoice ? 'pointer-events-none' : 'pointer-events-auto'}>
        <Composer autoFocusKey={autoFocusKey} />
      </div>
    </motion.div>
  )
}
