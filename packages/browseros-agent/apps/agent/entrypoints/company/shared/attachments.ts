import { z } from 'zod'

const browserTabAttachmentSchema = z.object({
  kind: z.literal('browserTab'),
  pageId: z.number().int(),
  tabId: z.number().int(),
  url: z.string().min(1).max(2048),
  title: z.string().max(500),
})

export const attachmentSchema = z.discriminatedUnion('kind', [
  browserTabAttachmentSchema,
])

export type BrowserTabAttachment = z.infer<typeof browserTabAttachmentSchema>
export type Attachment = z.infer<typeof attachmentSchema>
