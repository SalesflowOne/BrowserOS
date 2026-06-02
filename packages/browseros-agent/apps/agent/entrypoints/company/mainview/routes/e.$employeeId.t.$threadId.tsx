import { ThreadScreen } from '@company/screens/thread/Thread'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

export const Route = createFileRoute('/e/$employeeId/t/$threadId')({
  // Tolerant: search params carried across navigation can hit this
  // schema with stale values from other routes.
  validateSearch: z.object({
    details: z.literal('open').optional().catch(undefined),
    browser: z.literal('watching').optional().catch(undefined),
    msg: z.string().optional().catch(undefined),
  }),
  component: ThreadRoute,
})

function ThreadRoute() {
  const { employeeId, threadId } = Route.useParams()
  return <ThreadScreen employeeId={employeeId} threadId={threadId} />
}
