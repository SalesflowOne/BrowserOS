import { Check, Clock, Eye, Gauge, ShieldCheck, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC, ReactNode } from 'react'
import type { Scenario } from '../types'

interface SavedSceneProps {
  scenario: Scenario
}

export const SavedScene: FC<SavedSceneProps> = ({ scenario }) => {
  const { saved, agentName } = scenario
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.4 } }}
        style={{ width: '100%', maxWidth: 520 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#EAF3EE',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 14px',
            }}
          >
            <Check size={26} color="#1E9E5A" />
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: '-.02em',
            }}
          >
            Saved — {agentName} is on duty
          </h1>
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 13.5,
              color: '#8A8F95',
              lineHeight: 1.5,
            }}
          >
            You showed it once. It now runs this on its own, in the background —
            and still checks with a human where it matters.
          </p>
        </div>

        <div
          style={{
            border: '1px solid #E7E8EA',
            borderRadius: 16,
            background: '#fff',
            boxShadow: '0 12px 30px rgba(20,20,25,.06)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '15px 16px',
              borderBottom: '1px solid #F0F1F2',
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: '#FBEDE5',
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
              }}
            >
              <Sparkles size={18} color="#E8703A" />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                {saved.agentTitle}
              </div>
              <div style={{ fontSize: 11.5, color: '#8A8F95' }}>
                Workspace · {scenario.workspace}
              </div>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 700,
                color: '#1E9E5A',
                background: '#EAF3EE',
                padding: '4px 9px',
                borderRadius: 7,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#1E9E5A',
                  animation: 'fv-pulse 1.4s infinite',
                }}
              />
              LIVE
            </span>
          </div>

          <div style={{ padding: '6px 16px' }}>
            <DutyRow icon={<Eye size={15} color="#2F6FED" />} label="Watching">
              {saved.watching}
            </DutyRow>
            <DutyRow icon={<Clock size={15} color="#7A4DD6" />} label="Runs">
              {saved.cadence}
            </DutyRow>
            <DutyRow
              icon={<ShieldCheck size={15} color="#E8703A" />}
              label="Guardrail"
              last
            >
              {saved.guard}
            </DutyRow>
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#F7F8F9',
            border: '1px solid #EDEEF0',
            borderRadius: 13,
            padding: '13px 16px',
          }}
        >
          <Gauge size={18} color="#1E9E5A" style={{ flex: 'none' }} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#33373B',
              lineHeight: 1.4,
            }}
          >
            {saved.metric}
          </span>
        </div>
      </motion.div>
    </div>
  )
}

const DutyRow: FC<{
  icon: ReactNode
  label: string
  last?: boolean
  children: ReactNode
}> = ({ icon, label, last, children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '11px 0',
      borderBottom: last ? 'none' : '1px solid #F0F1F2',
    }}
  >
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: '#F4F5F6',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      {icon}
    </span>
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '.05em',
          color: '#9AA0A6',
          marginBottom: 2,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 13, color: '#33373B', lineHeight: 1.4 }}>
        {children}
      </div>
    </div>
  </div>
)
