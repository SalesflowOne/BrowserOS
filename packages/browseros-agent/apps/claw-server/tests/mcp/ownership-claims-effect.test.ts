import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq, isNull } from 'drizzle-orm'
import { applyOwnershipClaims } from '../../src/mcp/effects/ownership-claims'
import {
  getAuditDb,
  resetAuditDbForTesting,
  setAuditDbForTesting,
} from '../../src/modules/db/db'
import { tabClaims } from '../../src/modules/db/schema/tab-claims.sql'

const ok = { isError: false, content: [], structuredContent: undefined }

beforeEach(() => setAuditDbForTesting())
afterEach(() => resetAuditDbForTesting())

describe('recording claims effect', () => {
  it('inserts a target claim after tabs new succeeds', () => {
    applyOwnershipClaims({
      call: {
        sessionId: 'session-a',
        agent: { agentId: 'agent-a', slug: 'agent' },
        key: 'agent-a',
        session: {
          pages: {
            getInfo: () => ({ targetId: 'target-a' }),
          },
        },
        flags: { newPage: true, closePage: false, listTabs: false },
      },
      result: { ...ok, structuredContent: { page: 7 } },
      startedAtMs: 123,
    } as never)

    const claim = getAuditDb().select().from(tabClaims).get()
    expect(claim).toMatchObject({
      targetId: 'target-a',
      sessionId: 'session-a',
      agentId: 'agent-a',
      claimedAt: 123,
      releasedAt: null,
    })
  })

  it('releases the matching open claim after tabs close succeeds', () => {
    getAuditDb()
      .insert(tabClaims)
      .values([
        {
          targetId: 'target-b',
          sessionId: 'session-b',
          agentId: 'agent-b',
          claimedAt: 100,
        },
        {
          targetId: 'target-b',
          sessionId: 'other-session',
          agentId: 'agent-c',
          claimedAt: 200,
        },
      ])
      .run()

    applyOwnershipClaims({
      call: {
        sessionId: 'session-b',
        agent: { agentId: 'agent-b', slug: 'agent' },
        key: 'agent-b',
        args: { page: 8 },
        pageSnapshot: { pageId: 8, targetId: 'target-b', url: '', title: '' },
        flags: { newPage: false, closePage: true, listTabs: false },
      },
      result: ok,
    } as never)

    const released = getAuditDb()
      .select()
      .from(tabClaims)
      .where(
        and(
          eq(tabClaims.sessionId, 'session-b'),
          eq(tabClaims.targetId, 'target-b'),
        ),
      )
      .get()
    expect(released?.releasedAt).toBeNumber()
    expect(
      getAuditDb()
        .select()
        .from(tabClaims)
        .where(
          and(
            eq(tabClaims.sessionId, 'other-session'),
            isNull(tabClaims.releasedAt),
          ),
        )
        .get(),
    ).toBeDefined()
  })
})
