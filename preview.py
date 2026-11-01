"""The entry in the browser pane's server list: starts the tool if needed, then redirects to it.

The pane moves an entry to another port when its own is taken, and the tool has to stay on
3190. So the entry is this page, on a port of its own. The tool runs apart from it, because
the pane stops an entry's process when the chat that pressed it ends.
"""
import os
import subprocess
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOME = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", 3192))
TOOL = "http://localhost:3190/"
STATE = "http://127.0.0.1:3190/api/claude/state"
START_TRIES = 60
START_COMMAND = (
    "New-Item -ItemType Directory -Force '{home}\\data' | Out-Null; "
    "Start-Process -FilePath '{home}\\start.cmd' -WorkingDirectory '{home}' -WindowStyle Hidden "
    "-RedirectStandardOutput '{home}\\data\\server.log' -RedirectStandardError '{home}\\data\\server.err.log'"
)


def tool_is_up():
    try:
        with urllib.request.urlopen(STATE, timeout=2) as reply:
            return reply.status == 200
    except (urllib.error.URLError, OSError):
        return False


def start_tool():
    if os.name == "nt":
        subprocess.run(["powershell", "-NoProfile", "-Command", START_COMMAND.format(home=HOME)], check=False)
        return
    logs = HOME / "data"
    logs.mkdir(exist_ok=True)
    with (logs / "server.log").open("ab") as log:
        subprocess.Popen(
            ["sh", str(HOME / "start.sh")], cwd=HOME, stdin=subprocess.DEVNULL, stdout=log,
            stderr=subprocess.STDOUT, start_new_session=True)


def ensure_tool():
    if tool_is_up():
        return True
    start_tool()
    for _ in range(START_TRIES):
        time.sleep(0.5)
        if tool_is_up():
            return True
    return False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if ensure_tool():
            self.send_response(302)
            self.send_header("Location", TOOL)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        body = b"Annotate could not start. Run start.cmd, or start.sh on Mac and Linux, in Tools/annotate."
        self.send_response(503)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Annotate entry on port {PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
