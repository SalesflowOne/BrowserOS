import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { agentsRoute } from './routes/agents.js'
import { announcementsRoute } from './routes/announcements.js'
import { approvalsRoute } from './routes/approvals.js'
import { browserClawMcpRoute } from './routes/browserclaw-mcp.js'
import { browserosRoute } from './routes/browseros.js'
import { channelsRoute } from './routes/channels.js'
import { employeesRoute } from './routes/employees.js'
import { focusRoute } from './routes/focus.js'
import { mcpConnectionsRoute } from './routes/mcp-connections.js'
import { messagesRoute } from './routes/messages.js'
import { nudgeMcpRoute } from './routes/nudge-mcp.js'
import { screencastRoute } from './routes/screencast.js'
import { searchRoute } from './routes/search.js'
import { skillsRoute } from './routes/skills.js'
import { systemRoute } from './routes/system.js'
import { telegramRoute } from './routes/telegram.js'
import { templatesRoute } from './routes/templates.js'
import { threadEventsRoute } from './routes/thread-events.js'
import { threadsRoute } from './routes/threads.js'

const app = new Hono()
// API binds to 127.0.0.1 (see src/main/index.ts) so it's reachable only
// from the same machine — wildcard CORS is safe and avoids fighting the
// `null` Origin packaged renderers send when loading from file://.
app.use('*', cors({ origin: '*' }))

const routes = app
  .route('/', systemRoute)
  .route('/', agentsRoute)
  .route('/', browserosRoute)
  .route('/', employeesRoute)
  .route('/', templatesRoute)
  .route('/', threadsRoute)
  .route('/', threadEventsRoute)
  .route('/', messagesRoute)
  .route('/', approvalsRoute)
  .route('/', announcementsRoute)
  .route('/', skillsRoute)
  .route('/', mcpConnectionsRoute)
  .route('/', nudgeMcpRoute)
  .route('/', channelsRoute)
  .route('/', screencastRoute)
  .route('/', browserClawMcpRoute)
  .route('/', telegramRoute)
  .route('/', searchRoute)
  .route('/', focusRoute)

export type AppType = typeof routes
export default routes
