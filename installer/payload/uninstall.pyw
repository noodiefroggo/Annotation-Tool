"""Removes Annotate: the login task, the Send to Claude entry it added, the shortcut, the Apps
entry and the program files. The library in data stays unless the person chooses otherwise.

    uninstall.pyw                  asks first
    uninstall.pyw --quiet          no questions, keeps data
    uninstall.pyw --quiet --delete-data
"""
import ctypes
import shutil
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOME = Path(__file__).resolve().parent
sys.path.insert(0, str(HOME))
import annotate_install as setup  # noqa: E402

YES, CANCEL = 6, 2
OK_CANCEL, YES_NO, WARNING, QUESTION, INFO, SECOND = 0x1, 0x4, 0x30, 0x20, 0x40, 0x100


def ask(text, flags):
    return ctypes.windll.user32.MessageBoxW(None, text, "Uninstall Annotate", flags)


def main():
    quiet = "--quiet" in sys.argv
    delete_data = "--delete-data" in sys.argv
    config = setup.Config.load(HOME)
    data = HOME / "data"
    if not quiet:
        if ask(f"Remove {config.name} from this computer?", OK_CANCEL | QUESTION) == CANCEL:
            return
        delete_data = ask(
            f"Also delete everything you've marked up?\n\n{data}\n\nChoose No to keep it. Installing "
            "Annotate again picks it up where you left off.", YES_NO | WARNING | SECOND) == YES

    setup.remove_task(config)
    setup.stop_processes(config, keep=os.getpid())
    if config.claude_settings:
        try:
            setup.remove_claude_mod(Path(config.claude_settings), config.claude_mod, config.claude_replaced)
        except (OSError, ValueError):
            pass
    config.shortcut.unlink(missing_ok=True)
    setup.unregister_uninstall(config)

    # This script runs on the install's own Python, so runtime goes once this process ends.
    # install.json goes last, so the folder still reads as an install until runtime is gone.
    later = {"runtime", "install.json"} | (set() if delete_data else {"data"})
    for entry in HOME.iterdir():
        if entry.name in later:
            continue
        try:
            shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
        except OSError:
            pass
    # Python's files stay locked until this process exits, so a separate PowerShell waits for
    # that, then removes them, and retries while Windows lets go of the folder. It can't be
    # started with DETACHED_PROCESS: PowerShell exits at once without a console.
    targets = [HOME] if delete_data else [HOME / "runtime", HOME / "install.json"]
    removals = "; ".join(
        f"foreach ($try in 1..30) {{ Remove-Item -LiteralPath {setup.quote(t)} -Recurse -Force "
        f"-ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath {setup.quote(t)})) {{ break }}; Start-Sleep 1 }}"
        for t in targets)
    subprocess.Popen(
        ["powershell", "-NoProfile", "-Command",
         f"Wait-Process -Id {os.getpid()} -ErrorAction SilentlyContinue; {removals}"],
        cwd=tempfile.gettempdir(), creationflags=setup.NO_WINDOW)

    if not quiet:
        kept = "" if delete_data else f"\n\nYour library is still in {data}."
        ask(f"{config.name} is removed.{kept}", INFO)


if __name__ == "__main__":
    main()
