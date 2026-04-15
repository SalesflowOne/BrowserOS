import type {
  BrowserOSAgentProgram,
  BrowserOSProgramRun,
  CreateAgentProgramInput,
  UpdateAgentProgramInput,
} from '@browseros/shared/types/role-programs'
import {
  ArrowLeft,
  CalendarClock,
  Loader2,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import type { AgentEntry } from '../useOpenClaw'
import {
  useOpenClawMutations,
  useOpenClawProgramRuns,
  useOpenClawPrograms,
} from '../useOpenClaw'
import { ProgramFormDialog } from './ProgramFormDialog'
import { ProgramRunHistory } from './ProgramRunHistory'
import { ProgramRunResultDialog } from './ProgramRunResultDialog'

interface AgentProgramsPageProps {
  agent: AgentEntry
  onBack: () => void
}

function describeSchedule(program: BrowserOSAgentProgram): string {
  switch (program.schedule.type) {
    case 'manual':
      return 'Manual only'
    case 'daily':
      return `Daily at ${program.schedule.time}`
    case 'hourly':
      return `Every ${program.schedule.interval} hour(s)`
    case 'minutes':
      return `Every ${program.schedule.interval} minute(s)`
  }
}

export function AgentProgramsPage({ agent, onBack }: AgentProgramsPageProps) {
  const {
    programs,
    loading: programsLoading,
    error: programsError,
  } = useOpenClawPrograms(agent.agentId)
  const {
    runs,
    loading: runsLoading,
    error: runsError,
  } = useOpenClawProgramRuns(agent.agentId)
  const {
    createProgram,
    updateProgram,
    deleteProgram,
    runProgram,
    creatingProgram,
    updatingProgram,
    deletingProgram,
    runningProgram,
  } = useOpenClawMutations()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProgram, setEditingProgram] =
    useState<BrowserOSAgentProgram | null>(null)
  const [viewingRunId, setViewingRunId] = useState<string | null>(null)

  const programNames = useMemo(
    () =>
      Object.fromEntries(programs.map((program) => [program.id, program.name])),
    [programs],
  )
  const viewingRun: BrowserOSProgramRun | null = viewingRunId
    ? (runs.find((run) => run.id === viewingRunId) ?? null)
    : null

  const saving = creatingProgram || updatingProgram

  const handleCreate = async (
    input: CreateAgentProgramInput | UpdateAgentProgramInput,
  ) => {
    try {
      if (editingProgram) {
        await updateProgram({
          agentId: agent.agentId,
          programId: editingProgram.id,
          input: input as UpdateAgentProgramInput,
        })
        toast.success('Program updated')
      } else {
        await createProgram({
          agentId: agent.agentId,
          input: input as CreateAgentProgramInput,
        })
        toast.success('Program created')
      }
      setDialogOpen(false)
      setEditingProgram(null)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save program',
      )
    }
  }

  const handleToggle = async (
    program: BrowserOSAgentProgram,
    enabled: boolean,
  ) => {
    try {
      await updateProgram({
        agentId: agent.agentId,
        programId: program.id,
        input: { enabled },
      })
      toast.success(enabled ? 'Program enabled' : 'Program disabled')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update program',
      )
    }
  }

  const handleDelete = async (program: BrowserOSAgentProgram) => {
    try {
      await deleteProgram({
        agentId: agent.agentId,
        programId: program.id,
      })
      toast.success(`Deleted "${program.name}"`)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete program',
      )
    }
  }

  const handleRunNow = async (program: BrowserOSAgentProgram) => {
    try {
      const result = await runProgram({
        agentId: agent.agentId,
        programId: program.id,
      })
      if (result.run.status === 'failed') {
        toast.error(
          result.run.error ?? `Program run failed for "${program.name}"`,
        )
        return
      }
      toast.success(`Completed "${program.name}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Program run failed')
    }
  }

  const inlineError = programsError?.message ?? runsError?.message ?? null

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="font-bold text-2xl">{agent.name} Programs</h1>
          <p className="text-muted-foreground text-sm">
            Define and manually test reusable responsibilities for this agent.
          </p>
        </div>
      </div>

      {inlineError && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-destructive text-sm">
            {inlineError}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Programs</CardTitle>
            <p className="text-muted-foreground text-sm">
              Save schedules now and use manual runs to validate the workflow.
              Automatic schedule execution lands in the next milestone.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingProgram(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="mr-2 size-4" />
            New Program
          </Button>
        </CardHeader>
        <CardContent>
          {programsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : programs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
              No programs yet. Create your first program to define a recurring
              responsibility for this agent.
            </div>
          ) : (
            <div className="space-y-4">
              {programs.map((program) => (
                <div key={program.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{program.name}</div>
                        <Badge
                          variant={program.enabled ? 'default' : 'outline'}
                        >
                          {program.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        <Badge variant="secondary">
                          {describeSchedule(program)}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {program.description}
                      </p>
                      <p className="line-clamp-4 text-sm">{program.prompt}</p>
                      <div className="text-muted-foreground text-xs">
                        Last run:{' '}
                        {program.lastRunAt
                          ? new Date(program.lastRunAt).toLocaleString()
                          : 'Never'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                        <span className="text-sm">Enabled</span>
                        <Switch
                          checked={program.enabled}
                          onCheckedChange={(checked) =>
                            void handleToggle(program, checked)
                          }
                          disabled={updatingProgram}
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => void handleRunNow(program)}
                        disabled={runningProgram}
                      >
                        <Play className="mr-2 size-4" />
                        Run Now
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingProgram(program)
                          setDialogOpen(true)
                        }}
                      >
                        <CalendarClock className="mr-2 size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleDelete(program)}
                        disabled={deletingProgram}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {program.standingOrders.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <div className="space-y-2">
                        <div className="font-medium text-sm">
                          Standing Orders
                        </div>
                        <div className="space-y-2">
                          {program.standingOrders.map((order) => (
                            <div
                              key={order.id}
                              className="rounded-md bg-muted/40 px-3 py-2 text-sm"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {order.title}
                                </span>
                                <Badge
                                  variant={
                                    order.enabled ? 'secondary' : 'outline'
                                  }
                                >
                                  {order.enabled ? 'Enabled' : 'Disabled'}
                                </Badge>
                              </div>
                              <p className="mt-1 text-muted-foreground text-xs">
                                {order.instruction}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProgramRunHistory
        runs={runs}
        loading={runsLoading}
        programNames={programNames}
        onViewRun={(run) => setViewingRunId(run.id)}
      />

      <ProgramFormDialog
        open={dialogOpen}
        program={editingProgram}
        saving={saving}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingProgram(null)
          }
        }}
        onSave={handleCreate}
      />

      <ProgramRunResultDialog
        run={viewingRun}
        programName={
          viewingRun
            ? (programNames[viewingRun.programId] ?? 'Unknown Program')
            : undefined
        }
        onOpenChange={(open) => !open && setViewingRunId(null)}
      />
    </div>
  )
}
