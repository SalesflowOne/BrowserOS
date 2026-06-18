/**
 * HOA launch-demo data model.
 *
 * The demo is a self-contained, scripted "fake browser" that plays a hardcoded
 * timeline — reliable and instant for recording a sales video. Nothing here
 * touches the network or chrome.* APIs. A `Scenario` is the whole story for one
 * workflow; swap the scenario, keep the player. Ported from the design in
 * DESIGNS/claude_designs/BrowserOS-hoa/BrowserOS Flows.dc.html.
 */

export type SceneId =
  | 'home'
  | 'modal'
  | 'recording'
  | 'processing'
  | 'workflow'
  | 'saved'

export type ScenarioId = 'maintenance' | 'estoppel'

/** A web surface the operator drives during the recording (portal, AMS, inbox…). */
export interface Surface {
  /** Single-letter favicon/badge, e.g. 'P'. */
  tag: string
  /** Full title shown in the recorded app header + REC toolbar. */
  name: string
  /** Brand color for this surface's chrome and the captured-step accent. */
  color: string
  /** Nav sections shown as faint tabs so the portal reads as real. The active
   *  one is matched against the current step's crumb. */
  sections: string[]
}

/** One captured moment during the recording (left card + Julius's note). */
export interface RecStep {
  /** Key into `Scenario.surfaces`. */
  surface: string
  /** Breadcrumb inside that surface, e.g. 'Requests › #MR-4471'. */
  crumb: string
  title: string
  detail: string
  /** What the operator says out loud as they demonstrate this step. */
  say: string
}

export interface ProcLine {
  text: string
}

/** Semantics of a learned workflow step — drives the colored badge. */
export type StepType = 'read' | 'decide' | 'do' | 'branch' | 'human'

export interface WorkflowStep {
  type: StepType
  /** Key into `Scenario.surfaces`. */
  surface: string
  text: string
  /** Optional clarifier shown under the step (the branch/decision detail). */
  sub?: string
}

export interface RecentSite {
  tag: string
  name: string
  color: string
}

/** The "agent is now live" finale — what running-in-the-background looks like. */
export interface SavedState {
  /** Name of the reusable agent the recording became. */
  agentTitle: string
  /** What the agent watches to know when to run. */
  watching: string
  /** When it fires. */
  cadence: string
  /** The human guardrail it always respects. */
  guard: string
  /** A credible before/after line. */
  metric: string
}

export interface Scenario {
  id: ScenarioId
  /** Short label for the scenario switch in the control bar. */
  label: string
  workspace: string
  agentName: string
  recentSites: RecentSite[]
  /** Keyed surfaces referenced by `rec[].surface` and `steps[].surface`. */
  surfaces: Record<string, Surface>
  /** "watched N steps across {toolCount} tools" in the processing scene. */
  toolCount: number
  /** The operator's opening message to the agent. */
  userMsg: string
  /** The agent's full reply (typed out during the home scene). */
  replyFull: string
  rec: RecStep[]
  proc: ProcLine[]
  trigger: string
  steps: WorkflowStep[]
  /** The "if something's off" guardrail on the learned workflow. */
  exception: string
  /** The "no integrations / no API keys" reassurance line. */
  lockNote: string
  saved: SavedState
}

export interface StepMeta {
  label: string
  color: string
  bg: string
}

/** Badge styling per workflow-step type (shared across scenarios). */
export const STEP_META: Record<StepType, StepMeta> = {
  read: { label: 'READ', color: '#2563EB', bg: '#E8EFFD' },
  decide: { label: 'DECISION', color: '#7A4DD6', bg: '#EDE6FB' },
  do: { label: 'DO', color: '#5A5E63', bg: '#EFF0F2' },
  branch: { label: 'IF / THEN', color: '#C77A12', bg: '#FBF0DC' },
  human: { label: 'ASK A HUMAN', color: '#E8703A', bg: '#FBEDE5' },
}
