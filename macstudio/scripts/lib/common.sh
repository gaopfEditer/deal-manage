#!/bin/bash
# shellcheck shell=bash
# 公共函数：路径、smartctl、数值解析

set -euo pipefail

if [[ -z "${MACSTUDIO_ROOT:-}" ]]; then
  _lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ "$_lib" == *macstudio-lib ]]; then
    MACSTUDIO_ROOT="$(cd "$_lib/../../.." && pwd)"
  else
    MACSTUDIO_ROOT="$(cd "$_lib/../.." && pwd)"
  fi
fi
MACSTUDIO_ROOT="${MACSTUDIO_ROOT:-/usr/local/share/macstudio}"
MACSTUDIO_LOG_DIR="${MACSTUDIO_LOG_DIR:-$HOME/Library/Logs/macstudio}"
MACSTUDIO_LOG_FILE="${MACSTUDIO_LOG_FILE:-$MACSTUDIO_LOG_DIR/metrics.csv}"
MACSTUDIO_DISK="${MACSTUDIO_DISK:-disk0}"

find_smartctl() {
  local p
  for p in \
    "${SMARTCTL_PATH:-}" \
    /opt/homebrew/sbin/smartctl \
    /opt/homebrew/bin/smartctl \
    /usr/local/sbin/smartctl \
    /usr/local/bin/smartctl; do
    [[ -n "$p" && -x "$p" ]] && echo "$p" && return 0
  done
  command -v smartctl 2>/dev/null || true
}

# 将 123.45M / 1.23G 转为 GB（保留 2 位小数）
to_gb() {
  local raw="${1:-0}"
  raw="${raw//,/}"
  if [[ "$raw" =~ ^([0-9.]+)G$ ]]; then
    printf '%.2f' "${BASH_REMATCH[1]}"
  elif [[ "$raw" =~ ^([0-9.]+)M$ ]]; then
    awk -v m="${BASH_REMATCH[1]}" 'BEGIN { printf "%.2f", m/1024 }'
  elif [[ "$raw" =~ ^([0-9.]+)K$ ]]; then
    awk -v k="${BASH_REMATCH[1]}" 'BEGIN { printf "%.2f", k/1024/1024 }'
  elif [[ "$raw" =~ ^[0-9.]+$ ]]; then
    printf '%.2f' "$raw"
  else
    echo "0.00"
  fi
}

strip_pct() {
  echo "${1//%/}"
}

vm_page_count() {
  local key="$1"
  vm_stat | awk -v k="$key" '$0 ~ k { gsub(/\./, "", $3); print $3; exit }'
}

cpu_cores() {
  sysctl -n hw.logicalcpu 2>/dev/null || echo 8
}

ensure_log_dir() {
  mkdir -p "$(dirname "$MACSTUDIO_LOG_FILE")"
}

csv_header() {
  echo "timestamp,ssd_pct,ssd_spare,ssd_err,ssd_temp,ssd_duw,swap_gb,mem_pressure,cpu_load_1,cpu_load_5,cpu_load_15"
}
