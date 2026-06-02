import { z } from 'zod'

export const previewSkillSchema = z.object({
  source: z.string().min(1).max(1024),
})

export const installSkillSchema = z.object({
  source: z.string().min(1).max(1024),
  names: z.array(z.string().min(1).max(256)).min(1).max(256),
})

export const setDisabledSchema = z.object({
  disabled: z.boolean(),
})

export const skillRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  disabled: z.boolean(),
  installSource: z.string().nullable(),
  installedAt: z.number(),
  broken: z.boolean(),
})

export type SkillRowDTO = z.infer<typeof skillRowSchema>
