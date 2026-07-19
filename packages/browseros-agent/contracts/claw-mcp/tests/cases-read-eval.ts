/**
 * grep (6), read (5), evaluate (5) and run (4) cases. The grep=ax
 * REGRESSION CASE (#2 in the briefing) lives here: over=ax output must
 * still carry `[ref=eN]` handles after the serde fix. Spill behavior is
 * asserted through the `saved to: <path>` marker both formatters emit.
 */

import type { CaseContext, ContractCase } from './cases'
import { expectOk, waitUntil } from './helpers'
import { textOf } from './mcp-client'

const UNTRUSTED = /\[(END_)?UNTRUSTED_PAGE_CONTENT[^\]]*\]/g
const NUDGE = /Tip: this session is[\s\S]*$/

/** Page-derived text with the fence markers and the rename nudge stripped. */
function payload(text: string): string {
  return text.replace(UNTRUSTED, '').replace(NUDGE, '').trim()
}

function spillPath(text: string): string | undefined {
  return text.match(/saved to: (\S+)/)?.[1]
}

async function evalIn(
  ctx: CaseContext,
  page: number,
  code: string,
  timeout?: number,
): Promise<string> {
  const args: Record<string, unknown> = { page, code }
  if (timeout !== undefined) args.timeout = timeout
  return payload(textOf(await ctx.mcp.callTool('evaluate', args)))
}

async function loadBigSection(ctx: CaseContext, page: number): Promise<void> {
  await waitUntil(
    async () =>
      (
        await evalIn(
          ctx,
          page,
          'return String(document.querySelectorAll("#big h6").length)',
        )
      ).includes('3001'),
    'the oversized section to render',
    { timeoutMs: 30_000 },
  )
}

export const readEvalCases: ContractCase[] = [
  // grep -------------------------------------------------------------------
  {
    name: 'grep: over=ax keeps [ref=eN] handles (REGRESSION #2)',
    smoke: true,
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      await ctx.mcp.callTool('snapshot', { page })
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('grep', {
            page,
            pattern: 'Submit',
            over: 'ax',
          }),
          'grep over=ax',
        ),
      )
      if (!/\[ref=e\d+\]/.test(text)) {
        throw new Error(`grep over=ax dropped its refs:\n${text.slice(0, 300)}`)
      }
      ctx.record('grep:ax-keeps-refs', true)
    },
  },
  {
    name: 'grep: over=content searches innerText',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/links.html'))
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('grep', {
            page,
            pattern: 'downloadable report',
            over: 'content',
          }),
          'grep over=content',
        ),
      )
      if (!text.includes('downloadable report')) {
        throw new Error(
          `grep over=content missed the text:\n${text.slice(0, 200)}`,
        )
      }
      // innerText grep does not carry snapshot refs.
      ctx.record('grep:content-no-refs', !/\[ref=e\d+\]/.test(text))
    },
  },
  {
    name: 'grep: pattern is case-insensitive',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      await ctx.mcp.callTool('snapshot', { page })
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('grep', {
            page,
            pattern: 'submit',
            over: 'ax',
          }),
          'grep case-insensitive',
        ),
      )
      ctx.record('grep:case-insensitive', /submit/i.test(text))
    },
  },
  {
    name: 'grep: limit clamps at 200 matches',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/dynamic.html'))
      await loadBigSection(ctx, page)
      const text = expectOk(
        await ctx.mcp.callTool('grep', {
          page,
          pattern: 'filler line',
          over: 'content',
          limit: 500,
        }),
        'grep with limit 500',
      )
      // 3000 lines match but the clamp caps stored matches at 200.
      const path = spillPath(text)
      let matchCount: number
      if (path) {
        const file = await Bun.file(path).text()
        matchCount = (file.match(/filler line/g) ?? []).length
      } else {
        matchCount = (payload(text).match(/filler line/g) ?? []).length
      }
      if (matchCount > 200) {
        throw new Error(
          `grep returned ${matchCount} matches, expected the 200 clamp`,
        )
      }
      ctx.record('grep:limit-clamps-at-200', matchCount === 200)
    },
  },
  {
    name: 'grep: long lines are truncated at 500 chars',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/dynamic.html'))
      await loadBigSection(ctx, page)
      const text = expectOk(
        await ctx.mcp.callTool('grep', {
          page,
          pattern: 'longline',
          over: 'content',
        }),
        'grep long line',
      )
      // The 600-x line comes back clipped with a truncation marker.
      const inlineXs = payload(text).match(/x+/)?.[0].length ?? 0
      ctx.record('grep:line-truncation', {
        marker: /truncat/i.test(text),
        clipped: inlineXs <= 520,
      })
    },
  },
  {
    name: 'grep: large result spills to a file',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/dynamic.html'))
      await loadBigSection(ctx, page)
      const text = expectOk(
        await ctx.mcp.callTool('grep', {
          page,
          pattern: 'filler line',
          over: 'content',
          limit: 200,
        }),
        'grep spill',
      )
      const path = spillPath(text)
      if (!path || !(await Bun.file(path).exists())) {
        throw new Error(`grep did not spill to a readable file: ${path}`)
      }
      ctx.record('grep:spills-large-result', true)
    },
  },

  // read -------------------------------------------------------------------
  {
    name: 'read: markdown format returns page content',
    smoke: true,
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/links.html'))
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('read', { page, format: 'markdown' }),
          'read markdown',
        ),
      )
      if (!text.includes('Section one') || !text.includes('Section two')) {
        throw new Error(
          `read markdown missed page content:\n${text.slice(0, 200)}`,
        )
      }
      ctx.record('read:markdown-has-content', true)
    },
  },
  {
    name: 'read: text format returns plain text',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/links.html'))
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('read', { page, format: 'text' }),
          'read text',
        ),
      )
      ctx.record('read:text-has-content', text.includes('Section one'))
    },
  },
  {
    name: 'read: links format lists anchors',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/links.html'))
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('read', { page, format: 'links' }),
          'read links',
        ),
      )
      ctx.record('read:links-lists-anchors', text.includes('/form.html'))
    },
  },
  {
    name: 'read: console format (rust-only)',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/console.html'))
      const result = await ctx.mcp.callTool('read', { page, format: 'console' })
      // Rust returns captured console entries; the TS schema has no
      // console format and rejects the call (divergence read-console-format).
      ctx.record('read:console-format-supported', result.isError !== true, {
        divergence: 'read-console-format',
      })
      if (ctx.server.name === 'rust') {
        // The capture listener attaches after attach, so load-time entries
        // land only after a reload. read console surfaces warnings/errors
        // (not console.log).
        expectOk(await ctx.mcp.callTool('navigate', { page, action: 'reload' }))
        let text = ''
        await waitUntil(async () => {
          text = payload(
            textOf(await ctx.mcp.callTool('read', { page, format: 'console' })),
          )
          return text.includes('fixture error one')
        }, 'read console to report the page error entry')
      }
    },
  },
  {
    name: 'read: large content spills to a file',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/dynamic.html'))
      await loadBigSection(ctx, page)
      const text = expectOk(
        await ctx.mcp.callTool('read', { page, format: 'text' }),
        'read spill',
      )
      const path = spillPath(text)
      if (!path || !(await Bun.file(path).exists())) {
        throw new Error(`read did not spill oversized content: ${path}`)
      }
      ctx.record('read:spills-large-content', true)
    },
  },

  // evaluate ---------------------------------------------------------------
  {
    name: 'evaluate: returns a value round-trip',
    smoke: true,
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      const text = await evalIn(ctx, page, 'return 6 * 7')
      if (!text.includes('42')) {
        throw new Error(`evaluate did not round-trip the value: ${text}`)
      }
      ctx.record('evaluate:value-round-trip', true)
    },
  },
  {
    name: 'evaluate: awaits a returned promise',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      const text = await evalIn(
        ctx,
        page,
        'return await Promise.resolve("awaited-value")',
      )
      ctx.record('evaluate:awaits-promise', text.includes('awaited-value'))
    },
  },
  {
    name: 'evaluate: a thrown error surfaces in the result',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      const result = await ctx.mcp.callTool('evaluate', {
        page,
        code: 'throw new Error("evaluate-boom")',
      })
      const text = payload(textOf(result))
      if (!result.isError || !text.includes('evaluate-boom')) {
        throw new Error(
          `thrown error not surfaced: isError=${result.isError} text=${text}`,
        )
      }
      ctx.record('evaluate:throw-surfaced', true)
    },
  },
  {
    name: 'evaluate: accepts a timeout parameter',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      // Both servers accept the timeout param; a fast eval under it works.
      const fast = await evalIn(ctx, page, 'return 1 + 1', 5_000)
      if (!fast.includes('2')) {
        throw new Error(`evaluate with a timeout did not return: ${fast}`)
      }
      // VERIFIED SHARED BEHAVIOR: neither server enforces the timeout on a
      // page-context wait (the JS runs in the renderer; CDP can't preempt
      // it), so a 8s delay under a 1.5s timeout still runs to completion.
      // Recorded so a one-sided change to enforce it trips the parity gate.
      const slow = await ctx.mcp.callTool('evaluate', {
        page,
        code: 'await new Promise(r => setTimeout(r, 8000)); return "slow"',
        timeout: 1_500,
      })
      ctx.record(
        'evaluate:timeout-enforced-on-page-wait',
        slow.isError === true,
      )
    },
  },
  {
    name: 'evaluate: large return spills to a file',
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      const text = expectOk(
        await ctx.mcp.callTool('evaluate', {
          page,
          code: 'return "z".repeat(20000)',
        }),
        'evaluate spill',
      )
      const path = spillPath(text)
      if (!path || !(await Bun.file(path).exists())) {
        throw new Error(`evaluate did not spill a large return: ${path}`)
      }
      ctx.record('evaluate:spills-large-return', true)
    },
  },

  // run --------------------------------------------------------------------
  {
    name: 'run: SDK end-to-end pages.list -> snapshot -> click -> return',
    smoke: true,
    async run(ctx) {
      const page = await ctx.openPage(ctx.fixture('/form.html'))
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('run', {
            code: `
              const pages = await browser.pages.list()
              const snap = await browser.observe(${page}).snapshot()
              const applyRef = snap.text.split('\\n').find(l => l.includes('Apply')).match(/\\[ref=(e\\d+)\\]/)[1]
              await browser.input(${page}).click(applyRef)
              return { pageCount: pages.length, applied: true }
            `,
          }),
          'run end-to-end',
        ),
      )
      if (!text.includes('applied')) {
        throw new Error(
          `run end-to-end did not return the expected value:\n${text.slice(0, 300)}`,
        )
      }
      await waitUntil(
        async () =>
          (
            await evalIn(
              ctx,
              page,
              'return document.getElementById("result").textContent',
            )
          ).includes('applied'),
        'the run script click to update #result',
      )
      ctx.record('run:sdk-end-to-end', true)
    },
  },
  {
    name: 'run: captures console.log output',
    async run(ctx) {
      const text = payload(
        expectOk(
          await ctx.mcp.callTool('run', {
            code: 'console.log("run-log-line"); return "done"',
          }),
          'run console capture',
        ),
      )
      ctx.record('run:captures-console', text.includes('run-log-line'))
    },
  },
  {
    name: 'run: an in-script exception comes back as ok:false',
    async run(ctx) {
      const result = await ctx.mcp.callTool('run', {
        code: 'throw new Error("run-boom")',
      })
      const structured = result.structuredContent as
        | { ok?: boolean; error?: string }
        | undefined
      const text = payload(textOf(result))
      const failed =
        structured?.ok === false ||
        result.isError === true ||
        /run-boom/.test(text)
      if (!failed) {
        throw new Error(
          `run swallowed the exception: ${JSON.stringify(structured)} ${text}`,
        )
      }
      ctx.record('run:exception-is-not-ok', true)
    },
  },
  {
    name: 'run: clamps an over-long timeout',
    async run(ctx) {
      // A timeout far over the 30s cap must be clamped, not honored: a
      // hanging script terminates within the clamp, never after 10
      // minutes. (rust errors at ~30s; on TS the SSE stream drops earlier
      // — either way the run does not last 600s.) Accept a thrown
      // socket-close as proof the request did not run to 600s.
      const started = Date.now()
      let terminated = false
      try {
        const result = await ctx.mcp.callTool('run', {
          code: 'await new Promise(() => {}); return "never"',
          timeout: 600_000,
        })
        terminated = result.isError === true
      } catch {
        terminated = true
      }
      const elapsed = Date.now() - started
      if (elapsed > 90_000) {
        throw new Error(`run did not clamp the timeout (elapsed ${elapsed}ms)`)
      }
      ctx.record('run:timeout-clamped', terminated && elapsed < 90_000)
    },
  },
]
