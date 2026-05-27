#!/bin/bash
# Mac Studio 指标采集 → CSV 一行（可追加到日志）
# 用法:
#   ./mac_monitor.sh              # 打印一行 CSV
#   ./mac_monitor.sh --append     # 追加到 MACSTUDIO_LOG_FILE（无表头则自动写表头）
#   ./mac_monitor.sh --json       # JSON 单行（便于 API）

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/macstudio-lib/common.sh" ]]; then
  # shellcheck source=macstudio-lib/common.sh
  source "$SCRIPT_DIR/macstudio-lib/common.sh"
else
  # shellcheck source=lib/common.sh
  source "$SCRIPT_DIR/lib/common.sh"
fi

MODE="${1:---stdout}"

SMARTCTL="$(find_smartctl)"
SSD_PCT=""
SSD_SPARE=""
SSD_ERR=""
SSD_TEMP=""
SSD_DUW=""

if [[ -n "$SMARTCTL" ]]; then
  SMART_DATA="$(sudo "$SMARTCTL" -a "$MACSTUDIO_DISK" 2>/dev/null || true)"
  if [[ -n "$SMART_DATA" ]]; then
    SSD_PCT="$(echo "$SMART_DATA" | awk -F: '/Percentage Used:/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"
    SSD_SPARE="$(echo "$SMART_DATA" | awk -F: '/Available Spare:/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"
    SSD_ERR="$(echo "$SMART_DATA" | awk -F: '/Media and Data Integrity Errors:/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"
    SSD_TEMP="$(echo "$SMART_DATA" | awk -F: '/Temperature:/ {gsub(/[^0-9.]/,"",$2); print $2; exit}')"
    SSD_DUW="$(echo "$SMART_DATA" | awk -F: '/Data Units Written/ {gsub(/[^0-9]/,"",$2); print $2; exit}')"
  fi
fi

SWAP_RAW="$(sysctl vm.swapusage 2>/dev/null || echo '')"
SWAP_USED_RAW="$(echo "$SWAP_RAW" | awk '{for(i=1;i<=NF;i++) if($i=="used") print $(i+2)}')"
SWAP_GB="$(to_gb "${SWAP_USED_RAW:-0M}")"

PAGE_ACTIVE="$(vm_page_count "Pages active")"
PAGE_INACTIVE="$(vm_page_count "Pages inactive")"
PAGE_SPECULATIVE="$(vm_page_count "Pages speculative")"
PAGE_WIRED="$(vm_page_count "Pages wired down")"

PAGE_ACTIVE="${PAGE_ACTIVE:-0}"
PAGE_INACTIVE="${PAGE_INACTIVE:-0}"
PAGE_SPECULATIVE="${PAGE_SPECULATIVE:-0}"
PAGE_WIRED="${PAGE_WIRED:-0}"

TOTAL_USED_PAGES=$((PAGE_ACTIVE + PAGE_WIRED + PAGE_INACTIVE + PAGE_SPECULATIVE))
if [[ "$TOTAL_USED_PAGES" -gt 0 ]]; then
  MEM_PRESSURE=$(( (PAGE_WIRED + PAGE_ACTIVE) * 100 / TOTAL_USED_PAGES ))
else
  MEM_PRESSURE=0
fi

LOAD_LINE="$(uptime)"
CPU_LOAD_1="$(echo "$LOAD_LINE" | awk -F'load averages:' '{print $2}' | awk '{gsub(/,/,"",$1); print $1}')"
CPU_LOAD_5="$(echo "$LOAD_LINE" | awk -F'load averages:' '{print $2}' | awk '{gsub(/,/,"",$2); print $2}')"
CPU_LOAD_15="$(echo "$LOAD_LINE" | awk -F'load averages:' '{print $2}' | awk '{gsub(/,/,"",$3); print $3}')"

TS="$(date "+%Y-%m-%d %H:%M:%S")"
CSV_LINE="$TS,${SSD_PCT:-},${SSD_SPARE:-},${SSD_ERR:-},${SSD_TEMP:-},${SSD_DUW:-},$SWAP_GB,$MEM_PRESSURE,${CPU_LOAD_1:-},${CPU_LOAD_5:-},${CPU_LOAD_15:-}"

case "$MODE" in
  --json)
    printf '{"timestamp":"%s","ssd_pct":"%s","ssd_spare":"%s","ssd_err":"%s","ssd_temp":"%s","ssd_duw":"%s","swap_gb":%s,"mem_pressure":%s,"cpu_load_1":"%s","cpu_load_5":"%s","cpu_load_15":"%s"}\n' \
      "$TS" "${SSD_PCT:-}" "${SSD_SPARE:-}" "${SSD_ERR:-}" "${SSD_TEMP:-}" "${SSD_DUW:-}" \
      "$SWAP_GB" "$MEM_PRESSURE" "${CPU_LOAD_1:-}" "${CPU_LOAD_5:-}" "${CPU_LOAD_15:-}"
    ;;
  --append)
    ensure_log_dir
    if [[ ! -s "$MACSTUDIO_LOG_FILE" ]]; then
      csv_header >>"$MACSTUDIO_LOG_FILE"
    fi
    echo "$CSV_LINE" >>"$MACSTUDIO_LOG_FILE"
    echo "appended: $MACSTUDIO_LOG_FILE"
    ;;
  --stdout|*)
    echo "$CSV_LINE"
    ;;
esac
