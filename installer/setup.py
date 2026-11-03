"""AnnotateSetup.exe: installs Annotate for this Windows account, with no admin rights and no
Python needed. build.ps1 freezes this file with PyInstaller around payload.zip, which holds the
tool and its own Python.

    AnnotateSetup.exe                         the setup window
    AnnotateSetup.exe --quiet                 installs with the defaults and no window
        --send-to-claude                      also sets up Send to Claude
        --no-login-task                       starts the tool now, but not at every sign-in
        --open                                opens the tool and the extensions page at the end

Run it again to update. The library in data is kept.
"""
import argparse
import ctypes
import queue
import subprocess
import sys
import threading
import webbrowser
import zipfile
from pathlib import Path

import annotate_install as setup

BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent / "build"))
PAYLOAD = BUNDLE / "payload.zip"


def payload_version():
    with zipfile.ZipFile(PAYLOAD) as payload:
        return payload.read("VERSION").decode().strip()


def install(config, send_to_claude, login_task, step=lambda text: None):
    """Installs or updates. Returns a note for the finish screen, empty when all went well."""
    home = Path(config.home)
    previous = setup.Config.load(home) if (home / "install.json").exists() else None

    step("Stopping the running copy")
    if previous:
        setup.remove_task(previous)
        setup.stop_processes(previous)
    setup.clear_install(home)

    step("Copying files")
    home.mkdir(parents=True, exist_ok=True)
    config.save()  # marks the folder as an install first, so a failed run can be retried
    with zipfile.ZipFile(PAYLOAD) as payload:
        payload.extractall(home)
    template = (home / "start.cmd").read_text(encoding="utf-8")
    (home / "start.cmd").write_bytes(template.replace("{port}", str(config.port)).replace("\n", "\r\n").encode())
    config.version = payload_version()
    config.login_task = login_task
    setup.log(config, f"Installing {config.version} to {home} on port {config.port}")

    settings = setup.claude_settings_path()
    mod = home / "claude-mod"
    if previous and previous.claude_settings and not send_to_claude:
        step("Removing Send to Claude")
        setup.remove_claude_mod(Path(previous.claude_settings), previous.claude_mod, previous.claude_replaced)
    if send_to_claude:
        step("Setting up Send to Claude")
        replaced = setup.add_claude_mod(settings, mod)
        config.claude_settings, config.claude_mod = str(settings), str(mod)
        config.claude_replaced = (previous.claude_replaced if previous else []) + replaced
        setup.log(config, f"Added {mod} to CLAUDE_CODE_PLUGIN_DIRS in {settings}")
    config.save()

    step("Adding the shortcut")
    setup.make_shortcut(config)
    setup.register_uninstall(config)

    step("Starting Annotate")
    busy = setup.port_in_use(config.port)
    if login_task:
        setup.register_task(config)
        setup.log(config, f"Registered the task {config.task}")
    else:
        setup.remove_task(config)
        if not busy:
            setup.start_detached(config)
    if busy:
        setup.log(config, f"Port {config.port} was already in use")
        return (f"Another program, probably another copy of Annotate, is using port {config.port}. "
                "This copy starts once that one stops.")
    if not setup.wait_for_server(config.port):
        setup.log(config, "The server did not answer within a minute")
        return f"Annotate didn't answer yet. Its log is in {home / 'data' / 'server.log'}."
    setup.log(config, "The server is up")
    return ""


def open_extensions_page(browsers):
    """Chrome first, since the steps are written for it. Edge loads the same extension."""
    label, channel, path = browsers[0]
    page = "edge://extensions/" if channel == "msedge" else "chrome://extensions/"
    subprocess.Popen([str(path), page], creationflags=setup.NO_WINDOW)


def error_box(text):
    ctypes.windll.user32.MessageBoxW(None, text, "Annotate Setup", 0x10)


def quiet(args, config, browsers):
    try:
        note = install(config, args.send_to_claude, not args.no_login_task)
    except Exception as error:
        setup.log(config, f"Setup failed: {error!r}")
        return 1
    if args.open:
        webbrowser.open(config.url)
        open_extensions_page(browsers)
    if note:
        setup.log(config, note)
    return 0


# The window --------------------------------------------------------------------------------

def window(config, browsers):
    import tkinter as tk
    from tkinter import ttk

    ctypes.windll.shcore.SetProcessDpiAwareness(1)
    root = tk.Tk()
    root.title("Annotate Setup")
    root.resizable(False, False)
    icon = BUNDLE / "annotate.ico"
    if icon.exists():
        root.iconbitmap(str(icon))
    style = ttk.Style()
    style.configure("Title.TLabel", font=("Segoe UI Semibold", 15))
    style.configure("Head.TLabel", font=("Segoe UI Semibold", 11))
    style.configure("Note.TLabel", foreground="#555")
    frame = ttk.Frame(root, padding=24)
    frame.grid(sticky="nsew")
    wrap = 470

    def clear():
        for child in frame.winfo_children():
            child.destroy()

    def text(value, kind="TLabel", gap=(0, 8), indent=0):
        label = ttk.Label(frame, text=value, style=kind, wraplength=wrap - indent, justify="left")
        label.pack(anchor="w", pady=gap, padx=(indent, 0))
        return label

    def buttons(*items):
        row = ttk.Frame(frame)
        row.pack(fill="x", pady=(16, 0))
        for index, (label, command) in enumerate(items):
            button = ttk.Button(row, text=label, command=command)
            button.pack(side="right", padx=(8, 0))
            if index == 0:
                button.focus_set()
        return row

    home = Path(config.home)
    updating = (home / "install.json").exists()
    previous = setup.Config.load(home) if updating else None
    settings = setup.claude_settings_path()
    mod = home / "claude-mod"
    has_claude = settings.parent.exists()
    login = tk.BooleanVar(value=previous.login_task if previous else True)
    send = tk.BooleanVar(value=bool(previous and previous.claude_settings))

    def welcome():
        clear()
        text("Update Annotate" if updating else "Install Annotate", "Title.TLabel")
        text("Mark up PDFs and websites, then send the notes to Claude.")
        text(f"It installs for you only, in {home}, and needs no admin rights."
             + (" Your library is kept." if updating else ""), "Note.TLabel", (0, 14))

        ttk.Checkbutton(frame, text="Start Annotate when I sign in (recommended)", variable=login).pack(anchor="w")
        text("Keeps it running in the background at " + config.url + ", with no window.", "Note.TLabel",
             (0, 10), 24)

        check = ttk.Checkbutton(frame, text="Set up Send to Claude", variable=send)
        check.pack(anchor="w")
        if has_claude:
            note = (f"Adds Annotate's Claude Code mod to {settings}, so new Claude chats can take your "
                    "notes as a message. A backup is saved first.")
            others = setup.other_annotate_mods(settings, mod)
            if others:
                note += f" It replaces the Annotate mod from {others[0]}."
        else:
            check.state(["disabled"])
            send.set(False)
            note = "Claude Code isn't set up on this computer yet. Run Setup again after installing it."
        text(note, "Note.TLabel", (0, 10), 24)

        folder = setup.task_folder(config.task)
        if folder and not setup.same_path(folder, home):
            text(f"This replaces the startup task for the copy of Annotate in {folder}. That folder "
                 "and its library stay where they are.", "Note.TLabel", (0, 6))
        # The server tries Edge first, then Chrome.
        text(f"Website capture uses {browsers[-1][0]}.", "Note.TLabel")
        buttons(("Update" if updating else "Install", working), ("Cancel", root.destroy))

    def working():
        clear()
        text("Installing Annotate", "Title.TLabel")
        status = text("Starting")
        bar = ttk.Progressbar(frame, mode="indeterminate", length=wrap)
        bar.pack(pady=(4, 0))
        bar.start(12)
        updates = queue.Queue()

        def run():
            try:
                updates.put(("done", install(config, send.get(), login.get(), lambda s: updates.put(("step", s)))))
            except Exception as error:  # shown to the person, and kept in the log
                setup.log(config, f"Setup failed: {error!r}")
                updates.put(("failed", str(error)))

        def poll():
            try:
                while True:
                    kind, value = updates.get_nowait()
                    if kind == "step":
                        status.config(text=value + "...")
                    elif kind == "done":
                        return finished(value)
                    else:
                        return failed(value)
            except queue.Empty:
                root.after(100, poll)

        threading.Thread(target=run, daemon=True).start()
        poll()

    def failed(message):
        clear()
        text("Annotate couldn't be installed", "Title.TLabel")
        text(message)
        text(f"Details are in {home / 'data' / 'install.log'}.", "Note.TLabel")
        buttons(("Close", root.destroy))

    def copy_path():
        root.clipboard_clear()
        root.clipboard_append(str(home / "extension"))
        root.update()

    def finished(note):
        clear()
        text("Annotate is installed", "Title.TLabel")
        text(note or f"It's running at {config.url}, and the Start menu has an Annotate shortcut.")
        if send.get():
            text("Send to Claude works in Claude chats you start from now on.", "Note.TLabel")

        text("One more step: the Chrome extension", "Head.TLabel", (14, 4))
        text("It marks up pages in your own browser, with your sign-ins. Chrome doesn't let installers "
             "add extensions, so do this once. The folder is already copied.", "Note.TLabel")
        for number, step in enumerate((
            "On the extensions page, turn on Developer mode, top right.",
            "Choose Load unpacked.",
            "Paste the folder into the address bar of the window that opens (Ctrl+V), then choose Select Folder.",
        ), 1):
            text(f"{number}.  {step}", gap=(0, 4))
        path = ttk.Entry(frame, width=60)
        path.insert(0, str(home / "extension"))
        path.state(["readonly"])
        path.pack(anchor="w", fill="x", pady=(6, 0))
        text("Then pin Annotate from the puzzle piece in the toolbar.", "Note.TLabel", (6, 0))

        def extensions():
            copy_path()
            open_extensions_page(browsers)

        buttons(("Done", root.destroy), ("Open extensions page", extensions),
                ("Open Annotate", lambda: webbrowser.open(config.url)))
        copy_path()
        if not note:
            webbrowser.open(config.url)
        extensions()

    welcome()
    root.mainloop()
    return 0


def main():
    parser = argparse.ArgumentParser(prog="AnnotateSetup")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--send-to-claude", action="store_true")
    parser.add_argument("--no-login-task", action="store_true")
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()

    config = setup.Config.from_env()
    browsers = setup.find_browsers()
    if not browsers:
        message = ("Annotate needs Google Chrome or Microsoft Edge for website capture and the live "
                   "browser, and neither was found. Install one, then run Setup again.")
        if not args.quiet:
            error_box(message)
        return 1
    if args.quiet:
        return quiet(args, config, browsers)
    return window(config, browsers)


if __name__ == "__main__":
    sys.exit(main())
