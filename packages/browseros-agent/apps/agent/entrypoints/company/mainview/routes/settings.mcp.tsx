import { Mcp } from '@company/screens/settings/Mcp'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/mcp')({
  component: Mcp,
})
