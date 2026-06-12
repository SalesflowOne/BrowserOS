import { IconActivity, IconServer } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useSystemHealth, useSystemVersion } from '@/modules/api/system.hooks'

export function Cockpit() {
  const health = useSystemHealth()
  const version = useSystemVersion()

  const healthLabel = health.isLoading
    ? 'checking…'
    : health.error
      ? 'unreachable'
      : (health.data?.status ?? 'unknown')

  return (
    <main className="mx-auto flex h-full max-w-3xl flex-col gap-6 p-8">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">
          BrowserOS Agents
        </h1>
        <p className="text-muted-foreground text-sm">
          Cockpit bootstrap — verifying the UI talks to the agent-mcp-interface
          server over hono-rpc.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <IconServer className="h-4 w-4 text-muted-foreground" />
              Interface server
            </CardTitle>
            <Badge variant={health.error ? 'destructive' : 'secondary'}>
              <IconActivity className="mr-1 h-3 w-3" />
              {healthLabel}
            </Badge>
          </div>
          <CardDescription>
            Connection probe against{' '}
            <code className="text-xs">/system/health</code> and{' '}
            <code className="text-xs">/system/version</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {version.data && (
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground">name</span>
              <code className="text-xs">{version.data.name}</code>
              <span className="ml-auto text-muted-foreground">
                v{version.data.version}
              </span>
            </div>
          )}
          {version.error && (
            <p className="text-destructive text-sm">
              Could not reach the interface server. Start it with{' '}
              <code className="text-xs">
                bun run --filter @browseros/agent-mcp-interface start
              </code>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
