import { act } from './act'
import { diff } from './diff'
import { download } from './download'
import { evalTool } from './eval'
import type { ToolDefinition } from './framework'
import { grep } from './grep'
import { navigate } from './navigate'
import { pdf } from './pdf'
import { read } from './read'
import { run } from './run'
import { screenshot } from './screenshot'
import { snapshot } from './snapshot'
import { tabs } from './tabs'
import { wait } from './wait'

export const BROWSER_TOOLS: readonly ToolDefinition[] = [
  tabs,
  navigate,
  snapshot,
  diff,
  act,
  download,
  read,
  grep,
  screenshot,
  pdf,
  wait,
  evalTool,
  run,
]
