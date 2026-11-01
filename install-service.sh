#!/bin/sh
# Registers the always-on server for this Mac or Linux account. It needs no admin rights.
#   Install or update:  sh install-service.sh
#   Remove:             sh install-service.sh --remove
set -eu

root=$(cd "$(dirname "$0")" && pwd)
python="$root/.venv/bin/python"
remove=false
[ "${1:-}" = "--remove" ] && remove=true

if ! $remove && [ ! -x "$python" ]; then
  echo "Run start.sh once first, so the Python environment exists." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    label=com.annotate.server
    plist="$HOME/Library/LaunchAgents/$label.plist"
    launchctl unload "$plist" 2>/dev/null || true
    if $remove; then
      rm -f "$plist"
      echo "Removed $label. A server that is already running keeps going until you restart."
      exit 0
    fi
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$python</string><string>$root/service.pyw</string></array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
    launchctl load "$plist"
    ;;
  Linux)
    unit="$HOME/.config/systemd/user/annotate.service"
    systemctl --user disable --now annotate.service 2>/dev/null || true
    if $remove; then
      rm -f "$unit"
      systemctl --user daemon-reload
      echo "Removed annotate.service. A server that is already running keeps going until you restart."
      exit 0
    fi
    mkdir -p "$(dirname "$unit")"
    cat > "$unit" <<EOF
[Unit]
Description=Annotate

[Service]
WorkingDirectory=$root
ExecStart="$python" "$root/service.pyw"
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now annotate.service
    ;;
  *)
    echo "This script is for Mac and Linux. On Windows, use install-service.ps1." >&2
    exit 1
    ;;
esac
echo "Installed. The tool stays on at http://localhost:3190"
