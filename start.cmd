@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" py -m venv .venv
.venv\Scripts\python.exe -W ignore -c "import pymupdf, PIL, playwright" 2>nul
if errorlevel 1 (
  echo Installing PyMuPDF, Pillow and Playwright...
  .venv\Scripts\python.exe -m pip install --quiet --disable-pip-version-check -r requirements.txt
)
.venv\Scripts\python.exe -W ignore -u server.py
