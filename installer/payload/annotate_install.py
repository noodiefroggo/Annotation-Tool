"""The steps AnnotateSetup.exe and the uninstaller share. Windows only.

The install is one folder per Windows account, %LOCALAPPDATA%\\Annotate by default:

    runtime\\        Python with PyMuPDF, Pillow and Playwright, replaced on every update
    server.py ...   the tool, replaced on every update
    data\\           the library, kept across updates and, unless asked, by the uninstaller
    install.json    what this install set up, so the uninstaller can undo exactly that

Testing on a computer that already runs Annotate: set ANNOTATE_INSTANCE (for example Test) to
give the task, shortcut and uninstall entry their own names, ANNOTATE_INSTALL_DIR for the
folder, ANNOTATE_PORT for the port, and ANNOTATE_CLAUDE_SETTINGS for a stand-in settings.json.
"""
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.request
import winreg
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_PORT = 3190
NO_WINDOW = subprocess.CREATE_NO_WINDOW
UNINSTALL_ROOT = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"
PROGRAMS = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
BROWSERS = (
    ("Google Chrome", "chrome", r"Google\Chrome\Application\chrome.exe"),
    ("Microsoft Edge", "msedge", r"Microsoft\Edge\Application\msedge.exe"),
)


@dataclass
class Config:
    home: str
    port: int = DEFAULT_PORT
    task: str = "Annotate Server"
    name: str = "Annotate"
    key: str = "Annotate"
    version: str = ""
    login_task: bool = True
    claude_settings: str = ""
    claude_mod: str = ""
    claude_replaced: list = field(default_factory=list)

    @classmethod
    def from_env(cls):
        instance = os.environ.get("ANNOTATE_INSTANCE", "").strip()
        home = os.environ.get("ANNOTATE_INSTALL_DIR") or str(Path(os.environ["LOCALAPPDATA"]) / "Annotate")
        return cls(
            home=str(Path(home).resolve()),
            port=int(os.environ.get("ANNOTATE_PORT", DEFAULT_PORT)),
            task=f"Annotate Server ({instance})" if instance else "Annotate Server",
            name=f"Annotate ({instance})" if instance else "Annotate",
            key=f"Annotate-{instance}" if instance else "Annotate",
        )

    @classmethod
    def load(cls, home):
        return cls(**json.loads((Path(home) / "install.json").read_text(encoding="utf-8")))

    def save(self):
        (Path(self.home) / "install.json").write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    @property
    def runtime(self):
        return Path(self.home) / "runtime"

    @property
    def pythonw(self):
        return self.runtime / "pythonw.exe"

    @property
    def url(self):
        return f"http://localhost:{self.port}"

    @property
    def shortcut(self):
        return PROGRAMS / f"{self.name}.lnk"


def log(config, line):
    data = Path(config.home) / "data"
    data.mkdir(parents=True, exist_ok=True)
    with (data / "install.log").open("a", encoding="utf-8") as out:
        out.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")


def find_browsers():
    """Chrome and Edge where Playwright looks for them, in that order."""
    bases = [os.environ.get(name, "") for name in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)")]
    found = []
    for label, channel, relative in BROWSERS:
        for base in filter(None, bases):
            path = Path(base) / relative
            if path.exists():
                found.append((label, channel, path))
                break
    return found


def powershell(command, check=True):
    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
        capture_output=True, text=True, creationflags=NO_WINDOW)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def quote(text):
    """A PowerShell single-quoted string."""
    return "'" + str(text).replace("'", "''") + "'"


# The scheduled task -----------------------------------------------------------------------

def task_folder(name):
    """The folder an existing task starts in, or None when there is no such task."""
    out = powershell(
        f"$t = Get-ScheduledTask -TaskName {quote(name)} -ErrorAction SilentlyContinue; "
        "if ($t) { 'found:' + $t.Actions[0].WorkingDirectory }", check=False)
    return out[len("found:"):] if out.startswith("found:") else None


def register_task(config):
    """The same task install-service.ps1 makes, run by this install's own Python."""
    powershell(
        "$ErrorActionPreference = 'Stop'; "
        f"$name = {quote(config.task)}; "
        "$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name; "
        "if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { "
        "Stop-ScheduledTask -TaskName $name; Unregister-ScheduledTask -TaskName $name -Confirm:$false }; "
        f"$action = New-ScheduledTaskAction -Execute {quote(config.pythonw)} "
        f"-Argument {quote(chr(34) + str(Path(config.home) / 'annotate.pyw') + chr(34))} "
        f"-WorkingDirectory {quote(config.home)}; "
        "$atLogin = New-ScheduledTaskTrigger -AtLogOn -User $account; "
        "$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5); "
        "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries "
        "-StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero); "
        "$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited; "
        "Register-ScheduledTask -TaskName $name -Action $action -Trigger @($atLogin, $watchdog) "
        "-Settings $settings -Principal $principal | Out-Null; "
        "Start-ScheduledTask -TaskName $name")


def remove_task(config):
    """Removes the task, but only when it starts this install."""
    folder = task_folder(config.task)
    if folder is None or not same_path(folder, config.home):
        return False
    powershell(
        f"Stop-ScheduledTask -TaskName {quote(config.task)}; "
        f"Unregister-ScheduledTask -TaskName {quote(config.task)} -Confirm:$false")
    return True


# Processes and the server ------------------------------------------------------------------

def stop_processes(config, keep=None):
    """Stops everything running from this install's Python: the supervisor, the server and
    Playwright's driver. Nothing outside the install folder is touched."""
    prefix = str(config.runtime) + "\\"
    powershell(
        f"Get-Process | Where-Object {{ $_.Path -and $_.Id -ne {keep or 0} -and "
        f"$_.Path.StartsWith({quote(prefix)}, 'OrdinalIgnoreCase') }} | Stop-Process -Force",
        check=False)


def start_detached(config):
    """Starts the supervisor without the task, for installs that skip the login task."""
    subprocess.Popen(
        [str(config.pythonw), str(Path(config.home) / "annotate.pyw")], cwd=config.home,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)


def port_in_use(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def server_is_up(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/claude/state", timeout=2) as reply:
            return reply.status == 200
    except OSError:
        return False


def wait_for_server(port, seconds=60):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if server_is_up(port):
            return True
        time.sleep(0.5)
    return False


# Send to Claude ----------------------------------------------------------------------------

def claude_settings_path():
    return Path(os.environ.get("ANNOTATE_CLAUDE_SETTINGS") or Path.home() / ".claude" / "settings.json")


def same_path(a, b):
    return os.path.normcase(os.path.normpath(str(a))) == os.path.normcase(os.path.normpath(str(b)))


def is_annotate_mod(folder):
    """A claude-mod folder that belongs to some copy of Annotate, wherever it is."""
    path = Path(folder)
    return path.name.lower() == "claude-mod" and (path.parent / "server.py").exists()


def read_settings(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8-sig") or "{}")


def plugin_dirs(settings):
    return [d for d in settings.get("env", {}).get("CLAUDE_CODE_PLUGIN_DIRS", "").split(";") if d]


def other_annotate_mods(path, mod):
    """Other copies of the Annotate mod the settings load, which adding this one replaces."""
    try:
        settings = read_settings(path)
    except (OSError, ValueError):
        return []
    return [d for d in plugin_dirs(settings) if is_annotate_mod(d) and not same_path(d, mod)]


def write_settings(path, settings):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copy2(path, path.with_name(path.name + ".annotate-backup"))
    path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


def add_claude_mod(path, mod):
    """Names this install's mod in CLAUDE_CODE_PLUGIN_DIRS, in place of any other Annotate mod,
    so new chats get one inbox. Other entries and settings stay as they are. Returns the
    entries it replaced, which removing the mod puts back."""
    settings = read_settings(path)
    dirs = plugin_dirs(settings)
    replaced = [d for d in dirs if is_annotate_mod(d) and not same_path(d, mod)]
    kept = [d for d in dirs if d not in replaced and not same_path(d, mod)]
    settings.setdefault("env", {})["CLAUDE_CODE_PLUGIN_DIRS"] = ";".join(kept + [str(mod)])
    write_settings(path, settings)
    return replaced


def remove_claude_mod(path, mod, restore=()):
    """Takes this install's mod out again, and puts back the mods it replaced that still exist."""
    settings = read_settings(path)
    dirs = plugin_dirs(settings)
    kept = [d for d in dirs if not same_path(d, mod)]
    if kept == dirs:
        return False
    kept += [d for d in restore if is_annotate_mod(d) and not any(same_path(d, k) for k in kept)]
    if kept:
        settings["env"]["CLAUDE_CODE_PLUGIN_DIRS"] = ";".join(kept)
    else:
        del settings["env"]["CLAUDE_CODE_PLUGIN_DIRS"]
        if not settings["env"]:
            del settings["env"]
    write_settings(path, settings)
    return True


# Shortcut and the Apps list ----------------------------------------------------------------

def make_shortcut(config):
    config.shortcut.parent.mkdir(parents=True, exist_ok=True)
    powershell(
        f"$s = (New-Object -ComObject WScript.Shell).CreateShortcut({quote(config.shortcut)}); "
        f"$s.TargetPath = {quote(config.pythonw)}; "
        f"$s.Arguments = {quote(chr(34) + str(Path(config.home) / 'open.pyw') + chr(34))}; "
        f"$s.WorkingDirectory = {quote(config.home)}; "
        f"$s.IconLocation = {quote(Path(config.home) / 'annotate.ico')}; "
        "$s.Description = 'Open Annotate'; $s.Save()")


def folder_size_kb(folder):
    return sum(f.stat().st_size for f in Path(folder).rglob("*") if f.is_file()) // 1024


def register_uninstall(config):
    home = Path(config.home)
    command = f'"{config.pythonw}" "{home / "uninstall.pyw"}"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, f"{UNINSTALL_ROOT}\\{config.key}") as key:
        for name, value in (
            ("DisplayName", config.name),
            ("DisplayVersion", config.version),
            ("Publisher", "Annotate"),
            ("InstallLocation", str(home)),
            ("DisplayIcon", str(home / "annotate.ico")),
            ("UninstallString", command),
            ("QuietUninstallString", command + " --quiet"),
            ("URLInfoAbout", "https://github.com/noodiefroggo/Annotation-Tool"),
        ):
            winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
        for name, value in (("NoModify", 1), ("NoRepair", 1), ("EstimatedSize", folder_size_kb(home))):
            winreg.SetValueEx(key, name, 0, winreg.REG_DWORD, value)


def unregister_uninstall(config):
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, f"{UNINSTALL_ROOT}\\{config.key}")
    except FileNotFoundError:
        pass


# Files -------------------------------------------------------------------------------------

def clear_install(home):
    """Empties the install folder for an update, keeping data. Refuses a folder that holds
    anything but an Annotate install, so a wrong ANNOTATE_INSTALL_DIR can't wipe it."""
    home = Path(home)
    if not home.exists():
        return
    entries = [e for e in home.iterdir() if e.name != "data"]
    if entries and not (home / "install.json").exists():
        raise RuntimeError(f"{home} already has files that aren't an Annotate install. Pick an empty folder.")
    for entry in entries:
        for attempt in range(10):
            try:
                shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
                break
            except OSError:
                if attempt == 9:
                    raise
                time.sleep(0.5)
