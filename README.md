# Annotate

Mark up PDFs, website snapshots and a live browser inside the built-in browser, then send the notes straight to a Claude chat.

## Start

Double-click `Tools\annotate\start.cmd`, or ask Claude to start it, then open `http://localhost:3190`.

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

## Send to Claude

Press **Send to Claude**, choose new marks or all marks, optionally add a message, and send.

1. The tool freezes those notes, with their crops, in `data/<doc>/sends/NNNN/`.
2. It queues a message in `data/outbox.json`.
3. The `annotate-inbox` mod in a connected Claude chat checks every 2 seconds and posts the message as a new turn.

With several chats connected, the panel lets you pick one. With none connected, the batch waits for the next chat that connects, and Copy message gives you the text to paste. Marks already sent dim in the Notes list, and the button counts what is new.

The mod lives in `claude-mod/`. New sessions load it through `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.

## The Annotate button

The mod also adds an **Annotate** button in the band above the chat box. The desktop app's browser pane cannot take a button of its own, so this is the closest place.

Press it to open whatever the browser pane is showing:

- A website opens in the live browser.
- A local PDF opens in the viewer.
- Anything else, or an empty pane, opens the tool's start page.

If the server is down, the button starts it first. That needs `CLAUDE_CODE_PLUGIN_DIRS` to name this folder's `claude-mod`. Sign-ins in the pane do not carry over, so a signed-in page needs signing in again in the live browser.

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