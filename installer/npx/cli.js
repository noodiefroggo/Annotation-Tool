#!/usr/bin/env node
// The developer install: npx github:noodiefroggo/Annotation-Tool
//
// Copies Annotate to a folder of its own (npx's copy is temporary), sets up Python with the
// repo's own start scripts, starts it and opens it. The always-on service and Send to Claude
// are both asked about, and Send is off unless chosen, because it changes Claude's settings.
//
//   --dir <folder>      where to install, ~/.annotate by default
//   --yes               no questions: service on, Send to Claude off
//   --service, --no-service, --send-to-claude, --no-open
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { spawn, spawnSync } = require('child_process')

const windows = process.platform === 'win32'
const mac = process.platform === 'darwin'
const source = path.resolve(__dirname, '..', '..')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const port = Number(process.env.ANNOTATE_PORT || 3190)
const url = `http://localhost:${port}`
const home = path.resolve(option('--dir') || path.join(os.homedir(), '.annotate'))
const venvPython = path.join(home, '.venv', windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python')
// Only these are copied. data/ and .venv/ in an existing install are left alone.
const SKIP = new Set(['.git', '.github', 'installer', 'node_modules', 'data', '.venv', '__pycache__', 'package.json'])

const say = text => console.log(text)
const fail = text => {
  console.error(`\n${text}`)
  process.exit(1)
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { encoding: 'utf8', ...options })
}

function findPython() {
  const candidates = windows ? [['py', '-3'], ['python']] : [['python3'], ['python']]
  for (const [command, ...rest] of candidates) {
    const check = run(command, [...rest, '-c', 'import sys; print(sys.version_info >= (3, 10))'])
    if (check.status === 0 && check.stdout.trim() === 'True') return [command, ...rest]
  }
  return null
}

function findBrowser() {
  if (windows) {
    const bases = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean)
    const names = [['Microsoft Edge', 'Microsoft\\Edge\\Application\\msedge.exe'], ['Google Chrome', 'Google\\Chrome\\Application\\chrome.exe']]
    for (const [label, relative] of names) if (bases.some(base => fs.existsSync(path.join(base, relative)))) return label
    return null
  }
  if (mac) {
    for (const label of ['Microsoft Edge', 'Google Chrome']) if (fs.existsSync(`/Applications/${label}.app`)) return label
    return null
  }
  for (const command of ['microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'google-chrome-stable']) {
    if (run('sh', ['-c', `command -v ${command}`]).status === 0) return command
  }
  return null
}

async function ask(question, fallback) {
  if (flag('--yes') || !process.stdin.isTTY) return fallback
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => prompt.question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `, resolve))
  prompt.close()
  return answer.trim() ? /^y/i.test(answer.trim()) : fallback
}

async function isUp() {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/api/claude/state`, { signal: AbortSignal.timeout(2000) })
    return reply.ok
  } catch {
    return false
  }
}

async function waitUntilUp(seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await isUp()) return true
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

// Send to Claude: the same change AnnotateSetup.exe makes. CLAUDE_CODE_PLUGIN_DIRS names this
// copy's mod, in place of any other Annotate mod, and a backup of the file is kept.
function setUpSendToClaude() {
  const file = process.env.ANNOTATE_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json')
  const mod = path.join(home, 'claude-mod')
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  const isAnnotateMod = dir => path.basename(dir).toLowerCase() === 'claude-mod' && fs.existsSync(path.join(dir, '..', 'server.py'))
  let settings = {}
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    try {
      settings = text.trim() ? JSON.parse(text) : {}
    } catch {
      return say(`  Skipped: ${file} isn't plain JSON, so it was left alone.`)
    }
    fs.copyFileSync(file, `${file}.annotate-backup`)
  }
  settings.env = settings.env || {}
  const dirs = (settings.env.CLAUDE_CODE_PLUGIN_DIRS || '').split(';').filter(Boolean)
  const kept = dirs.filter(dir => !isAnnotateMod(dir) && !same(dir, mod))
  settings.env.CLAUDE_CODE_PLUGIN_DIRS = [...kept, mod].join(';')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  say(`  Added ${mod} to CLAUDE_CODE_PLUGIN_DIRS in ${file}. New Claude chats pick it up.`)
}

function startInBackground() {
  fs.mkdirSync(path.join(home, 'data'), { recursive: true })
  const log = fs.openSync(path.join(home, 'data', 'server.log'), 'a')
  const [command, commandArgs] = windows ? ['cmd', ['/c', path.join(home, 'start.cmd')]] : ['sh', [path.join(home, 'start.sh')]]
  spawn(command, commandArgs, { cwd: home, detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref()
}

function openPage(page) {
  if (windows) spawn('cmd', ['/c', 'start', '""', page], { detached: true, windowsHide: true, stdio: 'ignore' }).unref()
  else spawn(mac ? 'open' : 'xdg-open', [page], { detached: true, stdio: 'ignore' }).unref()
}

async function main() {
  say(`Annotate: installing to ${home}\n`)

  const python = findPython()
  if (!python) {
    fail(
      'Annotate needs Python 3.10 or newer, and none was found.\n' +
        (windows
          ? '  Install it from https://www.python.org/downloads/ or run: winget install Python.Python.3.13\n' +
            '  Or skip Python entirely with AnnotateSetup.exe from the Releases page.'
          : mac
            ? '  Install it with: brew install python'
            : '  Install it with your package manager, for example: sudo apt install python3 python3-venv') +
        '\nThen run this command again.',
    )
  }
  const browser = findBrowser()
  if (browser) say(`Website capture will use ${browser}.`)
  else say('No Edge or Chrome found. PDFs work, but website capture and the live browser need one of them.')

  if (fs.existsSync(path.join(home, 'runtime')) && fs.existsSync(path.join(home, 'install.json'))) {
    fail(`${home} is an AnnotateSetup.exe install. Run AnnotateSetup.exe to update it, or pass --dir for another folder.`)
  }

  say('Copying files...')
  fs.mkdirSync(home, { recursive: true })
  for (const entry of fs.readdirSync(source)) {
    if (SKIP.has(entry)) continue
    fs.cpSync(path.join(source, entry), path.join(home, entry), { recursive: true, force: true })
  }

  if (!fs.existsSync(venvPython)) {
    say('Making a Python environment...')
    const made = run(python[0], [...python.slice(1), '-m', 'venv', path.join(home, '.venv')], { stdio: 'inherit' })
    if (made.status !== 0) fail(mac || windows ? 'Python could not make a virtual environment.' : 'Python could not make a virtual environment. Install python3-venv, then run this again.')
  }
  say('Installing PyMuPDF, Pillow and Playwright...')
  const pip = run(venvPython, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '-r', path.join(home, 'requirements.txt')], { stdio: 'inherit' })
  if (pip.status !== 0) fail('pip could not install the packages. The messages above say why.')

  const running = await isUp()
  const service = flag('--no-service') ? false : flag('--service') || (await ask('\nKeep Annotate running in the background, starting at login?', true))
  if (service) {
    const script = path.join(home, windows ? 'install-service.ps1' : 'install-service.sh')
    const done = windows
      ? run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'inherit' })
      : run('sh', [script], { stdio: 'inherit' })
    if (done.status !== 0) say('The service could not be set up. The messages above say why. Starting it for now instead.')
    if (done.status !== 0 && !running) startInBackground()
  } else if (!running) {
    startInBackground()
  }

  const send = flag('--send-to-claude') || (windows && (await ask('\nSet up Send to Claude? It adds Annotate to ~/.claude/settings.json.', false)))
  if (send) setUpSendToClaude()
  else if (!windows) say('\nSend to Claude needs Windows for now, so it was skipped.')

  if (running) say(`\nAnnotate was already running at ${url}. Restart it to use this copy.`)
  else if (!(await waitUntilUp(60))) fail(`Annotate didn't start. Its log is ${path.join(home, 'data', 'server.log')}.`)

  const extension = path.join(home, 'extension')
  say(`\nAnnotate is running at ${url}`)
  say('\nTo add the Chrome extension, which marks up pages in your own browser:')
  say('  1. Open chrome://extensions, or edge://extensions in Edge, and turn on Developer mode.')
  say('  2. Choose Load unpacked.')
  say(`  3. Pick ${extension}`)
  if (!flag('--no-open')) openPage(url)
}

main().catch(error => fail(error.stack || String(error)))
