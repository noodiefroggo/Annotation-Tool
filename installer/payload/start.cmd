@echo off
rem Starts the server with the Python that AnnotateSetup.exe installed beside it.
rem The service, the Annotate button in Claude and the Start menu shortcut all start it here.
setlocal
cd /d "%~dp0"
if not defined ANNOTATE_PORT set ANNOTATE_PORT={port}
runtime\python.exe -W ignore -u server.py
