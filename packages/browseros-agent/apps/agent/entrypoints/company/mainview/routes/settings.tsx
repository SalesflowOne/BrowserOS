import { SettingsLayout } from '@company/screens/settings/SettingsLayout'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
})
