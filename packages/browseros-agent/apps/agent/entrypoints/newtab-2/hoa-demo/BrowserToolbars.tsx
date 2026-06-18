import { ArrowLeft, ArrowRight, Home, MoreVertical } from 'lucide-react'
import type { FC } from 'react'

export const NormalToolbar: FC<{ urlText: string }> = ({ urlText }) => (
  <div
    style={{
      flex: 'none',
      height: 48,
      background: '#F7F8F9',
      borderBottom: '1px solid #E7E8EA',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '0 14px',
    }}
  >
    <div
      style={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        color: '#9AA0A6',
      }}
    >
      <ArrowLeft size={16} />
      <ArrowRight size={16} color="#C4C8CC" />
      <Home size={15} style={{ marginLeft: 4 }} />
    </div>
    <div
      style={{
        flex: 1,
        maxWidth: 560,
        height: 31,
        background: '#fff',
        border: '1px solid #DEE0E3',
        borderRadius: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '0 12px',
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'conic-gradient(#EA4335,#FBBC05,#34A853,#4285F4,#EA4335)',
          flex: 'none',
        }}
      />
      <span
        style={{
          flex: 1,
          color: '#86898E',
          fontSize: 12.5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {urlText}
      </span>
    </div>
    <div
      style={{
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 13,
      }}
    >
      <ToolbarChip label="Chat" />
      <ToolbarChip label="Council" />
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 12,
          fontWeight: 700,
          color: '#1C1D1F',
        }}
      >
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: '50%',
            background: '#E8703A',
            display: 'inline-block',
          }}
        />
        Assistant
      </span>
      <span style={{ width: 1, height: 18, background: '#DEE0E3' }} />
      <MoreVertical size={15} color="#9AA0A6" />
    </div>
  </div>
)

const ToolbarChip: FC<{ label: string }> = ({ label }) => (
  <span
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      color: '#E8703A',
      fontSize: 12,
      fontWeight: 600,
    }}
  >
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: 3,
        background: '#E8703A',
        display: 'inline-block',
      }}
    />
    {label}
  </span>
)

export const RecordingToolbar: FC<{ elapsed: string; surface: string }> = ({
  elapsed,
  surface,
}) => (
  <div
    style={{
      flex: 'none',
      height: 48,
      background: '#D6453C',
      display: 'flex',
      alignItems: 'center',
      gap: 13,
      padding: '0 16px',
      color: '#fff',
    }}
  >
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: '#fff',
          animation: 'fv-pulse 1.1s infinite',
        }}
      />
      REC
    </span>
    <span
      className="font-mono"
      style={{
        fontSize: 13,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {elapsed}
    </span>
    <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.95 }}>
      Julius is watching &amp; listening — {surface}
    </span>
    <span
      style={{
        marginLeft: 'auto',
        fontSize: 11.5,
        fontWeight: 600,
        background: 'rgba(255,255,255,.18)',
        padding: '5px 11px',
        borderRadius: 8,
      }}
    >
      Capturing what you mean, not where you click
    </span>
  </div>
)
