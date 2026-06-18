import { useEffect, useRef, useState } from 'react'
import type { Scenario, SceneId } from './types'

/** One tick is TICK_MS; the whole demo is a few hundred ticks. */
export const TICK_MS = 120

/** Tunable scene durations, in ticks. Recording scales with step count. */
const HOME_TICKS = 56
const MODAL_TICKS = 22
const REC_TICKS_PER_STEP = 10
const PROC_TICKS = 26
const WORKFLOW_TICKS = 64
const SAVED_TICKS = 44

/** Absolute start tick of each scene, plus the final stop. */
export interface Timeline {
  home: number
  modal: number
  recording: number
  processing: number
  workflow: number
  saved: number
  end: number
}

/** Scenes in play order — drives the scrubber dots. */
export const SCENE_ORDER: SceneId[] = [
  'home',
  'modal',
  'recording',
  'processing',
  'workflow',
  'saved',
]

export function buildTimeline(scenario: Scenario): Timeline {
  const home = 0
  const modal = home + HOME_TICKS
  const recording = modal + MODAL_TICKS
  const processing = recording + scenario.rec.length * REC_TICKS_PER_STEP
  const workflow = processing + PROC_TICKS
  const saved = workflow + WORKFLOW_TICKS
  const end = saved + SAVED_TICKS
  return { home, modal, recording, processing, workflow, saved, end }
}

export function sceneAt(tick: number, t: Timeline): SceneId {
  if (tick >= t.saved) return 'saved'
  if (tick >= t.workflow) return 'workflow'
  if (tick >= t.processing) return 'processing'
  if (tick >= t.recording) return 'recording'
  if (tick >= t.modal) return 'modal'
  return 'home'
}

export interface DemoClock {
  tick: number
  playing: boolean
  scene: SceneId
  timeline: Timeline
  togglePlay: () => void
  jumpToScene: (id: SceneId) => void
}

export function useDemoClock(scenario: Scenario): DemoClock {
  const timeline = buildTimeline(scenario)
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(true)

  // Reset the timeline when the scenario swaps. React sanctions
  // setState-during-render for this "derive state from props" reset.
  const scenarioIdRef = useRef(scenario.id)
  if (scenarioIdRef.current !== scenario.id) {
    scenarioIdRef.current = scenario.id
    setTick(0)
    setPlaying(true)
  }

  const { end } = timeline
  useEffect(() => {
    if (!playing) return
    const interval = setInterval(() => {
      setTick((value) => (value >= end ? value : value + 1))
    }, TICK_MS)
    return () => clearInterval(interval)
  }, [playing, end])

  // Auto-pause when the finale lands so the recording rests on it.
  useEffect(() => {
    if (tick >= end && playing) setPlaying(false)
  }, [tick, end, playing])

  const togglePlay = () => {
    if (tick >= end) {
      setTick(0)
      setPlaying(true)
      return
    }
    setPlaying((value) => !value)
  }

  const jumpToScene = (id: SceneId) => {
    setTick(timeline[id])
    setPlaying(false)
  }

  return {
    tick,
    playing,
    scene: sceneAt(tick, timeline),
    timeline,
    togglePlay,
    jumpToScene,
  }
}
