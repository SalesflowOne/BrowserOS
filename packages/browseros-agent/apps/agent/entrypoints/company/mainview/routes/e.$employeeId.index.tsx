import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/e/$employeeId/')({
  beforeLoad: ({ params }) => {
    // Day-zero general thread id convention is `th-<monogramSlug>-general`.
    // We use the employee id slug to find the seeded thread; for newly
    // hired employees this lookup happens in the screen so it can show
    // a friendly empty state.
    throw redirect({
      to: '/e/$employeeId/t/$threadId',
      params: { employeeId: params.employeeId, threadId: 'general' },
    })
  },
})
