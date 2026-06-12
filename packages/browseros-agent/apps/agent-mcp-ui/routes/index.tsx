import { createFileRoute } from '@tanstack/react-router'
import { Cockpit } from '@/screens/cockpit/Cockpit'

export const Route = createFileRoute('/')({
  component: Cockpit,
})
