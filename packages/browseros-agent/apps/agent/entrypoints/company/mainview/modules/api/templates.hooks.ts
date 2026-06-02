import type { InferResponseType } from 'hono/client'
import { createQuery } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'

const $list = api.templates.$get

export type HireTemplate = InferResponseType<typeof $list>[number]

export const useHireTemplates = createQuery<HireTemplate[]>({
  queryKey: ['templates'],
  fetcher: () => $list().then(parseResponse<HireTemplate[]>),
  staleTime: Number.POSITIVE_INFINITY,
})
