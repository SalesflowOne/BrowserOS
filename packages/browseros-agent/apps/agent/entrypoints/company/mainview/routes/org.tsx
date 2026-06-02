import { OrgScreen } from '@company/screens/org/Org'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/org')({
  component: OrgScreen,
})
