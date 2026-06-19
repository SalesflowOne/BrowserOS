import { z } from 'zod'
import { defineTool } from './framework'

export const screenshot = defineTool({
  name: 'screenshot',
  description:
    'Capture a PNG screenshot of the page, returned inline. Use when visual layout matters; prefer snapshot for structure/actions.',
  input: z.object({
    page: z.number().int(),
    fullPage: z.boolean().optional().describe('Capture beyond the viewport.'),
    annotate: z
      .boolean()
      .optional()
      .describe('Overlay numbered refs from a fresh snapshot. Defaults true.'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => {
    const result = await ctx.session.screenshot(args.page, {
      format: 'png',
      fullPage: args.fullPage ?? false,
      annotate: args.annotate ?? true,
    })
    return {
      content: [{ type: 'image', data: result.data, mimeType: 'image/png' }],
      ...(result.annotations.length > 0 && {
        structuredContent: {
          page: args.page,
          annotations: result.annotations,
        },
      }),
    }
  },
})
