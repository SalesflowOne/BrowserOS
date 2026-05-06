import { afterAll, describe, it } from 'bun:test'
import assert from 'node:assert'
import type { Browser } from '../../src/browser/browser'
import { disposeSemanticPipeline } from '../../src/tools/acl/acl-embeddings'
import { executeTool, type ToolContext } from '../../src/tools/framework'
import {
  check,
  click,
  click_at,
  fill,
  hover,
  press_key,
  scroll,
  select_option,
  type_at,
  type_text,
  uncheck,
} from '../../src/tools/input'
import {
  type ClickPoint,
  getPngDimensionsFromBase64,
} from '../../src/tools/molmo-point-client'
import { close_page, navigate_page, new_page } from '../../src/tools/navigation'
import { evaluate_script, take_snapshot } from '../../src/tools/snapshot'
import { cleanupWithBrowser, withBrowser } from '../__helpers__/with-browser'

process.env.ACL_EMBEDDING_DISABLE = 'true'

function textOf(result: {
  content: { type: string; text?: string }[]
}): string {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

function structuredOf<T>(result: { structuredContent?: unknown }): T {
  assert.ok(result.structuredContent, 'Expected structuredContent')
  return result.structuredContent as T
}

function pageIdOf(result: {
  content: { type: string; text?: string }[]
  structuredContent?: unknown
}): number {
  const data = result.structuredContent as { pageId?: number } | undefined
  if (typeof data?.pageId === 'number') return data.pageId
  return Number(textOf(result).match(/Page ID:\s*(\d+)/)?.[1])
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findElementId(snapshotText: string, label: string): number {
  const regex = new RegExp(`\\[(\\d+)\\].*?${escapeRegex(label)}`)
  const match = snapshotText.match(regex)
  if (!match) throw new Error(`Element "${label}" not found in snapshot`)
  return Number.parseInt(match[1], 10)
}

async function pointInsideElement(
  ctx: ToolContext,
  pageId: number,
  elementDomId: string,
): Promise<{ x: number; y: number }> {
  const pointResult = await executeTool(
    evaluate_script,
    {
      page: pageId,
      expression: `(() => {
        const el = document.getElementById(${JSON.stringify(elementDomId)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const insetX = Math.max(1, Math.min(10, Math.floor(rect.width / 4)));
        const insetY = Math.max(1, Math.min(10, Math.floor(rect.height / 4)));
        const candidates = [
          {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          },
          {
            x: Math.round(rect.left + insetX),
            y: Math.round(rect.top + insetY),
          },
          {
            x: Math.round(rect.right - insetX),
            y: Math.round(rect.top + insetY),
          },
          {
            x: Math.round(rect.left + insetX),
            y: Math.round(rect.bottom - insetY),
          },
          {
            x: Math.round(rect.right - insetX),
            y: Math.round(rect.bottom - insetY),
          },
        ];
        for (const candidate of candidates) {
          const target = document.elementFromPoint(candidate.x, candidate.y);
          if (target && (target === el || el.contains(target))) {
            return { ...candidate, matched: true, hitId: target.id || null };
          }
        }
        const fallback = candidates[0];
        const fallbackTarget = document.elementFromPoint(fallback.x, fallback.y);
        return {
          ...fallback,
          matched: false,
          hitId: fallbackTarget instanceof Element ? fallbackTarget.id || null : null,
        };
      })()`,
    },
    ctx,
    AbortSignal.timeout(30_000),
  )
  const point = structuredOf<{
    value: { x: number; y: number; matched: boolean; hitId: string | null }
  } | null>(pointResult)?.value
  assert.ok(point, `Expected a point for #${elementDomId}`)
  assert.ok(
    point.matched,
    `Expected coordinates inside #${elementDomId}, got ${point.hitId ?? 'null'}`,
  )
  return { x: point.x, y: point.y }
}

async function withMockedGuiPoint(
  browser: Browser,
  pageId: number,
  viewportPoint: ClickPoint,
  fn: () => Promise<void>,
): Promise<void> {
  const screenshot = await browser.screenshot(pageId, {
    format: 'png',
    fullPage: false,
  })
  const dimensions = getPngDimensionsFromBase64(screenshot.data)
  const viewport = await browser.viewportSize(pageId)
  const scaleX = dimensions
    ? dimensions.width / viewport.width
    : screenshot.devicePixelRatio
  const scaleY = dimensions
    ? dimensions.height / viewport.height
    : screenshot.devicePixelRatio
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        points: [{ x: viewportPoint.x * scaleX, y: viewportPoint.y * scaleY }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const FORM_PAGE = `data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html><body>
  <h1>Test Form</h1>
  <form id="test-form">
    <input id="name" type="text" placeholder="Enter name" />
    <input id="agree" type="checkbox" />
    <label for="agree">I agree</label>
    <select id="color">
      <option value="red">Red</option>
      <option value="green">Green</option>
      <option value="blue">Blue</option>
    </select>
    <button id="submit-btn" type="button">Submit</button>
  </form>
  <div id="output"></div>
  <div id="key-log"></div>
  <div style="height:3000px"></div>
  <div id="bottom">Bottom of page</div>
  <script>
    document.getElementById('submit-btn').addEventListener('click', function() {
      document.getElementById('output').textContent = 'clicked:' + document.getElementById('name').value;
    });
    document.getElementById('name').addEventListener('keydown', function(e) {
      var log = document.getElementById('key-log');
      log.textContent = (log.textContent || '') + 'keydown:' + e.key + ' ';
    });
    document.getElementById('name').addEventListener('keypress', function(e) {
      var log = document.getElementById('key-log');
      log.textContent = (log.textContent || '') + 'keypress:' + e.key + ' ';
    });
    document.getElementById('name').addEventListener('keyup', function(e) {
      var log = document.getElementById('key-log');
      log.textContent = (log.textContent || '') + 'keyup:' + e.key + ' ';
    });
  </script>
</body></html>`)}`

afterAll(async () => {
  await disposeSemanticPipeline()
  await cleanupWithBrowser()
})

describe('input tools', () => {
  it('fill types text into an input', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await execute(take_snapshot, { page: pageId })
      const snapText = textOf(snap)
      const inputId = findElementId(snapText, 'Enter name')

      const fillResult = await execute(fill, {
        page: pageId,
        element: inputId,
        text: 'John Doe',
      })
      assert.ok(!fillResult.isError, textOf(fillResult))
      const fillData = structuredOf<{ action: string; textLength: number }>(
        fillResult,
      )
      assert.strictEqual(fillData.action, 'fill')
      assert.strictEqual(fillData.textLength, 'John Doe'.length)

      const val = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("name").value',
      })
      assert.strictEqual(textOf(val), 'John Doe')

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('click triggers a button', async () => {
    await withBrowser(async ({ browser, execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      // Fill the input first
      const snap = await execute(take_snapshot, { page: pageId })
      const snapText = textOf(snap)
      const inputId = findElementId(snapText, 'Enter name')
      await execute(fill, { page: pageId, element: inputId, text: 'Alice' })

      // Click submit via the GUI point model response.
      const buttonPoint = await pointInsideElement(
        { browser, directories: { workingDir: process.cwd() } },
        pageId,
        'submit-btn',
      )
      await withMockedGuiPoint(browser, pageId, buttonPoint, async () => {
        const clickResult = await execute(click, {
          page: pageId,
          prompt: 'click the Submit button',
        })
        assert.ok(!clickResult.isError, textOf(clickResult))
        assert.match(
          textOf(clickResult),
          /The click was successful and hit the element: .*tagName="button".*textContent="Submit"/,
        )
        const clickData = structuredOf<{
          action: string
          prompt: string
          hitElement: { tagName: string; textContent?: string } | null
        }>(clickResult)
        assert.strictEqual(clickData.action, 'click')
        assert.strictEqual(clickData.prompt, 'click the Submit button')
        assert.strictEqual(clickData.hitElement?.tagName, 'button')
      })

      const output = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("output").textContent',
      })
      assert.strictEqual(textOf(output), 'clicked:Alice')

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('click is blocked by ACL after the GUI point resolves', async () => {
    await withBrowser(async ({ browser }) => {
      const ctx: ToolContext = {
        browser,
        directories: { workingDir: process.cwd() },
        aclRules: [
          {
            id: 'submit-rule',
            sitePattern: '*',
            textMatch: 'Submit',
            enabled: true,
          },
        ],
      }

      const newResult = await executeTool(
        new_page,
        { url: FORM_PAGE },
        ctx,
        AbortSignal.timeout(30_000),
      )
      const pageId = pageIdOf(newResult)
      const buttonPoint = await pointInsideElement(ctx, pageId, 'submit-btn')

      await withMockedGuiPoint(browser, pageId, buttonPoint, async () => {
        const clickResult = await executeTool(
          click,
          { page: pageId, prompt: 'click the Submit button' },
          ctx,
          AbortSignal.timeout(30_000),
        )
        assert.ok(clickResult.isError, 'Expected ACL to block GUI click')
        assert.ok(textOf(clickResult).includes('Action blocked by ACL rule'))
      })

      const output = await executeTool(
        evaluate_script,
        {
          page: pageId,
          expression: 'document.getElementById("output").textContent',
        },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.strictEqual(textOf(output), '')

      await executeTool(
        close_page,
        { page: pageId },
        ctx,
        AbortSignal.timeout(30_000),
      )
    })
  }, 60_000)

  it('check and uncheck toggle a checkbox', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await execute(take_snapshot, { page: pageId })
      const snapText = textOf(snap)
      const checkboxId = findElementId(snapText, 'I agree')

      const checkResult = await execute(check, {
        page: pageId,
        element: checkboxId,
      })
      assert.ok(!checkResult.isError, textOf(checkResult))

      const checked = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("agree").checked',
      })
      assert.strictEqual(textOf(checked), 'true')

      const uncheckResult = await execute(uncheck, {
        page: pageId,
        element: checkboxId,
      })
      assert.ok(!uncheckResult.isError, textOf(uncheckResult))

      const unchecked = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("agree").checked',
      })
      assert.strictEqual(textOf(unchecked), 'false')

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('select_option selects a dropdown value', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      // Use evaluate_script to get the select element's backendNodeId directly
      const nodeId = await execute(evaluate_script, {
        page: pageId,
        expression:
          '(() => { const el = document.getElementById("color"); return el ? el.getAttribute("id") : null })()',
      })
      assert.strictEqual(textOf(nodeId), 'color')

      // Get the select element ID from the snapshot
      const snap = await execute(take_snapshot, { page: pageId })
      const snapText = textOf(snap)

      // Find the combobox/listbox element (the <select>), not an individual option
      const comboboxMatch = snapText.match(
        /\[(\d+)\]\s*(?:combobox|listbox|PopUpButton)/,
      )
      assert.ok(comboboxMatch, `No combobox found in snapshot:\n${snapText}`)
      const selectId = Number(comboboxMatch?.[1])

      const selectResult = await execute(select_option, {
        page: pageId,
        element: selectId,
        value: 'blue',
      })
      assert.ok(!selectResult.isError, textOf(selectResult))
      assert.ok(textOf(selectResult).includes('Blue'))

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('press_key sends a keystroke', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await execute(take_snapshot, { page: pageId })
      const inputId = findElementId(textOf(snap), 'Enter name')
      await execute(fill, { page: pageId, element: inputId, text: 'hello' })

      // Press Backspace to delete last character
      const keyResult = await execute(press_key, {
        page: pageId,
        key: 'Backspace',
      })
      assert.ok(!keyResult.isError, textOf(keyResult))
      assert.ok(textOf(keyResult).includes('Pressed Backspace'))

      const val = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("name").value',
      })
      assert.strictEqual(textOf(val), 'hell')

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('press_key Enter fires keypress event', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await execute(take_snapshot, { page: pageId })
      const inputId = findElementId(textOf(snap), 'Enter name')

      await execute(fill, { page: pageId, element: inputId, text: '' })
      await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("key-log").textContent = ""',
      })

      const keyResult = await execute(press_key, {
        page: pageId,
        key: 'Enter',
      })
      assert.ok(!keyResult.isError, textOf(keyResult))

      const log = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("key-log").textContent',
      })
      const logText = textOf(log)
      assert.ok(
        logText.includes('keydown:Enter'),
        `Expected keydown:Enter in log, got: "${logText}"`,
      )
      assert.ok(
        logText.includes('keypress:Enter'),
        `Expected keypress:Enter in log, got: "${logText}"`,
      )
      assert.ok(
        logText.includes('keyup:Enter'),
        `Expected keyup:Enter in log, got: "${logText}"`,
      )

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('press_key normalizes case-insensitive key names', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await execute(take_snapshot, { page: pageId })
      const inputId = findElementId(textOf(snap), 'Enter name')
      await execute(fill, { page: pageId, element: inputId, text: 'hello' })

      // "backspace" (lowercase) should work the same as "Backspace"
      const keyResult = await execute(press_key, {
        page: pageId,
        key: 'backspace',
      })
      assert.ok(!keyResult.isError, textOf(keyResult))

      const val = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("name").value',
      })
      assert.strictEqual(textOf(val), 'hell')

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('type_text types into the focused element', async () => {
    await withBrowser(async ({ execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await execute(take_snapshot, { page: pageId })
      const inputId = findElementId(textOf(snap), 'Enter name')
      await execute(fill, { page: pageId, element: inputId, text: 'hello' })

      const typeResult = await execute(type_text, {
        page: pageId,
        text: ' world',
      })
      assert.ok(!typeResult.isError, textOf(typeResult))
      assert.strictEqual(textOf(typeResult), 'tool call executed successfully')
      assert.deepStrictEqual(structuredOf(typeResult), {
        action: 'type_text',
        page: pageId,
        textLength: ' world'.length,
      })

      const val = await execute(evaluate_script, {
        page: pageId,
        expression: 'document.getElementById("name").value',
      })
      assert.strictEqual(textOf(val), 'hello world')

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('type_text is blocked by ACL on the focused element', async () => {
    await withBrowser(async ({ browser }) => {
      const ctx: ToolContext = {
        browser,
        directories: { workingDir: process.cwd() },
      }

      const newResult = await executeTool(
        new_page,
        { url: FORM_PAGE },
        ctx,
        AbortSignal.timeout(30_000),
      )
      const pageId = pageIdOf(newResult)

      const snap = await executeTool(
        take_snapshot,
        { page: pageId },
        ctx,
        AbortSignal.timeout(30_000),
      )
      const inputId = findElementId(textOf(snap), 'Enter name')
      await executeTool(
        fill,
        { page: pageId, element: inputId, text: 'hello' },
        ctx,
        AbortSignal.timeout(30_000),
      )

      ctx.aclRules = [
        {
          id: 'name-rule',
          sitePattern: '*',
          textMatch: 'Enter name',
          enabled: true,
        },
      ]

      const typeResult = await executeTool(
        type_text,
        { page: pageId, text: ' blocked' },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.ok(typeResult.isError, 'Expected ACL to block focused typing')
      assert.ok(textOf(typeResult).includes('Action blocked by ACL rule'))

      const val = await executeTool(
        evaluate_script,
        {
          page: pageId,
          expression: 'document.getElementById("name").value',
        },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.strictEqual(textOf(val), 'hello')

      await executeTool(
        close_page,
        { page: pageId },
        ctx,
        AbortSignal.timeout(30_000),
      )
    })
  }, 60_000)

  it('scroll dispatches without error', async () => {
    const calls: Array<{
      page: number
      direction: string
      amount: number
      element?: number
    }> = []
    const browser = {
      getTabIdForPage: () => undefined,
      scroll: async (
        page: number,
        direction: string,
        amount: number,
        element?: number,
      ) => {
        calls.push({ page, direction, amount, element })
      },
    } as unknown as Browser
    const ctx: ToolContext = {
      browser,
      directories: { workingDir: process.cwd() },
    }

    const result = await executeTool(
      scroll,
      { page: 7, direction: 'down', amount: 5 },
      ctx,
      AbortSignal.timeout(1_000),
    )

    assert.ok(!result.isError, textOf(result))
    assert.ok(textOf(result).includes('Scrolled down'))
    assert.deepStrictEqual(calls, [
      { page: 7, direction: 'down', amount: 5, element: undefined },
    ])
    assert.deepStrictEqual(structuredOf(result), {
      action: 'scroll',
      page: 7,
      direction: 'down',
      amount: 5,
    })
  })

  it('hover moves cursor via the GUI point model response', async () => {
    await withBrowser(async ({ browser, execute }) => {
      const newResult = await execute(new_page, { url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const buttonPoint = await pointInsideElement(
        { browser, directories: { workingDir: process.cwd() } },
        pageId,
        'submit-btn',
      )
      await withMockedGuiPoint(browser, pageId, buttonPoint, async () => {
        const hoverResult = await execute(hover, {
          page: pageId,
          prompt: 'hover the Submit button',
        })
        assert.ok(!hoverResult.isError, textOf(hoverResult))
        assert.strictEqual(
          textOf(hoverResult),
          'tool call executed successfully',
        )
        const hoverData = structuredOf<{ action: string; prompt: string }>(
          hoverResult,
        )
        assert.strictEqual(hoverData.action, 'hover')
        assert.strictEqual(hoverData.prompt, 'hover the Submit button')
      })

      await execute(close_page, { page: pageId })
    })
  }, 60_000)

  it('applies updated ACL rules on an existing tool context', async () => {
    await withBrowser(async ({ browser }) => {
      const ctx: ToolContext = {
        browser,
        directories: { workingDir: process.cwd() },
      }
      const run =
        (tool: typeof new_page | typeof take_snapshot | typeof fill) =>
        (args: unknown) =>
          executeTool(tool, args, ctx, AbortSignal.timeout(30_000))

      const newResult = await run(new_page)({ url: FORM_PAGE })
      const pageId = pageIdOf(newResult)

      const snap = await run(take_snapshot)({ page: pageId })
      const inputId = findElementId(textOf(snap), 'Enter name')

      const beforeBlock = await run(fill)({
        page: pageId,
        element: inputId,
        text: 'Allowed',
      })
      assert.ok(!beforeBlock.isError, textOf(beforeBlock))

      ctx.aclRules = [
        {
          id: 'name-rule',
          sitePattern: '*',
          textMatch: 'Enter name',
          enabled: true,
        },
      ]

      const afterBlock = await run(fill)({
        page: pageId,
        element: inputId,
        text: 'Blocked',
      })
      assert.ok(afterBlock.isError, 'Expected ACL block after updating rules')
      assert.ok(textOf(afterBlock).includes('Action blocked by ACL rule'))

      await executeTool(
        close_page,
        { page: pageId },
        ctx,
        AbortSignal.timeout(30_000),
      )
    })
  }, 60_000)

  it('blocks coordinate-based actions with ACL intent rules', async () => {
    await withBrowser(async ({ browser }) => {
      const ctx: ToolContext = {
        browser,
        directories: { workingDir: process.cwd() },
        aclRules: [
          {
            id: 'submit-rule',
            sitePattern: '*',
            textMatch: 'Submit',
            enabled: true,
          },
          {
            id: 'name-rule',
            sitePattern: '*',
            textMatch: 'Enter name',
            enabled: true,
          },
        ],
      }

      const newResult = await executeTool(
        new_page,
        { url: FORM_PAGE },
        ctx,
        AbortSignal.timeout(30_000),
      )
      const pageId = pageIdOf(newResult)

      const buttonPoint = await pointInsideElement(ctx, pageId, 'submit-btn')

      const blockedClick = await executeTool(
        click_at,
        { page: pageId, x: buttonPoint.x, y: buttonPoint.y },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.ok(blockedClick.isError, 'Expected click_at to be blocked')

      ctx.aclRules = [
        {
          id: 'site-lock',
          sitePattern: '*',
          enabled: true,
        },
      ]

      const inputPoint = await pointInsideElement(ctx, pageId, 'name')

      const blockedType = await executeTool(
        type_at,
        { page: pageId, x: inputPoint.x, y: inputPoint.y, text: 'blocked' },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.ok(blockedType.isError, 'Expected type_at to be blocked')

      await executeTool(
        close_page,
        { page: pageId },
        ctx,
        AbortSignal.timeout(30_000),
      )
    })
  }, 60_000)

  it('matches site ACLs after navigation with fresh page info', async () => {
    await withBrowser(async ({ browser }) => {
      const ctx: ToolContext = {
        browser,
        directories: { workingDir: process.cwd() },
        aclRules: [
          {
            id: 'example-site-rule',
            sitePattern: 'example.com',
            enabled: true,
          },
        ],
      }

      const newResult = await executeTool(
        new_page,
        { url: 'about:blank' },
        ctx,
        AbortSignal.timeout(30_000),
      )
      const pageId = pageIdOf(newResult)

      const navResult = await executeTool(
        navigate_page,
        { page: pageId, action: 'url', url: 'https://example.com' },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.ok(!navResult.isError, textOf(navResult))

      const blockedClick = await executeTool(
        click_at,
        { page: pageId, x: 10, y: 10 },
        ctx,
        AbortSignal.timeout(30_000),
      )
      assert.ok(
        blockedClick.isError,
        'Expected example.com ACL to match after navigation',
      )

      await executeTool(
        close_page,
        { page: pageId },
        ctx,
        AbortSignal.timeout(30_000),
      )
    })
  }, 60_000)
})
