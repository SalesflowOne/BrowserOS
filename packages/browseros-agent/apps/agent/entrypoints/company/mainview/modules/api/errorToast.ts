import { toast } from 'sonner'

export function toastError(
  err: unknown,
  fallback = 'Something went wrong',
): void {
  const message = err instanceof Error && err.message ? err.message : fallback
  toast.error(message)
}
