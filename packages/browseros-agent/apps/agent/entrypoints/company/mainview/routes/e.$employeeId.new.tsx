import { NewThreadScreen } from '@company/screens/thread/NewThread'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PERMISSION_MODES } from '../../shared/permission'

export const Route = createFileRoute('/e/$employeeId/new')({
  validateSearch: z.object({
    permissionMode: z.enum(PERMISSION_MODES).optional(),
  }),
  component: NewThreadRoute,
})

function NewThreadRoute() {
  const { employeeId } = Route.useParams()
  return <NewThreadScreen employeeId={employeeId} />
}
