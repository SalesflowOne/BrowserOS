/**
 * The fake BrowserOS window the demo plays inside. Pixel-faithful to the design
 * mockup, so it leans on inline styles (the design's exact palette) rather than
 * Tailwind utilities — this is a self-contained marketing surface, not product UI.
 */
import { CalendarClock, Home, LayoutGrid, Menu } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { BrowserOSIcon } from '@/lib/llm-providers/providerIcons'
import { NormalToolbar, RecordingToolbar } from './BrowserToolbars'
import type { SceneId } from './types'
import type { DemoViewModel } from './viewModel'

interface BrowserFrameProps {
  scene: SceneId
  vm: DemoViewModel
  recElapsed: string
  recSurface: string
  children: ReactNode
  overlay?: ReactNode
}

export const BrowserFrame: FC<BrowserFrameProps> = ({
  scene,
  vm,
  recElapsed,
  recSurface,
  children,
  overlay,
}) => {
  const recording = scene === 'recording'
  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        minHeight: 760,
        background: '#C9CDD2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1300,
          height: '100%',
          maxHeight: 880,
          background: '#DDE0E3',
          borderRadius: 14,
          boxShadow: recording
            ? '0 26px 70px rgba(20,22,28,.36), inset 0 0 0 3px #D6453C'
            : '0 26px 70px rgba(20,22,28,.36)',
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <TabSidebar scene={scene} vm={vm} />
        <IconRail />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          {recording ? (
            <RecordingToolbar elapsed={recElapsed} surface={recSurface} />
          ) : (
            <NormalToolbar urlText={vm.toolbar.urlText} />
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
              background: '#fff',
              display: 'flex',
            }}
          >
            {children}
          </div>
        </div>
        {overlay}
      </div>
    </div>
  )
}

const TRAFFIC = ['#FF5F57', '#FEBC2E', '#28C840']

const TabSidebar: FC<{
  scene: SceneId
  vm: DemoViewModel
}> = ({ scene, vm }) => {
  const recording = scene === 'recording'
  const surface = vm.recording.surface
  return (
    <div
      style={{
        flex: 'none',
        width: 228,
        background: '#DDE0E3',
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
          gap: 8,
          padding: '13px 14px 10px',
        }}
      >
        {TRAFFIC.map((color) => (
          <span
            key={color}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: color,
            }}
          />
        ))}
        <Menu size={15} color="#7E8389" style={{ marginLeft: 6 }} />
        <LayoutGrid size={14} color="#7E8389" style={{ marginLeft: 'auto' }} />
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {recording && (
          <TabRow
            badge={surface.tag}
            badgeColor={surface.color}
            title={surface.name}
            rec
            active
          />
        )}
        <TabRow browserOs active={!recording} />
        <div
          style={{
            marginTop: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 9,
            borderRadius: 9,
            background: '#D2E4F2',
            color: '#2C5F86',
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          +
        </div>
      </div>
    </div>
  )
}

const TabRow: FC<{
  browserOs?: boolean
  badge?: string
  badgeColor?: string
  title?: string
  rec?: boolean
  active?: boolean
}> = ({ browserOs, badge, badgeColor, title, rec, active }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '8px 9px',
      borderRadius: 9,
      background: active ? (rec ? '#FBEDE5' : '#fff') : 'transparent',
      boxShadow: active && !rec ? '0 1px 2px rgba(0,0,0,.06)' : 'none',
    }}
  >
    {browserOs ? (
      <span
        style={{
          width: 18,
          height: 18,
          display: 'grid',
          placeItems: 'center',
          flex: 'none',
        }}
      >
        <BrowserOSIcon size={16} />
      </span>
    ) : (
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          flex: 'none',
          background: badgeColor,
        }}
      >
        {badge}
      </span>
    )}
    <span
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        fontWeight: 500,
        color: '#33373B',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {browserOs ? 'BrowserOS' : title}
    </span>
    {rec && (
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#D6453C',
          animation: 'fv-pulse 1.1s infinite',
          flex: 'none',
        }}
      />
    )}
    {active && (
      <span style={{ color: '#9AA0A6', fontSize: 13, flex: 'none' }}>✕</span>
    )}
  </div>
)

const IconRail: FC = () => (
  <div
    style={{
      flex: 'none',
      width: 52,
      background: '#E9EBED',
      borderRight: '1px solid #D6D9DC',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: 8,
    }}
  >
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: '#E8703A',
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontSize: 11,
        fontWeight: 700,
        marginBottom: 6,
      }}
    >
      DM
    </span>
    <RailIcon active>
      <Home size={17} />
    </RailIcon>
    <RailIcon>
      <CalendarClock size={17} />
    </RailIcon>
  </div>
)

const RailIcon: FC<{ active?: boolean; children: ReactNode }> = ({
  active,
  children,
}) => (
  <div
    style={{
      width: 36,
      height: 36,
      borderRadius: 10,
      display: 'grid',
      placeItems: 'center',
      background: active ? '#fff' : 'transparent',
      color: active ? '#33373B' : '#8A8F95',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
    }}
  >
    {children}
  </div>
)
