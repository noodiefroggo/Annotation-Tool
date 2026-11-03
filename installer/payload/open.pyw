"""The Start menu shortcut: starts Annotate if it is down, then opens it in the browser."""
import sys
import webbrowser
from pathlib import Path

HOME = Path(__file__).resolve().parent
sys.path.insert(0, str(HOME))
import annotate_install as setup  # noqa: E402

config = setup.Config.load(HOME)
if not setup.server_is_up(config.port):
    if not setup.port_in_use(config.port):
        setup.start_detached(config)
    setup.wait_for_server(config.port, 30)
webbrowser.open(config.url)
