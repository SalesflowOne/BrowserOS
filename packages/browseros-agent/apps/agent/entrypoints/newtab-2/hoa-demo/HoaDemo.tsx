/**
 * HOA launch demo — a self-contained, scripted "fake browser" that plays a
 * hardcoded timeline for recording a sales video. No network, no chrome.* APIs.
 * Swap the scenario (maintenance / estoppel) to tell a different workflow story.
 * Ported from DESIGNS/claude_designs/BrowserOS-hoa/BrowserOS Flows.dc.html.
 */
import type { FC } from 'react'
import { BrowserFrame } from './BrowserFrame'
import { DemoControlBar } from './DemoControlBar'
import { getScenario } from './scenarios'
import { HomeScene } from './scenes/HomeScene'
import { ProcessingScene } from './scenes/ProcessingScene'
import { RecordingScene } from './scenes/RecordingScene'
import { RecordModal } from './scenes/RecordModal'
import { SavedScene } from './scenes/SavedScene'
import { WorkflowScene } from './scenes/WorkflowScene'
import type { ScenarioId } from './types'
import { useDemoClock } from './useDemoClock'
import { buildViewModel } from './viewModel'

interface HoaDemoProps {
  scenarioId: ScenarioId
  onScenarioChange: (id: ScenarioId) => void
}

export const HoaDemo: FC<HoaDemoProps> = ({ scenarioId, onScenarioChange }) => {
  const scenario = getScenario(scenarioId)
  const { tick, playing, scene, timeline, togglePlay, jumpToScene } =
    useDemoClock(scenario)
  const vm = buildViewModel(scenario, tick, timeline, scene)

  const body =
    scene === 'home' || scene === 'modal' ? (
      <HomeScene scenario={scenario} vm={vm} />
    ) : scene === 'recording' ? (
      <RecordingScene scenario={scenario} vm={vm} />
    ) : scene === 'processing' ? (
      <ProcessingScene scenario={scenario} vm={vm} />
    ) : scene === 'workflow' ? (
      <WorkflowScene
        scenario={scenario}
        vm={vm}
        onSave={() => jumpToScene('saved')}
      />
    ) : (
      <SavedScene scenario={scenario} />
    )

  return (
    <BrowserFrame
      scene={scene}
      vm={vm}
      recElapsed={vm.recording.elapsed}
      recSurface={vm.recording.surface.name}
      overlay={
        <>
          {scene === 'modal' && <RecordModal vm={vm} />}
          <DemoControlBar
            scene={scene}
            tick={tick}
            timeline={timeline}
            playing={playing}
            togglePlay={togglePlay}
            jumpToScene={jumpToScene}
            scenarioId={scenario.id}
            onScenarioChange={onScenarioChange}
            clock={vm.clock}
          />
        </>
      }
    >
      {body}
    </BrowserFrame>
  )
}
