import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'annotate-inbox',
  component: 'AbovePrompt',
  surface: 'desktop',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const MOD_DIR = 'C:\\tools\\annotate\\claude-mod'
const up = { status: 200, ok: true, headers: {}, text: '{}' }
const textResult = (text: string) => ({ content: [{ type: 'text', text }], isError: false })

test('the button opens the page the pane is showing in the live browser', async ($, on) => {
  const navigated: unknown[] = []
  on('http.fetch', () => ({ value: up }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'javascript_tool') return { value: textResult('"http://localhost:3100/work"') }
    navigated.push(e.args.url)
    return { value: textResult('navigated') }
  })

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'annotate' })

  expect(navigated).toEqual(['http://localhost:3190/?live=http%3A%2F%2Flocalhost%3A3100%2Fwork'])
  await ui.unmount()
})

test('the button says so when the tool is already open', async ($, on) => {
  const toasts: string[] = []
  on('http.fetch', () => ({ value: up }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('mcp.call', () => ({ value: textResult('"http://localhost:3190/?doc=a"') }))

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'annotate' })

  expect(toasts).toEqual(['Annotate is already open in the browser pane.'])
  await ui.unmount()
})

test('the button starts a stopped server, then opens the page', async ($, on) => {
  let isRunning = false
  const started: (readonly string[])[] = []
  const navigated: unknown[] = []
  mock.env(on, { CLAUDE_CODE_PLUGIN_DIRS: MOD_DIR })
  on('clock.sleep', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ...up, ok: isRunning } }))
  on('process.run', (_, e) => {
    started.push(e.argv)
    isRunning = true
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('mcp.call', (_, e) => {
    if (e.tool === 'javascript_tool') return { value: textResult('"about:blank"') }
    navigated.push(e.args.url)
    return { value: textResult('navigated') }
  })

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'annotate' })

  expect(started.length).toBe(1)
  expect(started[0]?.at(-1)).toContain('C:\\tools\\annotate\\start.cmd')
  expect(navigated).toEqual(['http://localhost:3190'])
  await ui.unmount()
})

const startChat = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  chatAgeMs: number,
  paneFailures: number,
) => {
  const navigated: unknown[] = []
  let failures = paneFailures
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'chat' }))
  on('session.cwd', () => ({ value: 'C:\\project' }))
  on('session.usage', () => ({
    value: { startedAt: 1000000 - chatAgeMs, context: {}, rateLimits: [] },
  }))
  on('clock.now', () => ({ value: 1000000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.sleep', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: up }))
  on('mcp.call', (_, e) => {
    if (failures > 0) {
      failures -= 1
      return { value: { content: [], isError: true } }
    }
    navigated.push(e.args.url)
    return { value: textResult('navigated') }
  })

  await $.session.start({ cwd: 'C:\\project', surface: null, isInteractive: false })
  await new Promise(done => setTimeout(done, 50))
  return navigated
}

test('a brand new chat opens the tool', async ($, on) => {
  expect(await startChat($, on, 3000, 0)).toEqual(['http://localhost:3190'])
})

test('a new chat waits for the pane to come up', async ($, on) => {
  expect(await startChat($, on, 3000, 3)).toEqual(['http://localhost:3190'])
})

test('a resumed chat leaves the pane alone', async ($, on) => {
  expect(await startChat($, on, 3600000, 0)).toEqual([])
})

test('the button explains itself when the server cannot start', async ($, on) => {
  const toasts: string[] = []
  mock.env(on, {})
  on('http.fetch', () => ({ value: { ...up, ok: false } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'annotate' })

  expect(toasts).toEqual(['Annotate could not start. Run start.cmd in Tools/annotate.'])
  await ui.unmount()
})
