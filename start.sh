#!/bin/sh
# The Mac and Linux version of start.cmd.
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv || exit 1
fi
if ! .venv/bin/python -W ignore -c "import pymupdf, PIL, playwright" 2>/dev/null; then
  echo "Installing PyMuPDF, Pillow and Playwright..."
  .venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt || exit 1
fi
exec .venv/bin/python -W ignore -u server.py
