import type { HookOf, Register } from 'claude-code'

const SERVER = 'http://127.0.0.1:3190'
const TOOL_PAGE = 'http://localhost:3190'
const BROWSER = 'Claude_Browser'
const POLL_MS = 2000
const START_TRIES = 30
// The chat is named after the person's last prompt, so notification turns are skipped.
const PERSON_ORIGINS = ['composer', 'bridge', 'sdk', 'unclassified']
const MOD_FOLDER = /[\\/]claude-mod[\\/]?$/

type Inbox = { messages: { id: string; text: string }[] }
type Host = Parameters<HookOf<'session.start'>>[0]

const isToolUp = async ($: Host) => {
  const reply = await $.http.fetch(`${SERVER}/api/claude/state`).catch(() => null)
  return reply?.ok === true
}

// The tool sits one folder above this mod, which CLAUDE_CODE_PLUGIN_DIRS names.
const startTool = async ($: Host) => {
  const dirs = (await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? ''
  const home = dirs.split(';').find(dir => MOD_FOLDER.test(dir))?.replace(MOD_FOLDER, '')
  if (!home) return false

  const logs = `${home}\\data`
  await $.process.run([
    'powershell',
    '-NoProfile',
    '-Command',
    `New-Item -ItemType Directory -Force '${logs}' | Out-Null; ` +
      `Start-Process -FilePath '${home}\\start.cmd' -WorkingDirectory '${home}' -WindowStyle Hidden ` +
      `-RedirectStandardOutput '${logs}\\server.log' -RedirectStandardError '${logs}\\server.err.log'`,
  ])
  for (let tries = 0; tries < START_TRIES; tries++) {
    await $.clock.sleep(1000)
    if (await isToolUp($)) return true
  }
  return false
}

const paneAddress = async ($: Host) => {
  const reply = await $.mcp
    .call(BROWSER, 'javascript_tool', { action: 'javascript_exec', text: 'location.href' })
    .catch(() => null)
  const text = reply?.isError ? undefined : reply?.content[0]?.text
  try {
    return text ? String(JSON.parse(text)) : ''
  } catch {
    return ''
  }
}

const toolAddress = (page: string) => {
  if (/^https?:/.test(page)) return `${TOOL_PAGE}/?live=${encodeURIComponent(page)}`
  const pdf = /^file:\/+(.+\.pdf)(?:[?#].*)?$/i.exec(page)?.[1]
  if (pdf) return `${TOOL_PAGE}/?pdf=${encodeURIComponent(decodeURIComponent(pdf).replaceAll('/', '\\'))}`
  return TOOL_PAGE
}

export const register: Register = on => {
  let label = ''
  let isOpening = false

  const openTool = async ($: Host) => {
    if (isOpening) return
    isOpening = true
    try {
      if (!(await isToolUp($)) && !(await startTool($))) {
        $.ui.toast('Annotate could not start. Run start.cmd in Tools/annotate.')
        return
      }
      const page = await paneAddress($)
      if (page.startsWith(TOOL_PAGE)) {
        $.ui.toast('Annotate is already open in the browser pane.')
        return
      }
      const reply = await $.mcp.call(BROWSER, 'navigate', { url: toolAddress(page) })
      if (reply.isError) $.ui.toast(`Annotate could not open: ${reply.content[0]?.text ?? 'no reason given'}`)
    } catch (error) {
      $.ui.toast(`Annotate could not open: ${String(error)}`)
    } finally {
      isOpening = false
    }
  }

  on('prompt.submit', ($, e, next) => {
    const isPerson = PERSON_ORIGINS.includes(e.origin?.kind ?? '')
    if (isPerson && !e.text.startsWith('<')) label = e.text.trim().slice(0, 48)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Button key="annotate" label="Annotate" onPress={() => void openTool($)} />
        <Text dimColor> Mark up the page in the browser pane</Text>
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const session = await $.session.id()
    const cwd = await $.session.cwd()
    const folder = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'session'
    let isPolling = false

    const poll = async () => {
      const name = encodeURIComponent(label || folder)
      const reply = await $.http.fetch(`${SERVER}/api/claude/poll?session=${session}&name=${name}`)
      if (!reply.ok) return
      const { messages } = JSON.parse(reply.text) as Inbox
      for (const message of messages) {
        await $.prompt.submit({ text: message.text, asUser: true }).catch(() =>
          $.http.fetch(`${SERVER}/api/claude/requeue`, { method: 'POST', body: JSON.stringify({ id: message.id }) }),
        )
      }
    }

    $.clock.every(POLL_MS, () => {
      if (isPolling) return
      isPolling = true
      void poll()
        .catch(() => undefined)
        .finally(() => {
          isPolling = false
        })
    })

    return started
  })
}
