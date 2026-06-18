import { Check, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import type { Scenario } from '../types'
import type { DemoViewModel } from '../viewModel'

interface ProcessingSceneProps {
  scenario: Scenario
  vm: DemoViewModel
}

export const ProcessingScene: FC<ProcessingSceneProps> = ({ scenario, vm }) => (
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
    <div style={{ width: '100%', maxWidth: 480, textAlign: 'center' }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 16,
          background: '#FBEDE5',
          display: 'grid',
          placeItems: 'center',
          margin: '0 auto 20px',
          position: 'relative',
        }}
      >
        <Sparkles size={30} color="#E8703A" />
        <span
          className="animate-spin"
          style={{
            position: 'absolute',
            inset: -6,
            borderRadius: 20,
            border: '2px solid #F0C7A8',
            borderTopColor: 'transparent',
          }}
        />
      </div>
      <h2
        style={{
          margin: '0 0 6px',
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: '-.02em',
        }}
      >
        Turning your recording into a workflow…
      </h2>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#8A8F95' }}>
        Worked for {vm.processing.secs} seconds · watched {scenario.rec.length}{' '}
        steps across {scenario.toolCount} tools
      </p>
      <div
        style={{
          textAlign: 'left',
          background: '#F7F8F9',
          border: '1px solid #EDEEF0',
          borderRadius: 14,
          padding: '6px 16px',
        }}
      >
        {vm.processing.lines.map((line, i) => (
          <motion.div
            key={line.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '11px 0',
              borderBottom:
                i === vm.processing.lines.length - 1
                  ? 'none'
                  : '1px solid #EDEEF0',
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#1E9E5A',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
              }}
            >
              <Check size={10} />
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#33373B' }}>
              {line.text}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  </div>
)
