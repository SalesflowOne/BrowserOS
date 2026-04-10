import {
  AlertCircle,
  Cpu,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import { type FC, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AgentChat } from './AgentChat'
import {
  type AgentEntry,
  createAgent,
  deleteAgent,
  restartOpenClaw,
  setupOpenClaw,
  stopOpenClaw,
  useOpenClawAgents,
  useOpenClawStatus,
} from './useOpenClaw'

const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const variants: Record<
    string,
    {
      variant: 'default' | 'secondary' | 'outline' | 'destructive'
      label: string
    }
  > = {
    running: { variant: 'default', label: 'Running' },
    starting: { variant: 'secondary', label: 'Starting...' },
    stopped: { variant: 'outline', label: 'Stopped' },
    error: { variant: 'destructive', label: 'Error' },
    uninitialized: { variant: 'outline', label: 'Not Set Up' },
  }
  const v = variants[status] ?? { variant: 'outline' as const, label: status }
  return <Badge variant={v.variant}>{v.label}</Badge>
}

export const AgentsPage: FC = () => {
  const { status, loading: statusLoading } = useOpenClawStatus()
  const [refreshKey, setRefreshKey] = useState(0)
  const { agents, loading: agentsLoading } = useOpenClawAgents(refreshKey)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [chatAgent, setChatAgent] = useState<AgentEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => setRefreshKey((k) => k + 1)

  const handleSetup = async () => {
    setSettingUp(true)
    setError(null)
    try {
      await setupOpenClaw({})
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSettingUp(false)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createAgent(newName.trim().toLowerCase().replace(/\s+/g, '-'))
      setCreateOpen(false)
      setNewName('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setActionInProgress(true)
    try {
      await deleteAgent(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionInProgress(false)
    }
  }

  const handleStop = async () => {
    setActionInProgress(true)
    try {
      await stopOpenClaw()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionInProgress(false)
    }
  }

  const handleRestart = async () => {
    setActionInProgress(true)
    try {
      await restartOpenClaw()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionInProgress(false)
    }
  }

  if (chatAgent) {
    return (
      <AgentChat
        agentId={chatAgent.id}
        agentName={chatAgent.name}
        onBack={() => setChatAgent(null)}
      />
    )
  }

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl">Agents</h1>
          <p className="text-muted-foreground text-sm">
            OpenClaw agents running in a local container
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status?.status === 'running' && (
            <>
              <StatusBadge status="running" />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRestart}
                disabled={actionInProgress}
                title="Restart gateway"
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleStop}
                disabled={actionInProgress}
                title="Stop gateway"
              >
                <Square className="size-4" />
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 size-4" />
                New Agent
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-3">
            <AlertCircle className="size-4 text-destructive" />
            <p className="text-destructive text-sm">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Uninitialized state */}
      {status?.status === 'uninitialized' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Cpu className="size-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-semibold text-lg">Set Up OpenClaw</h3>
              <p className="text-muted-foreground text-sm">
                {status.podmanAvailable
                  ? 'Create a local container to run autonomous agents with full tool access.'
                  : 'Podman is required to run OpenClaw agents. Install Podman first.'}
              </p>
            </div>
            {status.podmanAvailable && (
              <Button onClick={handleSetup} disabled={settingUp}>
                {settingUp ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  'Set Up Now'
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stopped state */}
      {status?.status === 'stopped' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Cpu className="size-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-semibold text-lg">Gateway Stopped</h3>
              <p className="text-muted-foreground text-sm">
                The OpenClaw gateway is not running.
              </p>
            </div>
            <Button onClick={handleSetup} disabled={settingUp}>
              {settingUp ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Starting...
                </>
              ) : (
                'Start Gateway'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {status?.status === 'error' && (
        <Card className="border-destructive">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertCircle className="size-12 text-destructive" />
            <div className="text-center">
              <h3 className="font-semibold text-lg">Gateway Error</h3>
              <p className="text-muted-foreground text-sm">{status.error}</p>
            </div>
            <Button onClick={handleRestart} disabled={actionInProgress}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Agent list */}
      {status?.status === 'running' && (
        <div className="space-y-3">
          {agentsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : agents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8">
                <p className="text-muted-foreground text-sm">
                  No agents yet. Create one to get started.
                </p>
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1 size-4" />
                  Create Agent
                </Button>
              </CardContent>
            </Card>
          ) : (
            agents.map((agent) => (
              <Card key={agent.id}>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Cpu className="size-5 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      <p className="font-mono text-muted-foreground text-xs">
                        {agent.workspace}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setChatAgent(agent)}
                    >
                      <MessageSquare className="mr-1 size-4" />
                      Chat
                    </Button>
                    {agent.id !== 'main' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(agent.id)}
                        disabled={actionInProgress}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Create Agent Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label
                htmlFor="agent-name"
                className="mb-1 block font-medium text-sm"
              >
                Agent Name
              </label>
              <Input
                id="agent-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="research-agent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
              <p className="mt-1 text-muted-foreground text-xs">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="w-full"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Agent'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
