import { describe, expect, it } from 'bun:test'
import { createConversationUploadScheduler } from './conversation-upload-scheduler'
import type { Conversation } from './conversationStorage'

describe('createConversationUploadScheduler', () => {
  it('uploads only the newest snapshot queued during the debounce window', async () => {
    const uploads: string[][] = []
    const schedule = createConversationUploadScheduler(
      async (conversations) => {
        uploads.push(conversations.map((conversation) => conversation.id))
      },
      { delayMs: 5 },
    )

    schedule([conversation('older')])
    schedule([conversation('newest')])
    await Bun.sleep(20)

    expect(uploads).toEqual([['newest']])
  })

  it('waits for an active upload and keeps only the newest pending snapshot', async () => {
    const uploads: string[][] = []
    const firstUploadStarted = Promise.withResolvers<void>()
    const releaseFirstUpload = Promise.withResolvers<void>()
    const schedule = createConversationUploadScheduler(
      async (conversations) => {
        uploads.push(conversations.map((conversation) => conversation.id))
        if (uploads.length === 1) {
          firstUploadStarted.resolve()
          await releaseFirstUpload.promise
        }
      },
      { delayMs: 5 },
    )

    schedule([conversation('first')])
    await firstUploadStarted.promise
    schedule([conversation('superseded')])
    schedule([conversation('latest')])
    await Bun.sleep(20)

    expect(uploads).toEqual([['first']])

    releaseFirstUpload.resolve()
    await Bun.sleep(20)

    expect(uploads).toEqual([['first'], ['latest']])
  })
})

function conversation(id: string): Conversation {
  return { id, messages: [], lastMessagedAt: 0 }
}
