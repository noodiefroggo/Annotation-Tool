# Annotate

Mark up PDFs, website snapshots and a live browser inside the built-in browser, then send the notes straight to a Claude chat.

## Install

On Windows, download `AnnotateSetup.exe` from the [latest release](https://github.com/noodiefroggo/Annotation-Tool/releases/latest) and run it. It needs no Python and no admin rights, only Chrome or Edge. Developers on any system can run `npx github:noodiefroggo/Annotation-Tool` instead, which needs Python 3.10 or newer. [installer/README.md](installer/README.md) has the details and the limits.

## Start

The tool runs all the time at `http://localhost:3190`, so just open that address. The home page is your library of everything you've marked up, and it's where you open a PDF or a website.

Direct links also work:

- `http://localhost:3190/?live=localhost:3100/` opens the live browser
- `http://localhost:3190/?pdf=C:\path\to\file.pdf`
- `http://localhost:3190/?url=localhost:3100/&click=Corporate,Skip,Skip&width=1440` takes a full-page snapshot

## Live browser

A real headless Edge runs on this machine and streams into the tool. Click, scroll, type, open menus and sign in as usual.

1. **Browse** (B) drives the site.
2. Pick any drawing tool or Comment and the current view freezes so you can draw on it, hover states and open menus included.
3. **Browse** goes back to the same page. Every frozen view stays in the document as View 1, View 2 and so on.
4. **Capture full page** freezes the whole page in its current state.

Keys go to the site after you click inside it. Click the toolbar to use shortcuts again. Sign-ins last until the server stops, because no browser profile is stored on disk. The browser closes after 15 idle minutes.

## Keys

| Key | Tool | Key | Action |
| --- | --- | --- | --- |
| B | Browse (live only) | 1 to 7 | Colour |
| V | Select and move | Enter | Add a note to the selected or last mark |
| C | Comment | Delete | Delete the selected mark |
| P | Pen | Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| H | Highlighter | + and -, 0 | Zoom, fit width |
| A | Arrow | Esc | Back to Select |
| O | Circle | Ctrl+wheel | Zoom |
| R | Box | | |
| N | Sticky note | | |
| T | Text | | |

Select a sticky or text note to resize it: the round corner handle scales the note and its text, and the square side handle changes only the width.

Pen strokes made within 1.5 seconds of each other join into one mark, so handwriting stays one note.

## The Chrome extension

The extension marks up the page you're on in your real browser, with your sign-ins.

1. Open `chrome://extensions`, or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and pick `Tools/annotate/extension`.
4. Pin Annotate to the toolbar.

Press the toolbar button or Ctrl+Shift+. to turn it on for a tab, and use the bar at the bottom of the page:

- **Browse** uses the page normally. Esc gets you back to it.
- **Comment** picks the element you click. It saves the selector, the text, the React component and, on a dev server, the source file and line.
- **Pen, Highlight, Arrow, Circle and Box** draw on the page.

Marks are saved to the local server as you go, and each scroll position gets its own screenshot. Open the toolbar popup to send them. Send lives there on purpose, outside the page, so a site cannot send feedback for you.

Source files need a dev server, because production builds carry no source data. The page's text is treated as untrusted data in everything sent to Claude.

## Send to Claude

Press **Send to Claude**, choose new marks or all marks, optionally add a message, and send.

1. The tool freezes those notes, with their crops, in `data/<doc>/sends/NNNN/`.
2. It queues a message in `data/outbox.json`.
3. The `annotate-inbox` mod in a connected Claude chat checks every 2 seconds and posts the message as a new turn.

With several chats connected, the panel lets you pick one. With none connected, the batch waits for the next chat that connects, and Copy message gives you the text to paste. Marks already sent dim in the Notes list, and the button counts what is new.

The mod lives in `claude-mod/`. New sessions load it through `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.

### Cloud chats

Choose **Cloud chat** in Send, paste the chat's link from claude.ai/code, and give the project's folder. Run `claude auth login` once first, because the command-line tool signs in separately from the desktop app.

A cloud chat cannot reach this computer and takes text only, so:

1. The batch goes to a branch named `annotations/<date>-<document>-<batch>` on the project's GitHub repo. It is built with Git plumbing, so your checkout and uncommitted work stay untouched.
2. `claude -p ... --cloud <session>` queues a short message telling the chat how to fetch it.
3. Branches older than 14 days are removed the next time you send.

Screenshots only go to private repos. A public repo or a folder with no GitHub remote gets the text only, and Send tells you so. Your computer only has to be on when you press Send. Starting a new cloud chat from here is not supported, because that command needs an interactive terminal.

## The Annotate button

The mod also adds an **Annotate** button in the band above the chat box. The desktop app's browser pane cannot take a button of its own, so this is the closest place.

Press it to open whatever the browser pane is showing:

- A website opens in the live browser.
- A local PDF opens in the viewer.
- Anything else, or an empty pane, opens the tool's start page.

If the server is down, the button starts it first. That needs `CLAUDE_CODE_PLUGIN_DIRS` to name this folder's `claude-mod`. Sign-ins in the pane do not carry over, so a signed-in page needs signing in again in the live browser.

## The always-on server

One server runs for your Windows account, with no window, and only this computer can reach it.

- **Login:** a scheduled task named `Annotate Server` starts it when you log in. It needs no admin rights.
- **Crashes:** `service.pyw` restarts the server within about 10 seconds, and the task brings `service.pyw` back within 5 minutes if that stops.
- **One copy only:** the server owns port 3190 outright, so a second copy exits with "Port 3190 is busy".
- **Logs:** `data/server.log`.

On a new computer, run `start.cmd` once to set up Python, stop it, then install the service:

```bash
powershell -ExecutionPolicy Bypass -File install-service.ps1
```

To remove the task, add `-Remove` to that command. After changing `server.py` or `live.py`, stop the running `python.exe` and the service starts the new code. `start.cmd`, the Annotate button and the pane entry still work without the service.

## Mac and Linux

The server, `start.sh` and `install-service.sh` are written for Mac and Linux, but they have not been run on either yet. Only Windows has been tested.

```bash
sh start.sh
```

That sets up Python and starts the tool. It needs Python 3, and Edge or Chrome for website capture and the live browser. To keep it running, stop it and install the service, which uses launchd on Mac and a systemd user service on Linux:

```bash
sh install-service.sh
```

To remove it, run `sh install-service.sh --remove`.

The Claude mod is still Windows only: its Annotate button can't start the server on Mac or Linux, and it can't pass a PDF from the browser pane.

## The entry in the browser pane

The pane's new tab lists the servers from a project's `.claude/launch.json`, and that list shows before a chat has started. Add this entry to put Annotate there, using the path from that project's folder:

```json
{
  "name": "annotate",
  "runtimeExecutable": "cmd",
  "runtimeArgs": ["/c", "Tools\\annotate\\preview.cmd"],
  "port": 3192
}
```

The entry runs `preview.py`, a small redirect page that starts the tool if it is down and then sends the pane to it. It has its own port because the pane moves an entry to another port when its own is taken, and the tool has to stay on 3190. The list belongs to each project, so a new project needs the entry added.

## Opening in every new chat

Every new chat in any project starts the server if it is down and opens the tool's start page in the browser pane. It retries quietly for about 20 seconds while the pane comes up. The app starts a session on the first message, so nothing happens on the empty new chat screen until then.

A chat counts as new for its first minute. Resumed chats and mod reloads leave the pane alone, so restarting the app does not reopen the tool everywhere. Chats started by another session count as new too.

Sessions without a browser pane, such as a terminal, get no error. They do still start the server. To stop this behaviour, remove the `openOnNewChat` call in `claude-mod/hooks/register.tsx`.

## How Claude reads notes without Send

Everything saves on its own.

- `data/LATEST.md`: the most recently edited document, as a readable list.
- `data/<doc>/export/notes.json`: the same notes as data.
- `data/<doc>/export/crops/a007.jpg`: a crop around mark 7, with all marks drawn on it.
- `data/<doc>/export/pages/p003.jpg`: the whole page with its marks.

Each note has its page, position (units and percent), kind, colour and text. It also has the text under the mark. On websites it adds the URL and page element, and arrows report both ends.

## Limits

- Marks stay on the frozen view they were drawn on. They do not float over the live page as you scroll.
- Video and sound are not streamed. Browser pop-up dialogs close on their own, and links that open a new tab open in place.
- Full-page captures stop at 16,000 px tall.
- Paste works. Copying text out of the live browser does not.

## Licence

MIT. See `LICENSE`.