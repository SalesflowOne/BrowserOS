import { describe, expect, it } from 'bun:test'
import { getScenario, SCENARIO_ORDER, SCENARIOS } from './scenarios'
import { buildTimeline, SCENE_ORDER, sceneAt } from './useDemoClock'
import { buildViewModel } from './viewModel'

describe('hoa-demo scenarios', () => {
  for (const id of SCENARIO_ORDER) {
    const scenario = SCENARIOS[id]

    it(`${id}: every recording step references a known surface`, () => {
      for (const step of scenario.rec) {
        expect(scenario.surfaces[step.surface]).toBeDefined()
      }
    })

    it(`${id}: every workflow step references a known surface`, () => {
      for (const step of scenario.steps) {
        expect(scenario.surfaces[step.surface]).toBeDefined()
      }
    })

    it(`${id}: keeps a human-approval checkpoint`, () => {
      expect(scenario.steps.some((step) => step.type === 'human')).toBe(true)
    })

    it(`${id}: every surface has at least one section tab`, () => {
      for (const surface of Object.values(scenario.surfaces)) {
        expect(surface.sections.length).toBeGreaterThan(0)
      }
    })
  }

  it('getScenario falls back to maintenance for unknown ids', () => {
    expect(getScenario(null).id).toBe('maintenance')
    expect(getScenario('nope').id).toBe('maintenance')
    expect(getScenario('estoppel').id).toBe('estoppel')
  })
})

describe('hoa-demo timeline', () => {
  const scenario = SCENARIOS.maintenance
  const t = buildTimeline(scenario)

  it('scene boundaries strictly increase', () => {
    const order = [
      t.home,
      t.modal,
      t.recording,
      t.processing,
      t.workflow,
      t.saved,
      t.end,
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1])
    }
  })

  it('recording span scales with step count', () => {
    expect(t.processing - t.recording).toBe(scenario.rec.length * 10)
  })

  it('sceneAt maps each boundary to its scene', () => {
    expect(sceneAt(t.home, t)).toBe('home')
    expect(sceneAt(t.modal, t)).toBe('modal')
    expect(sceneAt(t.recording, t)).toBe('recording')
    expect(sceneAt(t.processing, t)).toBe('processing')
    expect(sceneAt(t.workflow, t)).toBe('workflow')
    expect(sceneAt(t.saved, t)).toBe('saved')
    expect(sceneAt(t.end, t)).toBe('saved')
  })

  it('SCENE_ORDER matches the timeline scenes in order', () => {
    expect(SCENE_ORDER).toEqual([
      'home',
      'modal',
      'recording',
      'processing',
      'workflow',
      'saved',
    ])
  })
})

describe('hoa-demo view model', () => {
  const scenario = SCENARIOS.maintenance
  const t = buildTimeline(scenario)

  it('first recording tick shows step 1 of N', () => {
    const vm = buildViewModel(scenario, t.recording, t, 'recording')
    expect(vm.recording.current.index).toBe(1)
    expect(vm.recording.total).toBe(scenario.rec.length)
  })

  it('processing scene treats the recording as complete', () => {
    const vm = buildViewModel(scenario, t.processing, t, 'processing')
    expect(vm.recording.doneCount).toBe(scenario.rec.length)
    expect(vm.recording.captured).toHaveLength(scenario.rec.length)
  })

  it('agent reply is fully typed by the time the modal opens', () => {
    const vm = buildViewModel(scenario, t.modal - 2, t, 'home')
    expect(vm.home.replyText).toBe(scenario.replyFull)
  })

  it('clock reads mm:ss / mm:ss', () => {
    const vm = buildViewModel(scenario, 0, t, 'home')
    expect(vm.clock).toMatch(/^\d+:\d{2} \/ \d+:\d{2}$/)
  })
})
