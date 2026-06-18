import { Lightbulb, Mic, Monitor, MousePointer2, Upload, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC, ReactNode } from 'react'
import type { DemoViewModel } from '../viewModel'

interface RecordModalProps {
  vm: DemoViewModel
}

export const RecordModal: FC<RecordModalProps> = ({ vm }) => {
  const { cursorNearButton, recBtnActive } = vm.modal
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: 'rgba(20,21,24,.34)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 30,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1, transition: { duration: 0.3 } }}
        style={{
          width: '100%',
          maxWidth: 620,
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 30px 70px rgba(0,0,0,.4)',
          padding: '24px 26px',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <span
            style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.01em' }}
          >
            Before we begin
          </span>
          <X size={18} color="#9AA0A6" />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
            marginBottom: 16,
          }}
        >
          <CaptureCard
            icon={<Monitor size={20} color="#2F6FED" />}
            bg="#E4EDFB"
            title="Screen"
          />
          <CaptureCard
            icon={<Mic size={18} color="#E2574C" />}
            bg="#FBE0DC"
            title="Microphone"
          />
        </div>
        <div
          style={{
            background: '#FFFBEF',
            border: '1px solid #F2E3B8',
            borderRadius: 11,
            padding: '13px 15px',
            marginBottom: 18,
            fontSize: 13.5,
            lineHeight: 1.45,
            color: '#5A5320',
          }}
        >
          <b style={{ color: '#B5871A' }}>Note:</b> You’ll be asked to grant
          permission for both screen sharing and microphone access.
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.07em',
            color: '#9AA0A6',
            marginBottom: 13,
          }}
        >
          TIPS FOR A GREAT DEMONSTRATION
        </div>
        <Tip icon={<Mic size={15} color="#8A8F95" />}>
          <b>Narrate as you go</b> — explain what you’re doing and why as you
          demonstrate.
        </Tip>
        <Tip icon={<Lightbulb size={15} color="#8A8F95" />}>
          <b>Mention any edge cases</b> — let us know about exceptions or
          special scenarios.
        </Tip>
        <p
          style={{
            margin: '0 0 4px',
            fontSize: 13.5,
            color: '#5A5E63',
            lineHeight: 1.45,
          }}
        >
          You can show me multiple times throughout our conversation — no need
          to capture everything in one go.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 11,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid #DEE0E3',
              background: '#fff',
              borderRadius: 10,
              padding: '10px 16px',
              fontSize: 13.5,
              fontWeight: 600,
              color: '#33373B',
            }}
          >
            <Upload size={14} />
            Choose video
          </button>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              border: '1px solid #DEE0E3',
              background: '#fff',
              borderRadius: 10,
              padding: '10px 18px',
              fontSize: 13.5,
              fontWeight: 700,
              color: '#1C1D1F',
              position: 'relative',
              boxShadow: recBtnActive
                ? '0 0 0 3px rgba(226,87,76,.25)'
                : 'none',
              transform: recBtnActive ? 'scale(.97)' : 'none',
            }}
          >
            <span
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: '#E2574C',
              }}
            />
            Record my screen
          </button>
        </div>
        <MousePointer2
          size={24}
          color="#1C1D1F"
          fill="#1C1D1F"
          style={{
            position: 'absolute',
            right: cursorNearButton ? 42 : 120,
            bottom: cursorNearButton ? 34 : 78,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.4))',
            transition: 'all .5s ease',
          }}
        />
      </motion.div>
    </div>
  )
}

const CaptureCard: FC<{ icon: ReactNode; bg: string; title: string }> = ({
  icon,
  bg,
  title,
}) => (
  <div
    style={{
      border: '1px solid #E7E8EA',
      borderRadius: 13,
      padding: '16px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}
  >
    <span
      style={{
        width: 42,
        height: 42,
        borderRadius: '50%',
        background: bg,
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      {icon}
    </span>
    <div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#9AA0A6' }}>Will be captured</div>
    </div>
  </div>
)

const Tip: FC<{ icon: ReactNode; children: ReactNode }> = ({
  icon,
  children,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 11,
      marginBottom: 13,
    }}
  >
    <span style={{ marginTop: 2, flex: 'none' }}>{icon}</span>
    <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>{children}</span>
  </div>
)
