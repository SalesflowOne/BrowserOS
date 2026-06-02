import { Telegram } from '@company/screens/settings/Telegram'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/telegram')({
  component: Telegram,
})
