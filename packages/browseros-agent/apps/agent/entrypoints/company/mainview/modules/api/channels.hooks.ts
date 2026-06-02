// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: hooks + SSE reducer in one file
import type { InferRequestType, InferResponseType } from 'hono/client'
import { useEffect, useReducer, useRef } from 'react'
import { createMutation, createQuery } from 'react-query-kit'
import type { BrowserTabAttachment } from '../../../shared/attachments'
import { API_BASE_URL, api } from './client'
import { parseResponse } from './parseResponse'
import { queryClient } from './queryClient'

const $list = api.channels.$get
const $create = api.channels.$post
const $detail = api.channels[':id'].$get
const $patch = api.channels[':id'].$patch
const $archive = api.channels[':id'].archive.$post
const $addMember = api.channels[':id'].members.$post
const $removeMember = api.channels[':id'].members[':employeeId'].$delete
const $listMessages = api.channels[':id'].messages.$get
const $postMessage = api.channels[':id'].messages.$post
const $stop = api.channels[':id'].stop.$post

// Drop the `{ error }` failure branch so call-sites see the success shape.
type StripError<T> = Exclude<T, { error: string }>

// fallow-ignore-next-line unused-type
export type ChannelListItem = StripError<
  InferResponseType<typeof $list>
>[number]
export type ChannelDetail = StripError<InferResponseType<typeof $detail>>
export type TranscriptEntry = StripError<
  InferResponseType<typeof $listMessages>
>[number]
type CreateInput = InferRequestType<typeof $create>['json']
type PatchInput = InferRequestType<typeof $patch>['json']
type AddMemberInput = InferRequestType<typeof $addMember>['json']
type PostMessageInput = {
  id: string
  text: string
  to?: string
  attachments?: BrowserTabAttachment[]
}

export const useChannels = createQuery<ChannelListItem[]>({
  queryKey: ['channels'],
  fetcher: () => $list().then(parseResponse<ChannelListItem[]>),
})

export const useChannel = createQuery<ChannelDetail, { id: string }>({
  queryKey: ['channels', 'detail'],
  fetcher: ({ id }) =>
    $detail({ param: { id } }).then(parseResponse<ChannelDetail>),
})

export const useChannelMessages = createQuery<
  TranscriptEntry[],
  { id: string }
>({
  queryKey: ['channels', 'messages'],
  fetcher: ({ id }) =>
    $listMessages({ param: { id } }).then(parseResponse<TranscriptEntry[]>),
})

export const useCreateChannel = createMutation<ChannelListItem, CreateInput>({
  mutationFn: (json) => $create({ json }).then(parseResponse<ChannelListItem>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useChannels.getKey() })
  },
})

export const usePatchChannel = createMutation<
  ChannelDetail,
  { id: string } & PatchInput
>({
  mutationFn: ({ id, ...patch }) =>
    $patch({ param: { id }, json: patch }).then(parseResponse<ChannelDetail>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useChannels.getKey() })
    queryClient.invalidateQueries({ queryKey: useChannel.getKey() })
  },
})

export const useArchiveChannel = createMutation<{ ok: true }, { id: string }>({
  mutationFn: ({ id }) =>
    $archive({ param: { id } }).then(parseResponse<{ ok: true }>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useChannels.getKey() })
  },
})

export const useAddChannelMember = createMutation<
  { memberIds: string[] },
  { id: string } & AddMemberInput
>({
  mutationFn: ({ id, employeeId }) =>
    $addMember({ param: { id }, json: { employeeId } }).then(
      parseResponse<{ memberIds: string[] }>,
    ),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useChannel.getKey() })
    queryClient.invalidateQueries({ queryKey: useChannels.getKey() })
  },
})

export const useRemoveChannelMember = createMutation<
  { memberIds: string[] },
  { id: string; employeeId: string }
>({
  mutationFn: ({ id, employeeId }) =>
    $removeMember({ param: { id, employeeId } }).then(
      parseResponse<{ memberIds: string[] }>,
    ),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useChannel.getKey() })
    queryClient.invalidateQueries({ queryKey: useChannels.getKey() })
  },
})

export const usePostChannelMessage = createMutation<
  { accepted: true },
  PostMessageInput
>({
  mutationFn: ({ id, text, to, attachments }) =>
    $postMessage({ param: { id }, json: { text, to, attachments } }).then(
      parseResponse<{ accepted: true }>,
    ),
})

export const useStopChannel = createMutation<
  { ok: true; interrupted: boolean },
  { id: string }
>({
  mutationFn: ({ id }) =>
    $stop({ param: { id } }).then(
      parseResponse<{ ok: true; interrupted: boolean }>,
    ),
})

// SSE event stream + reducer
const EVENT_KINDS = [
  'transcript.append',
  'text.delta',
  'text.end',
  'turn.start',
  'turn.end',
  'meta.active-page-id',
] as const

type EventKind = (typeof EVENT_KINDS)[number]

type StreamedEvent = {
  kind: EventKind
  seq: number
  ts: number
} & Record<string, unknown>

export interface ChannelStreamState {
  // Finalised + currently-streaming rows. A row in `'streaming'` is
  // mid-turn; `text.delta` events append to its body.
  transcript: TranscriptEntry[]
  // Employees mid-turn (between turn.start and turn.end). Multiple can
  // stream in parallel. Seeded on hydrate from any `'streaming'` row so
  // Stop survives navigation.
  activeEmployees: Set<string>
  // Latest pageId any browseros tool in the channel touched, fed by
  // `meta.active-page-id` SSE events. Null on cold-server reconnect —
  // Channel.tsx falls back to a transcript-prose scan in that case.
  activePageId: number | null
  lastSeq: number
}

type Action =
  | { type: 'events'; events: StreamedEvent[] }
  | { type: 'reset' }
  | { type: 'hydrate'; transcript: TranscriptEntry[] }

const INITIAL_STATE: ChannelStreamState = {
  transcript: [],
  activeEmployees: new Set<string>(),
  activePageId: null,
  lastSeq: -1,
}

function reducer(
  state: ChannelStreamState,
  action: Action,
): ChannelStreamState {
  if (action.type === 'reset') return INITIAL_STATE
  if (action.type === 'hydrate') {
    // Seed active set from `'streaming'` rows so Stop survives nav.
    const active = new Set<string>()
    for (const row of action.transcript) {
      if (row.status === 'streaming') active.add(row.fromParticipantId)
    }
    return {
      ...state,
      transcript: [...action.transcript],
      activeEmployees: active,
    }
  }
  let next = state
  for (const event of action.events) {
    if (event.seq <= next.lastSeq) continue
    next = applyEvent(next, event)
  }
  return next
}

function applyEvent(
  state: ChannelStreamState,
  event: StreamedEvent,
): ChannelStreamState {
  const after = { ...state, lastSeq: event.seq }
  switch (event.kind) {
    case 'transcript.append':
      return withTranscriptAppend(after, event)
    case 'turn.start': {
      const employeeId = String(event.employeeId ?? '')
      if (!employeeId) return after
      const active = new Set(after.activeEmployees)
      active.add(employeeId)
      return { ...after, activeEmployees: active }
    }
    case 'text.delta':
      return withTextDelta(after, event)
    case 'turn.end': {
      const employeeId = String(event.employeeId ?? '')
      if (!employeeId) return after
      const active = new Set(after.activeEmployees)
      active.delete(employeeId)
      return { ...after, activeEmployees: active }
    }
    case 'meta.active-page-id': {
      const raw = event.pageId
      const pageId =
        typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null
      if (pageId === null || pageId === after.activePageId) return after
      return { ...after, activePageId: pageId }
    }
    default:
      return after
  }
}

function withTranscriptAppend(
  state: ChannelStreamState,
  event: StreamedEvent,
): ChannelStreamState {
  const entry = event.entry as TranscriptEntry | undefined
  if (!entry) return state
  const existing = state.transcript.findIndex((e) => e.id === entry.id)
  if (existing < 0) {
    return { ...state, transcript: [...state.transcript, entry] }
  }
  // Body-length floor: keep the longer body when a stale persist
  // snapshot arrives after live deltas. Status updates always apply.
  const current = state.transcript[existing]
  if (!current) return state
  const merged: TranscriptEntry = {
    ...entry,
    body: entry.body.length >= current.body.length ? entry.body : current.body,
  }
  return {
    ...state,
    transcript: state.transcript.map((e, i) => (i === existing ? merged : e)),
  }
}

function withTextDelta(
  state: ChannelStreamState,
  event: StreamedEvent,
): ChannelStreamState {
  const employeeId = String(event.employeeId ?? '')
  const chunk = String(event.text ?? '')
  if (!employeeId || !chunk) return state
  // Append to the employee's in-flight streaming row.
  const idx = state.transcript.findIndex(
    (e) => e.fromParticipantId === employeeId && e.status === 'streaming',
  )
  if (idx < 0) return state
  const current = state.transcript[idx]
  if (!current) return state
  return {
    ...state,
    transcript: state.transcript.map((e, i) =>
      i === idx ? { ...current, body: current.body + chunk } : e,
    ),
  }
}

/** Subscribe to SSE for the channel; coalesce deltas via rAF so React
 *  commits at most 60 times per second while the model is streaming. */
export function useChannelEventStream(
  channelId: string | null,
  initialTranscript: TranscriptEntry[] | undefined,
): ChannelStreamState {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const pending = useRef<StreamedEvent[]>([])
  const rafId = useRef<number | null>(null)

  // Order matters: this effect resets before the hydrate effect below
  // re-fills from the API. Inverting it empties the transcript on
  // every navigation back.
  useEffect(() => {
    if (!channelId) return
    dispatch({ type: 'reset' })
    pending.current = []
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    const url = `${API_BASE_URL}/channels/${encodeURIComponent(channelId)}/events`
    const source = new EventSource(url)
    const flush = () => {
      rafId.current = null
      if (pending.current.length === 0) return
      const batch = pending.current
      pending.current = []
      dispatch({ type: 'events', events: batch })
    }
    const handler = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as StreamedEvent
        pending.current.push(parsed)
        // System rows = channel-meta changes (member joined/left, lead
        // changed). Refetch channel + list so the header and sidebar
        // update inline.
        if (parsed.kind === 'transcript.append') {
          const entry = (parsed as { entry?: TranscriptEntry }).entry
          if (entry?.kind === 'system') {
            queryClient.invalidateQueries({
              queryKey: useChannel.getKey({ id: channelId }),
            })
            queryClient.invalidateQueries({
              queryKey: useChannels.getKey(),
            })
          }
        }
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(flush)
        }
      } catch {
        // Malformed; drop. Next valid event resyncs the cursor.
      }
    }
    for (const kind of EVENT_KINDS) source.addEventListener(kind, handler)
    return () => {
      for (const kind of EVENT_KINDS) source.removeEventListener(kind, handler)
      source.close()
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }
      pending.current = []
    }
  }, [channelId])

  // Hydrate after the reset above. Reducer dedupes by entry.id so live
  // SSE events survive a subsequent refetch.
  useEffect(() => {
    if (!initialTranscript) return
    dispatch({ type: 'hydrate', transcript: initialTranscript })
  }, [initialTranscript])

  return state
}
