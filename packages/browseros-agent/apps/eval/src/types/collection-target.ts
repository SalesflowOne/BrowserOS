import { z } from 'zod'

export const CollectionStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial') }),
  z.object({
    kind: z.literal('scroll'),
    pixels: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('click_and_wait'),
    backend_id: z.number().int().positive(),
    wait_ms: z.number().int().positive().default(1000),
  }),
  z.object({
    kind: z.literal('evaluate'),
    expression: z.string().min(1),
    wait_ms: z.number().int().nonnegative().default(300),
  }),
])

export const CollectionTargetSchema = z.object({
  site: z.string().regex(/^[a-z0-9_]+$/, 'site must match [a-z0-9_]+'),
  url: z.string().url(),
  states: z.array(CollectionStateSchema).min(1).max(10),
  category: z.string().optional(),
})

export const ElementRecordSchema = z.object({
  backend_id: z.number().int(),
  role: z.string(),
  name: z.string(),
  bbox: z.tuple([
    z.number().int(),
    z.number().int(),
    z.number().int(),
    z.number().int(),
  ]),
  snapshot_line: z.string(),
  in_viewport: z.boolean(),
})

export const CollectedRecordSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+_[0-9a-f]{8}$/),
  url: z.string().url(),
  site: z.string(),
  viewport: z.object({
    width: z.literal(1280),
    height: z.literal(800),
  }),
  scroll_y: z.number().int().nonnegative(),
  screenshot_path: z.string(),
  snapshot: z.string(),
  elements: z.array(ElementRecordSchema),
})

export type CollectionState = z.infer<typeof CollectionStateSchema>
export type CollectionTarget = z.infer<typeof CollectionTargetSchema>
export type ElementRecord = z.infer<typeof ElementRecordSchema>
export type CollectedRecord = z.infer<typeof CollectedRecordSchema>
