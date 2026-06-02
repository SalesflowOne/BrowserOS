import { Shell } from '@company/components/layout/Shell'
import { useFocusReporter } from '@company/modules/system/useFocusReporter'
import { useNavigationIntents } from '@company/modules/system/useNavigationIntents'
import { createRootRoute, Outlet } from '@tanstack/react-router'

// Shell wraps the Outlet here (not inside each screen) so the sidebar,
// SidebarProvider, Rail, and InsetTopBar mount once for the app's
// lifetime. Per-screen Shell wrappers were tearing the entire sidebar
// tree down on every navigation, which is what the navigation lag was.
function RootComponent() {
  // Reports the focused thread id to main so the notification
  // dispatcher can suppress toasts the user is already looking at.
  useFocusReporter()
  // Subscribes to `app:navigate` intents from main — currently used
  // by notification-toast clicks to route the renderer to the right
  // thread after raising the window.
  useNavigationIntents()
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
