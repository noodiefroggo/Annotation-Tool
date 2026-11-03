# Installing Annotate

There are two ways in. Most people want the first.

| | `AnnotateSetup.exe` | `npx github:noodiefroggo/Annotation-Tool` |
|---|---|---|
| For | Anyone on Windows | Developers, on any system |
| Needs | Chrome or Edge | Node 18, Python 3.10 or newer, Chrome or Edge |
| Installs to | `%LOCALAPPDATA%\Annotate` | `~/.annotate` |
| Python | Its own copy, inside the install | A `.venv` made from your Python |

Both run the same tool at `http://localhost:3190`.

## AnnotateSetup.exe

Download it from the [latest release](https://github.com/noodiefroggo/Annotation-Tool/releases/latest) and double-click it. A link that always gets the newest one, for a website's install button:

```
https://github.com/noodiefroggo/Annotation-Tool/releases/latest/download/AnnotateSetup.exe
```

The setup window installs for your Windows account only, with no admin rights, then:

1. Checks for Chrome or Edge, and stops with a message if neither is there, because website capture and the live browser drive one of them.
2. Copies the tool and its own Python, with PyMuPDF, Pillow and Playwright, to `%LOCALAPPDATA%\Annotate`.
3. Registers the `Annotate Server` task, which starts the tool at sign-in with no window, and starts it now. Untick **Start Annotate when I sign in** to skip the task.
4. Adds an **Annotate** shortcut to the Start menu, and an entry in **Settings > Apps** to uninstall it.
5. Opens `http://localhost:3190`.

### Send to Claude is opt-in

**Set up Send to Claude** is off unless you tick it, because it changes `~/.claude/settings.json`. It adds the install's `claude-mod` folder to `CLAUDE_CODE_PLUGIN_DIRS`, keeps the other entries, and saves the old file as `settings.json.annotate-backup` first. If another copy of the Annotate mod is listed, this one takes its place, so chats get one inbox, and uninstalling puts the old one back. Claude chats started after that can take your notes.

### The extension is the one step left to you

Chrome doesn't let an installer add an unpacked extension. So at the end, setup copies the extension's folder to the clipboard, opens `chrome://extensions` (or `edge://extensions`), and shows these steps:

1. Turn on **Developer mode**, top right.
2. Choose **Load unpacked**.
3. Paste the folder into the window that opens, then choose **Select Folder**.

### Updating and uninstalling

Run a newer `AnnotateSetup.exe` to update. It stops the running copy, replaces the program files and keeps `data`, which holds your library.

To uninstall, use **Settings > Apps > Annotate**. It removes the task, the shortcut, the Send to Claude entry and the program files. It asks before deleting `data`, and keeps it unless you say otherwise. Without asking:

```
"%LOCALAPPDATA%\Annotate\runtime\pythonw.exe" "%LOCALAPPDATA%\Annotate\uninstall.pyw" --quiet
```

Add `--delete-data` to remove the library too.

### Without the window

```
AnnotateSetup.exe --quiet [--send-to-claude] [--no-login-task] [--open]
```

It writes what it did to `%LOCALAPPDATA%\Annotate\data\install.log`.

### Limits

- **SmartScreen warns about it.** The exe isn't code-signed, so Windows says "Windows protected your PC" until a code-signing certificate is bought. Choose **More info**, then **Run anyway**. Some antivirus tools also flag unsigned PyInstaller programs.
- **Windows only.** It needs 64-bit Windows 10 or 11. Mac and Linux need a separate build that doesn't exist yet, so use the `npx` route there.
- **It's about 105 MB**, and about 250 MB installed. Most of that is PyMuPDF and the Node runtime Playwright ships with.
- **One port.** The extension and the Claude mod expect port 3190. `ANNOTATE_PORT` exists for testing, not everyday use.
- If something else already holds port 3190, such as a copy of Annotate from a git checkout, setup still installs and says so. The new copy starts once that one stops.

## npx, for developers

```bash
npx github:noodiefroggo/Annotation-Tool
```

It copies the tool to `~/.annotate`, makes a `.venv` there with your Python and installs the packages. Then it asks whether to keep the tool running at login, using `install-service.ps1` or `install-service.sh`, and, on Windows, whether to set up Send to Claude, which is off by default. Last, it starts the tool, opens it and prints the extension steps. If Python is missing it prints how to get it.

Options: `--dir <folder>`, `--yes` for no questions (service on, Send off), `--service`, `--no-service`, `--send-to-claude`, `--no-open`. Run it again to update. `data` and `.venv` are kept.

Mac and Linux haven't been tested yet, and the Claude mod is still Windows only.

## Building the exe

On Windows, with Python 3.14 (through the `py` launcher) and git:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

That writes `installer\dist\AnnotateSetup.exe`. It downloads the embeddable Python from python.org and checks it against a pinned hash, installs the exact packages in `requirements-lock.txt` without their optional extras, and freezes `setup.py` around the result with PyInstaller. `-BuildDir` and `-DistDir` move the working files, and the version comes from `package.json`.

### Releasing

The `Installer` workflow builds the exe on every pull request that touches the installer, so it can be downloaded from the run and tried. Pushing a tag makes a **draft** release with the exe attached:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Nothing is public until the draft is published by hand on GitHub. Bump `version` in `package.json` first.

### Testing beside a real install

These keep a test install apart from one that's already running:

| Variable | Does |
|---|---|
| `ANNOTATE_INSTANCE=Test` | Names the task, shortcut and Apps entry `Annotate (Test)` |
| `ANNOTATE_INSTALL_DIR` | Installs somewhere other than `%LOCALAPPDATA%\Annotate` |
| `ANNOTATE_PORT` | Runs on another port |
| `ANNOTATE_CLAUDE_SETTINGS` | Points Send to Claude at a stand-in `settings.json` |

Uninstall the test copy afterwards with its own `uninstall.pyw`.
