import { AlertTriangle, Check, Lock, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import type { CSSProperties, FC } from 'react'
import type { Scenario } from '../types'
import { STEP_META } from '../types'
import type { DemoViewModel, ResolvedWorkflowStep } from '../viewModel'

interface WorkflowSceneProps {
  scenario: Scenario
  vm: DemoViewModel
  onSave: () => void
}

const CONNECTOR: CSSProperties = {
  width: 2,
  height: 12,
  background: '#E0E2E5',
  marginLeft: 30,
}

export const WorkflowScene: FC<WorkflowSceneProps> = ({
  scenario,
  vm,
  onSave,
}) => (
  <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.35 } }}
      style={{ padding: '26px 36px 90px', maxWidth: 780, margin: '0 auto' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 13,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: '#FBEDE5',
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
          }}
        >
          <Sparkles size={22} color="#E8703A" />
        </span>
        <div style={{ flex: 1 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: '-.02em',
            }}
          >
            Here’s the workflow I learned
          </h1>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 7,
              fontSize: 12.5,
              color: '#6A6E73',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                background: '#EAF3EE',
                color: '#1E9E5A',
                fontWeight: 600,
                padding: '2px 9px',
                borderRadius: 7,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Check size={12} /> Built from your recording
            </span>
            <span>Plain English · you can edit any step · no code</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div
          style={{
            background: '#1C1D1F',
            color: '#fff',
            borderRadius: 13,
            padding: '13px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.06em',
              background: 'rgba(255,255,255,.14)',
              padding: '3px 8px',
              borderRadius: 6,
            }}
          >
            TRIGGER
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
            {scenario.trigger}
          </span>
        </div>
        <div style={CONNECTOR} />

        {vm.workflow.steps.map((step) => (
          <div key={step.index}>
            <WorkflowStepCard step={step} />
            <div style={CONNECTOR} />
          </div>
        ))}

        <div
          style={{
            background: '#FBE9E7',
            border: '1px dashed #E7B0AA',
            borderRadius: 13,
            padding: '12px 15px',
            display: 'flex',
            gap: 11,
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle
            size={15}
            color="#C0463D"
            style={{ flex: 'none', marginTop: 1 }}
          />
          <div>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: '#C0463D',
                letterSpacing: '.03em',
                marginBottom: 3,
              }}
            >
              IF SOMETHING’S OFF
            </div>
            <div style={{ fontSize: 12.5, color: '#7d3933', lineHeight: 1.45 }}>
              {scenario.exception}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          background: '#F4F8FB',
          border: '1px solid #D7E6F0',
          borderRadius: 13,
          padding: '13px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Lock size={16} color="#3F5A70" style={{ flex: 'none' }} />
        <span style={{ fontSize: 12.5, color: '#3F5A70', lineHeight: 1.45 }}>
          {scenario.lockNote}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button
          type="button"
          onClick={onSave}
          style={{
            flex: 1,
            border: 'none',
            background: '#E8703A',
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            padding: 13,
            borderRadius: 12,
            boxShadow: '0 6px 16px rgba(232,112,58,.3)',
            cursor: 'pointer',
          }}
        >
          Save &amp; let {scenario.agentName} run it next time
        </button>
        <button
          type="button"
          style={{
            border: '1px solid #D8DBDF',
            background: '#fff',
            borderRadius: 12,
            padding: '13px 18px',
            fontSize: 13.5,
            fontWeight: 600,
            color: '#3a3d40',
            cursor: 'pointer',
          }}
        >
          Edit steps
        </button>
      </div>
    </motion.div>
  </div>
)

const WorkflowStepCard: FC<{ step: ResolvedWorkflowStep }> = ({ step }) => {
  const meta = STEP_META[step.type]
  const cardStyle: CSSProperties =
    step.type === 'human'
      ? { border: '1.5px solid #F0C7A8', background: '#FFFBF8' }
      : step.type === 'branch'
        ? { border: '1px solid #EFD9AE', background: '#FFFDF8' }
        : step.type === 'decide'
          ? { border: '1px solid #E1D6F5', background: '#FCFAFF' }
          : { border: '1px solid #E7E8EA', background: '#fff' }

  return (
    <div
      style={{
        borderRadius: 13,
        padding: '13px 15px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        ...cardStyle,
      }}
    >
      <span
        style={{
          width: 25,
          height: 25,
          borderRadius: '50%',
          background: '#F2F3F4',
          color: '#6A6E73',
          fontSize: 12,
          fontWeight: 700,
          display: 'grid',
          placeItems: 'center',
          flex: 'none',
        }}
      >
        {step.index}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '.04em',
              padding: '2px 8px',
              borderRadius: 6,
              color: meta.color,
              background: meta.bg,
            }}
          >
            {meta.label}
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: '#8A8F95',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 15,
                height: 15,
                borderRadius: 5,
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                fontSize: 8,
                fontWeight: 700,
                background: step.surfaceData.color,
              }}
            >
              {step.surfaceData.tag}
            </span>
            {step.surfaceData.name}
          </span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>
          {step.text}
        </div>
        {step.sub && (
          <div
            style={{
              fontSize: 12,
              color: '#8A8F95',
              marginTop: 5,
              lineHeight: 1.45,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <span style={{ color: '#C77A12' }}>↳</span>
            {step.sub}
          </div>
        )}
      </div>
    </div>
  )
}
