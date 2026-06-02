import { api } from '@company/modules/api/client'
import { parseResponse } from '@company/modules/api/parseResponse'
import { queryClient } from '@company/modules/api/queryClient'
import type { InferResponseType } from 'hono/client'
import { createMutation, createQuery } from 'react-query-kit'

const $list = api.skills.$get
const $listBuiltIns = api.skills['built-ins'].$get
const $listExternal = api.skills.external.$get
const $preview = api.skills.preview.$post
const $install = api.skills.$post
const $patch = api.skills[':name'].$patch
const $delete = api.skills[':name'].$delete

type ListResponse = Exclude<InferResponseType<typeof $list>, { error: string }>
type BuiltInsResponse = Exclude<
  InferResponseType<typeof $listBuiltIns>,
  { error: string }
>
type ExternalResponse = Exclude<
  InferResponseType<typeof $listExternal>,
  { error: string }
>
type PreviewResponse = Exclude<
  InferResponseType<typeof $preview>,
  { error: string }
>
type InstallResponse = Exclude<
  InferResponseType<typeof $install>,
  { error: string }
>
type PatchResponse = Exclude<
  InferResponseType<typeof $patch>,
  { error: string }
>
type DeleteResponse = Exclude<
  InferResponseType<typeof $delete>,
  { error: string }
>

export type PreviewedSkill = PreviewResponse['skills'][number]

export type SkillRow = ListResponse['skills'][number]

export type ExternalSkillRow = ExternalResponse['skills'][number]

export const useSkills = createQuery<ListResponse>({
  queryKey: ['skills'],
  fetcher: () => $list().then(parseResponse<ListResponse>),
})

export const useBuiltInSkills = createQuery<BuiltInsResponse>({
  queryKey: ['skills', 'built-ins'],
  fetcher: () => $listBuiltIns().then(parseResponse<BuiltInsResponse>),
})

export const useExternalSkills = createQuery<ExternalResponse>({
  queryKey: ['skills', 'external'],
  fetcher: () => $listExternal().then(parseResponse<ExternalResponse>),
})

export const usePreviewSkillSource = createMutation<
  PreviewResponse,
  { source: string }
>({
  mutationFn: ({ source }) =>
    $preview({ json: { source } }).then(parseResponse<PreviewResponse>),
})

export const useInstallSkill = createMutation<
  InstallResponse,
  { source: string; names: string[] }
>({
  mutationFn: ({ source, names }) =>
    $install({ json: { source, names } }).then(parseResponse<InstallResponse>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useSkills.getKey() })
    queryClient.invalidateQueries({ queryKey: useExternalSkills.getKey() })
  },
})

export const useSetSkillDisabled = createMutation<
  PatchResponse,
  { name: string; disabled: boolean }
>({
  mutationFn: ({ name, disabled }) =>
    $patch({ param: { name }, json: { disabled } }).then(
      parseResponse<PatchResponse>,
    ),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useSkills.getKey() })
    queryClient.invalidateQueries({ queryKey: useExternalSkills.getKey() })
  },
})

export const useUninstallSkill = createMutation<
  DeleteResponse,
  { name: string }
>({
  mutationFn: ({ name }) =>
    $delete({ param: { name } }).then(parseResponse<DeleteResponse>),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: useSkills.getKey() })
    queryClient.invalidateQueries({ queryKey: useExternalSkills.getKey() })
  },
})
