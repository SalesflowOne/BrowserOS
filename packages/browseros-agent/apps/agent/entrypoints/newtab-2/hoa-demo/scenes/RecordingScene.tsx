import { Check, Mic, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import type { Scenario } from '../types'
import type { DemoViewModel, ResolvedRecStep } from '../viewModel'

interface RecordingSceneProps {
  scenario: Scenario
  vm: DemoViewModel
}

export const RecordingScene: FC<RecordingSceneProps> = ({ vm }) => {
  const { current, captured, total, doneCount } = vm.recording
  const color = current.surfaceData.color
  const { sections } = current.surfaceData
  const crumb = current.crumb.toLowerCase()
  const activeSection =
    sections.find((section) => crumb.startsWith(section.toLowerCase())) ??
    sections[0]
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: '#E9EBED',
        display: 'flex',
        padding: 20,
        gap: 18,
        overflow: 'hidden',
      }}
    >
      {/* The fake HOA portal being recorded */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: '#fff',
          borderRadius: 13,
          overflow: 'hidden',
          boxShadow: '0 12px 36px rgba(0,0,0,.12)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            flex: 'none',
            height: 44,
            background: color,
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '0 16px',
            color: '#fff',
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: 'rgba(255,255,255,.22)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {current.surfaceData.tag}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            {current.surfaceData.name}
          </span>
          <span style={{ fontSize: 11.5, opacity: 0.85, marginLeft: 4 }}>
            {current.crumb}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            padding: '24px 30px',
            background: 'linear-gradient(180deg,#fff,#fafbfc)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {/* faint portal scaffold so it reads as a real record */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 18,
              flexWrap: 'wrap',
            }}
          >
            {sections.map((section) => {
              const active = section === activeSection
              return (
                <span
                  key={section}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: active ? color : '#A6ABB0',
                    borderBottom: active
                      ? `2px solid ${color}`
                      : '2px solid transparent',
                    paddingBottom: 4,
                  }}
                >
                  {section}
                </span>
              )
            })}
          </div>

          <motion.div
            key={current.index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.3 } }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              border: `2px solid ${color}`,
              borderRadius: 13,
              padding: '17px 20px',
              background: '#fff',
              boxShadow: '0 10px 28px rgba(0,0,0,.1)',
              maxWidth: 520,
              position: 'relative',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.05em',
                color,
              }}
            >
              CAPTURED · STEP {current.index} OF {total}
            </span>
            <span
              style={{
                fontSize: 19,
                fontWeight: 700,
                letterSpacing: '-.01em',
                lineHeight: 1.25,
              }}
            >
              {current.title}
            </span>
            <span style={{ fontSize: 14, color: '#5A5E63', lineHeight: 1.4 }}>
              {current.detail}
            </span>
            <span
              style={{
                position: 'absolute',
                right: -10,
                bottom: -10,
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#1C1D1F',
                border: '2px solid #fff',
                boxShadow: '0 2px 6px rgba(0,0,0,.3)',
              }}
            />
          </motion.div>

          {/* faint field rows for portal texture */}
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              maxWidth: 520,
            }}
          >
            {[68, 52].map((w) => (
              <div
                key={w}
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <span
                  style={{
                    height: 8,
                    width: 84,
                    background: '#EDEEF0',
                    borderRadius: 4,
                  }}
                />
                <span
                  style={{
                    height: 8,
                    width: `${w}%`,
                    background: '#F4F5F6',
                    borderRadius: 4,
                  }}
                />
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#FBF2EC',
              border: '1px solid #F2D9C6',
              borderRadius: 12,
              padding: '12px 15px',
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: '#D6453C',
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
              }}
            >
              <Mic size={12} color="#fff" />
            </span>
            <span
              style={{
                fontSize: 13.5,
                color: '#5A4034',
                fontStyle: 'italic',
                lineHeight: 1.45,
              }}
            >
              “{current.say}”
            </span>
          </div>
        </div>
      </div>

      {/* Julius learning panel */}
      <div
        style={{
          flex: 'none',
          width: 300,
          background: '#fff',
          borderRadius: 13,
          boxShadow: '0 12px 36px rgba(0,0,0,.14)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          alignSelf: 'stretch',
        }}
      >
        <div
          style={{
            padding: '14px 15px',
            borderBottom: '1px solid #EDEEF0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: '#FBEDE5',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Sparkles size={15} color="#E8703A" />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              Julius is learning
            </div>
            <div style={{ fontSize: 11, color: '#8A8F95' }}>
              {doneCount} of {total} steps understood
            </div>
          </div>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#D6453C',
              animation: 'fv-pulse 1.1s infinite',
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 13px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {captured.map((step) => (
            <CapturedRow key={step.index} step={step} />
          ))}
        </div>
      </div>
    </div>
  )
}

const CapturedRow: FC<{ step: ResolvedRecStep }> = ({ step }) => (
  <motion.div
    initial={{ opacity: 0, x: 8 }}
    animate={{ opacity: 1, x: 0, transition: { duration: 0.25 } }}
    style={{
      display: 'flex',
      gap: 10,
      padding: '8px 0',
      borderBottom: '1px solid #F4F5F6',
    }}
  >
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontSize: 9,
        fontWeight: 700,
        background: step.surfaceData.color,
        flex: 'none',
        marginTop: 1,
      }}
    >
      {step.surfaceData.tag}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 10.5, color: '#9AA0A6', lineHeight: 1.35 }}>
        {step.detail}
      </div>
    </div>
    <Check size={13} color="#1E9E5A" style={{ flex: 'none', marginTop: 1 }} />
  </motion.div>
)
