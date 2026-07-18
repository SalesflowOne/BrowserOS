import { type TaskDetail, useSessionDetail } from '@/modules/api/audit.hooks'

export interface TaskDetailScreenData {
  detail: TaskDetail | undefined
  isPending: boolean
  isError: boolean
  error: Error | null
}

export function useTaskDetailScreenData(
  sessionId: string,
): TaskDetailScreenData {
  const query = useSessionDetail({ variables: { sessionId } })
  return {
    detail: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
  }
}
