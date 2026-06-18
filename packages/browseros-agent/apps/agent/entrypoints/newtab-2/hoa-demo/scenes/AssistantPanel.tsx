import { ChevronDown, Mic, Send, Settings, Sparkles, Sun } from 'lucide-react'
import type { FC } from 'react'
import type { Scenario } from '../types'
import type { DemoViewModel } from '../viewModel'

interface AssistantPanelProps {
  scenario: Scenario
  vm: DemoViewModel
}

/** The Julius side panel shown during the home + record-modal scenes. */
export const AssistantPanel: FC<AssistantPanelProps> = ({ scenario, vm }) => (
  <div
    style={{
      flex: 'none',
      width: 384,
      borderLeft: '1px solid #E7E8EA',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}
  >
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '14px 16px',
        borderBottom: '1px solid #F0F1F2',
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          background: '#E8703A',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Sparkles size={13} color="#fff" />
      </span>
      <span style={{ fontSize: 14.5, fontWeight: 700 }}>
        {scenario.agentName}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: '#1E9E5A',
          background: '#EAF3EE',
          padding: '2px 7px',
          borderRadius: 6,
        }}
      >
        Agent Mode
      </span>
      <span
        style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: 13,
          color: '#A6ABB0',
        }}
      >
        <Settings size={14} />
        <Sun size={14} />
      </span>
    </div>
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '18px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '88%',
          background: '#F2F3F4',
          borderRadius: 13,
          padding: '11px 14px',
          fontSize: 13.5,
          lineHeight: 1.5,
          color: '#1C1D1F',
        }}
      >
        {vm.home.userMsg}
      </div>
      {vm.home.showWorking && (
        <div style={{ fontSize: 12, color: '#A6ABB0' }}>
          {vm.home.workedLabel}
        </div>
      )}
      {vm.home.showReply && (
        <div style={{ fontSize: 14, lineHeight: 1.55, color: '#1C1D1F' }}>
          {vm.home.replyText}
          {vm.home.typing && (
            <span
              className="animate-pulse"
              style={{
                display: 'inline-block',
                width: 2,
                height: 15,
                background: '#1C1D1F',
                marginLeft: 1,
                verticalAlign: -2,
              }}
            />
          )}
        </div>
      )}
    </div>
    <div
      style={{
        flex: 'none',
        padding: '13px 16px',
        borderTop: '1px solid #F0F1F2',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            fontWeight: 600,
            color: '#33373B',
            background: '#F2F3F4',
            borderRadius: 9,
            padding: '5px 10px',
          }}
        >
          <ChevronDown size={12} /> Agent Mode ON
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          border: '1px solid #E0B79E',
          borderRadius: 22,
          padding: '9px 9px 9px 15px',
        }}
      >
        <span style={{ flex: 1, color: '#9AA0A6', fontSize: 13.5 }}>
          What should I do?
        </span>
        <Mic size={14} color="#B6BABF" />
        <button
          type="button"
          style={{
            width: 30,
            height: 30,
            border: 'none',
            borderRadius: '50%',
            background: '#EC8253',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  </div>
)
