import { Pause, Play } from 'lucide-react'
import type { FC } from 'react'
import { SCENARIO_ORDER, SCENARIOS } from './scenarios'
import type { ScenarioId, SceneId } from './types'
import { SCENE_ORDER, type Timeline } from './useDemoClock'

const SCENE_LABELS: Record<SceneId, string> = {
  home: 'Ask Julius',
  modal: 'Record',
  recording: 'Capturing',
  processing: 'Learning',
  workflow: 'Workflow',
  saved: 'Live',
}

interface DemoControlBarProps {
  scene: SceneId
  tick: number
  timeline: Timeline
  playing: boolean
  togglePlay: () => void
  jumpToScene: (id: SceneId) => void
  scenarioId: ScenarioId
  onScenarioChange: (id: ScenarioId) => void
  clock: string
}

export const DemoControlBar: FC<DemoControlBarProps> = ({
  scene,
  tick,
  timeline,
  playing,
  togglePlay,
  jumpToScene,
  scenarioId,
  onScenarioChange,
  clock,
}) => (
  <div
    style={{
      position: 'absolute',
      left: '50%',
      bottom: 18,
      transform: 'translateX(-50%)',
      zIndex: 90,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'rgba(28,29,31,.92)',
      backdropFilter: 'blur(8px)',
      borderRadius: 30,
      padding: '7px 10px 7px 8px',
      boxShadow: '0 12px 30px rgba(0,0,0,.34)',
    }}
  >
    {/* scenario switch */}
    <div
      style={{
        display: 'flex',
        gap: 2,
        background: 'rgba(255,255,255,.08)',
        borderRadius: 22,
        padding: 3,
      }}
    >
      {SCENARIO_ORDER.map((id) => {
        const active = id === scenarioId
        return (
          <button
            key={id}
            type="button"
            onClick={() => onScenarioChange(id)}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: 18,
              padding: '5px 11px',
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: active ? '#E8703A' : 'transparent',
              color: active ? '#fff' : '#9AA0A6',
            }}
          >
            {SCENARIOS[id].label}
          </button>
        )
      })}
    </div>

    <span
      style={{ width: 1, height: 18, background: 'rgba(255,255,255,.18)' }}
    />

    <button
      type="button"
      onClick={togglePlay}
      aria-label={playing ? 'Pause' : 'Play'}
      style={{
        width: 34,
        height: 34,
        border: 'none',
        borderRadius: '50%',
        background: '#E8703A',
        color: '#fff',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      {playing ? (
        <Pause size={14} fill="#fff" />
      ) : (
        <Play size={14} fill="#fff" />
      )}
    </button>

    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      {SCENE_ORDER.map((id) => {
        const active = id === scene
        const reached = tick >= timeline[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => jumpToScene(id)}
            aria-label={SCENE_LABELS[id]}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              padding: 0,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: active
                  ? '#E8703A'
                  : reached
                    ? '#6F7378'
                    : '#494C50',
              }}
            />
            {active && (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                }}
              >
                {SCENE_LABELS[id]}
              </span>
            )}
          </button>
        )
      })}
    </div>

    <span
      style={{ width: 1, height: 18, background: 'rgba(255,255,255,.18)' }}
    />
    <span
      className="font-mono"
      style={{
        fontSize: 11,
        color: '#9AA0A6',
        paddingRight: 4,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {clock}
    </span>
  </div>
)
