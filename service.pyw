"""Keeps the server running, with no window. Windows starts this at login.

install-service.ps1 registers it. If the server exits for any reason, it starts again here. If
something else already holds the port, this waits, so there is only ever one server.
"""
import os
import socket
import subprocess
import time
from pathlib import Path

HOME = Path(__file__).resolve().parent
LOG = HOME / "data" / "server.log"
PORT = int(os.environ.get("ANNOTATE_PORT", "3190"))
CHECK_SECONDS = 5
MAX_LOG_BYTES = 5_000_000


def server_is_up():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=1):
            return True
    except OSError:
        return False


def run_server():
    LOG.parent.mkdir(exist_ok=True)
    if LOG.exists() and LOG.stat().st_size > MAX_LOG_BYTES:
        LOG.replace(LOG.with_suffix(".old.log"))
    with LOG.open("ab") as log:
        subprocess.run(
            ["cmd", "/c", str(HOME / "start.cmd")],
            cwd=HOME,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )


def main():
    while True:
        if not server_is_up():
            run_server()
        time.sleep(CHECK_SECONDS)


if __name__ == "__main__":
    main()
