import { General } from '@company/screens/settings/General'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/')({
  component: General,
})
