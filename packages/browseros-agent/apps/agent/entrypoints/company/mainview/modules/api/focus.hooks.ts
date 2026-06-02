import type { InferRequestType } from 'hono/client'
import { createMutation } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'

const $post = api.focus.$post
type FocusInput = InferRequestType<typeof $post>['json']

// Fire-and-forget heartbeat for the focused thread. The main process
// keeps an in-memory pointer that the notification dispatcher reads
// together with `mainWindow.isFocused()`. Errors are non-load-bearing:
// the next focus / blur / route change re-reports.
export const useReportFocus = createMutation<unknown, FocusInput>({
  mutationFn: (json) => $post({ json }).then(parseResponse),
})
