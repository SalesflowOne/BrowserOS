import { ChannelScreen } from '@company/screens/channel/Channel'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

export const Route = createFileRoute('/c/$channelId')({
  // Tolerant: search params carried across navigation can hit this
  // schema with stale values from other routes.
  validateSearch: z.object({
    browser: z.literal('watching').optional().catch(undefined),
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { channelId } = Route.useParams()
  return <ChannelScreen channelId={channelId} />
}
