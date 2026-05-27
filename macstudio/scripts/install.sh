#!/bin/bash
# 在 Mac Studio 上安装监控脚本与 launchd 定时任务（每 4 小时采集）

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_BIN="${INSTALL_PREFIX:-/usr/local/bin}"
LOG_DIR="${MACSTUDIO_LOG_DIR:-$HOME/Library/Logs/macstudio}"
PLIST_ID="com.dealmanage.macstudio.monitor"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_ID}.plist"

SHARE="${MACSTUDIO_SHARE:-/usr/local/share/macstudio}"
echo "安装 Mac Studio 监控 → $INSTALL_BIN (配置 $SHARE)"
sudo mkdir -p "$INSTALL_BIN" "$SHARE/config" "$SHARE/docs" 2>/dev/null || mkdir -p "$INSTALL_BIN" "$SHARE/config" "$SHARE/docs"
sudo cp -R "$ROOT/config/"* "$SHARE/config/" 2>/dev/null || cp -R "$ROOT/config/"* "$SHARE/config/"
sudo cp -R "$ROOT/docs/"* "$SHARE/docs/" 2>/dev/null || cp -R "$ROOT/docs/"* "$SHARE/docs/"
for f in mac_monitor.sh mac_report.sh mac_analyze.sh; do
  sudo cp "$SCRIPT_DIR/$f" "$INSTALL_BIN/" 2>/dev/null || cp "$SCRIPT_DIR/$f" "$INSTALL_BIN/"
done
sudo cp -R "$SCRIPT_DIR/lib" "$INSTALL_BIN/macstudio-lib" 2>/dev/null || cp -R "$SCRIPT_DIR/lib" "$INSTALL_BIN/macstudio-lib"
chmod +x "$INSTALL_BIN"/mac_*.sh
export MACSTUDIO_ROOT="$SHARE"

mkdir -p "$LOG_DIR"

# 生成 launchd plist
cat >"$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_ID}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${INSTALL_BIN}/mac_monitor.sh</string>
    <string>--append</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MACSTUDIO_LOG_FILE</key>
    <string>${LOG_DIR}/metrics.csv</string>
    <key>MACSTUDIO_ROOT</key>
    <string>${SHARE}</string>
    <key>MACSTUDIO_CONFIG</key>
    <string>${SHARE}/config/thresholds.env</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>14400</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/monitor.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/monitor.stderr.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "完成。"
echo "  采集: mac_monitor.sh --append  (每 4h 自动)"
echo "  看板: mac_report.sh"
echo "  统计: mac_analyze.sh week"
echo "  日志: ${LOG_DIR}/metrics.csv"
echo ""
echo "依赖: brew install smartmontools"
echo "smartctl 需 sudo 免密或首次手动: sudo smartctl -a disk0"
