import { AnnouncementsScreen } from '@company/screens/announcements/Announcements'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/announcements')({
  component: AnnouncementsScreen,
})
