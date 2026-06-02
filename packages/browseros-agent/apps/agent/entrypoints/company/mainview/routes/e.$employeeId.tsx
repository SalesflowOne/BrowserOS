import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/e/$employeeId')({
  component: () => <Outlet />,
})
