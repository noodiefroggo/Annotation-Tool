"""What the login task runs: the tool's own supervisor, service.pyw, on this install's port."""
import json
import os
import runpy
from pathlib import Path

HOME = Path(__file__).resolve().parent
config = json.loads((HOME / "install.json").read_text(encoding="utf-8"))
os.environ.setdefault("ANNOTATE_PORT", str(config["port"]))
runpy.run_path(str(HOME / "service.pyw"), run_name="__main__")
