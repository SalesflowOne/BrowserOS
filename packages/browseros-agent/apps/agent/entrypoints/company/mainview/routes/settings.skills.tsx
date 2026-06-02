import { Skills } from '@company/screens/settings/Skills'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/skills')({
  component: Skills,
})
