import type {
  ProcLine,
  RecStep,
  Scenario,
  SceneId,
  Surface,
  WorkflowStep,
} from './types'
import { TICK_MS, type Timeline } from './useDemoClock'

export interface ResolvedRecStep extends RecStep {
  surfaceData: Surface
  /** 1-based position in the recording. */
  index: number
}

export interface ResolvedWorkflowStep extends WorkflowStep {
  surfaceData: Surface
  index: number
}

export interface DemoViewModel {
  home: {
    userMsg: string
    replyText: string
    typing: boolean
    showWorking: boolean
    workedLabel: string
    showReply: boolean
  }
  modal: {
    cursorNearButton: boolean
    recBtnActive: boolean
  }
  recording: {
    total: number
    doneCount: number
    current: ResolvedRecStep
    captured: ResolvedRecStep[]
    elapsed: string
    surface: Surface
  }
  processing: {
    lines: ProcLine[]
    secs: number
  }
  workflow: {
    steps: ResolvedWorkflowStep[]
  }
  toolbar: {
    recording: boolean
    urlText: string
  }
  clock: string
}

function surfaceOf(scenario: Scenario, key: string): Surface {
  return scenario.surfaces[key] ?? Object.values(scenario.surfaces)[0]
}

function resolveRec(
  scenario: Scenario,
  step: RecStep,
  index: number,
): ResolvedRecStep {
  return { ...step, surfaceData: surfaceOf(scenario, step.surface), index }
}

function formatClock(ticks: number): string {
  const seconds = Math.round((ticks * TICK_MS) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function buildViewModel(
  scenario: Scenario,
  tick: number,
  t: Timeline,
  scene: SceneId,
): DemoViewModel {
  // ---- HOME / ASSISTANT ----
  const workStart = t.home + 8
  const typeStart = t.home + 20
  const typeEnd = t.modal - 2
  const isHome = scene === 'home'
  const showWorking = tick >= workStart
  const workedSecs = Math.min(
    3,
    Math.max(1, Math.floor((tick - workStart) / 3) + 1),
  )
  const showReply = tick >= typeStart || !isHome
  let replyText = scenario.replyFull
  let typing = false
  if (isHome && tick < typeEnd) {
    const progress = Math.max(
      0,
      Math.min(1, (tick - typeStart) / (typeEnd - typeStart)),
    )
    replyText = scenario.replyFull.slice(
      0,
      Math.round(progress * scenario.replyFull.length),
    )
    typing = true
  }

  // ---- RECORDING ----
  const total = scenario.rec.length
  const span = t.processing - t.recording
  const pastRecording =
    scene === 'processing' || scene === 'workflow' || scene === 'saved'
  const idx = pastRecording
    ? total
    : Math.max(
        1,
        Math.min(total, Math.floor((tick - t.recording) / (span / total)) + 1),
      )
  const current = resolveRec(
    scenario,
    scenario.rec[Math.min(idx, total) - 1] ?? scenario.rec[0],
    idx,
  )
  const captured = scenario.rec
    .slice(0, idx)
    .map((step, i) => resolveRec(scenario, step, i + 1))
    .reverse()
  const elapsedSecs = Math.min(
    28,
    Math.max(0, Math.round((tick - t.recording) * 0.32)),
  )
  const elapsed = `0:${String(elapsedSecs).padStart(2, '0')}`

  // ---- PROCESSING ----
  const procN = Math.max(
    1,
    Math.min(scenario.proc.length, Math.floor((tick - t.processing) / 4) + 1),
  )
  const lines = scenario.proc.slice(0, procN)
  const procSecs = Math.min(
    6,
    Math.max(2, Math.round((tick - t.processing) * 0.3) + 2),
  )

  // ---- WORKFLOW ----
  const steps: ResolvedWorkflowStep[] = scenario.steps.map((step, i) => ({
    ...step,
    surfaceData: surfaceOf(scenario, step.surface),
    index: i + 1,
  }))

  // ---- MODAL CURSOR ----
  const cursorNearButton = tick >= t.recording - 4

  // ---- TOOLBAR ----
  const isRecording = scene === 'recording'
  const urlText =
    scene === 'home' || scene === 'modal'
      ? 'newtab — what should your agent work on next?'
      : isRecording
        ? `recording · ${current.surfaceData.name}`
        : scene === 'processing'
          ? 'julius.browseros.app › learning your workflow'
          : scene === 'workflow'
            ? 'julius.browseros.app › workflow learned'
            : 'julius.browseros.app › agent on duty'

  return {
    home: {
      userMsg: scenario.userMsg,
      replyText,
      typing,
      showWorking,
      workedLabel: `Worked for ${workedSecs} second${workedSecs === 1 ? '' : 's'}`,
      showReply,
    },
    modal: {
      cursorNearButton,
      recBtnActive: cursorNearButton,
    },
    recording: {
      total,
      doneCount: idx,
      current,
      captured,
      elapsed,
      surface: current.surfaceData,
    },
    processing: {
      lines,
      secs: procSecs,
    },
    workflow: {
      steps,
    },
    toolbar: {
      recording: isRecording,
      urlText,
    },
    clock: `${formatClock(Math.min(tick, t.end))} / ${formatClock(t.end)}`,
  }
}
