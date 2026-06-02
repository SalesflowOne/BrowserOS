import type { Attachment } from '../../shared/attachments.js'

export function formatAttachmentBlock(attachments: Attachment[]): string {
  if (attachments.length === 0) return ''
  const lines = attachments.map((a) => formatLine(a))
  return `[Attached browser tabs]\n${lines.join('\n')}\n\n`
}

function formatLine(a: Attachment): string {
  return `- pageId=${a.pageId} tabId=${a.tabId} url=${a.url} title=${JSON.stringify(a.title)}`
}
