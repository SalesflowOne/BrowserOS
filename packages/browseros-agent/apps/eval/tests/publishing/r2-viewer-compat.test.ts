import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ViewerPathResolvers {
  artifactUrl(task: Record<string, unknown>, artifact: string): string
  metadataUrl(task: Record<string, unknown>): string
  messagesUrl(task: Record<string, unknown>): string
  screenshotUrl(task: Record<string, unknown>, step: number): string
}

async function loadViewerPathResolvers(): Promise<ViewerPathResolvers> {
  const html = await readFile(
    join(import.meta.dir, '..', '..', 'src', 'dashboard', 'viewer.html'),
    'utf-8',
  )
  const start = html.indexOf('// -- Artifact path resolution')
  const end = html.indexOf('// -- Task selection', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const block = html.slice(start, end)
  const createResolvers = new Function(
    `
      const basePath = 'runs/run-1';
      ${block}
      return { artifactUrl, metadataUrl, messagesUrl, screenshotUrl };
    `,
  ) as () => ViewerPathResolvers
  return createResolvers()
}

async function runAutoSelectFromHash(hash: string): Promise<unknown> {
  const html = await readFile(
    join(import.meta.dir, '..', '..', 'src', 'dashboard', 'viewer.html'),
    'utf-8',
  )
  const start = html.indexOf('function autoSelectFromHash()')
  const end = html.indexOf('// -- Center panel', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const block = html.slice(start, end)
  const runAutoSelect = new Function(
    `
      const window = { location: { hash: ${JSON.stringify(hash)} } };
      const manifest = {
        tasks: [
          { queryId: 'legacy-task' },
          { queryId: 'new-task', paths: { metadata: 'tasks/new-task/metadata.json' } },
        ],
      };
      let selected = null;
      function selectTask(task) { selected = task; }
      ${block}
      autoSelectFromHash();
      return selected;
    `,
  ) as () => unknown
  return runAutoSelect()
}

describe('R2 viewer artifact path compatibility', () => {
  it('uses explicit manifest paths for new uploaded runs', async () => {
    const resolvers = await loadViewerPathResolvers()
    const task = {
      queryId: 'task-1',
      paths: {
        metadata: 'tasks/task-1/metadata.json',
        messages: 'tasks/task-1/messages.jsonl',
        grades: 'tasks/task-1/grades.json',
        trace: 'tasks/task-1/trace.jsonl',
        screenshots: 'tasks/task-1/screenshots',
        graderArtifacts: 'tasks/task-1/grader-artifacts',
      },
    }

    expect(resolvers.metadataUrl(task)).toBe(
      'runs/run-1/tasks/task-1/metadata.json',
    )
    expect(resolvers.messagesUrl(task)).toBe(
      'runs/run-1/tasks/task-1/messages.jsonl',
    )
    expect(resolvers.artifactUrl(task, 'grades')).toBe(
      'runs/run-1/tasks/task-1/grades.json',
    )
    expect(resolvers.artifactUrl(task, 'trace')).toBe(
      'runs/run-1/tasks/task-1/trace.jsonl',
    )
    expect(resolvers.artifactUrl(task, 'graderArtifacts')).toBe(
      'runs/run-1/tasks/task-1/grader-artifacts',
    )
    expect(resolvers.screenshotUrl(task, 7)).toBe(
      'runs/run-1/tasks/task-1/screenshots/7.png',
    )
  })

  it('falls back to legacy inferred paths for old uploaded runs', async () => {
    const resolvers = await loadViewerPathResolvers()
    const task = { queryId: 'legacy-task' }

    expect(resolvers.metadataUrl(task)).toBe(
      'runs/run-1/legacy-task/metadata.json',
    )
    expect(resolvers.messagesUrl(task)).toBe(
      'runs/run-1/legacy-task/messages.jsonl',
    )
    expect(resolvers.artifactUrl(task, 'grades')).toBe(
      'runs/run-1/legacy-task/grades.json',
    )
    expect(resolvers.artifactUrl(task, 'trace')).toBe(
      'runs/run-1/legacy-task/trace.jsonl',
    )
    expect(resolvers.artifactUrl(task, 'graderArtifacts')).toBe(
      'runs/run-1/legacy-task/grader-artifacts',
    )
    expect(resolvers.screenshotUrl(task, 3)).toBe(
      'runs/run-1/legacy-task/screenshots/3.png',
    )
  })

  it('keeps hash-based task selection independent of artifact layout', async () => {
    expect(await runAutoSelectFromHash('#new-task')).toMatchObject({
      queryId: 'new-task',
    })
    expect(await runAutoSelectFromHash('#legacy-task')).toMatchObject({
      queryId: 'legacy-task',
    })
  })
})
