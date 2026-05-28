#!/bin/bash
# 实时看板：采集当前值 + 按 thresholds.env 输出告警等级

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/macstudio-lib/common.sh" ]]; then
  source "$SCRIPT_DIR/macstudio-lib/common.sh"
else
  source "$SCRIPT_DIR/lib/common.sh"
fi

CONFIG="${MACSTUDIO_CONFIG:-$MACSTUDIO_ROOT/config/thresholds.env}"
[[ -f "$CONFIG" ]] && source "$CONFIG"

CORES="$(cpu_cores)"
CPU_LIMIT="$(awk -v c="$CORES" -v f="${CPU_LOAD_FACTOR:-0.7}" 'BEGIN { printf "%.2f", c*f }')"

# 采集最新一行（不追加）
LINE="$("$SCRIPT_DIR/mac_monitor.sh")"
IFS=',' read -r TS SSD_PCT SSD_SPARE SSD_ERR SSD_TEMP SSD_DUW SWAP_GB MEM_P CPU1 CPU5 CPU15 <<<"$LINE"

level_ok() { echo "  OK   $*"; }
level_warn() { echo "  WARN $*"; }
level_crit() { echo "  CRIT $*"; }

echo "══════════════════════════════════════════════════"
echo " Mac Studio 运维看板  $TS"
echo " 主机: $(scutil --get ComputerName 2>/dev/null || hostname)"
echo " 日志: $MACSTUDIO_LOG_FILE"
echo "══════════════════════════════════════════════════"
echo
echo "【存储 / SSD】"
if [[ -z "${SSD_PCT:-}" ]]; then
  level_warn "smartctl 无数据（需: brew install smartmontools && sudo smartctl -a disk0）"
else
  if [[ -n "$SSD_PCT" && "$SSD_PCT" -ge "${SSD_PCT_CRITICAL:-100}" ]]; then level_crit "Percentage Used ${SSD_PCT}% ≥ ${SSD_PCT_CRITICAL}%"
  elif [[ -n "$SSD_PCT" && "$SSD_PCT" -gt "${SSD_PCT_WARN:-80}" ]]; then level_warn "Percentage Used ${SSD_PCT}% > ${SSD_PCT_WARN}%"
  else level_ok "Percentage Used ${SSD_PCT}%"; fi

  if [[ -n "$SSD_SPARE" && "$SSD_SPARE" -lt "${SSD_SPARE_CRITICAL:-99}" ]]; then level_crit "Available Spare ${SSD_SPARE}% < ${SSD_SPARE_CRITICAL}%"
  else level_ok "Available Spare ${SSD_SPARE:-?}%"; fi

  if [[ -n "$SSD_ERR" && "$SSD_ERR" -gt "${SSD_ERR_CRITICAL:-0}" ]]; then level_crit "Media Integrity Errors = $SSD_ERR"
  else level_ok "Media Integrity Errors ${SSD_ERR:-0}"; fi

  if [[ -n "$SSD_TEMP" ]]; then
    t="${SSD_TEMP//[^0-9.]/}"
    if awk -v t="$t" -v c="${SSD_TEMP_CRITICAL:-90}" 'BEGIN { exit !(t+0 >= c+0) }'; then level_crit "SSD Temperature ${t}°C ≥ ${SSD_TEMP_CRITICAL}°C"
    elif awk -v t="$t" -v w="${SSD_TEMP_WARN:-75}" 'BEGIN { exit !(t+0 > w+0) }'; then level_warn "SSD Temperature ${t}°C > ${SSD_TEMP_WARN}°C"
    else level_ok "SSD Temperature ${t}°C"; fi
  fi
  echo "  Data Units Written (raw): ${SSD_DUW:-—}"
fi

echo
echo "【内存 / Swap】"
if [[ "$MEM_P" -ge "${MEM_PRESSURE_CRITICAL:-80}" ]]; then level_crit "Memory Pressure ${MEM_P}% ≥ ${MEM_PRESSURE_CRITICAL}%"
elif [[ "$MEM_P" -gt "${MEM_PRESSURE_WARN:-65}" ]]; then level_warn "Memory Pressure ${MEM_P}% > ${MEM_PRESSURE_WARN}%"
else level_ok "Memory Pressure ${MEM_P}%"; fi

if awk -v s="$SWAP_GB" -v c="${SWAP_GB_CRITICAL:-16}" 'BEGIN { exit !(s+0 >= c+0) }'; then level_crit "Swap Used ${SWAP_GB} GB ≥ ${SWAP_GB_CRITICAL} GB"
elif awk -v s="$SWAP_GB" -v w="${SWAP_GB_WARN:-5}" 'BEGIN { exit !(s+0 > w+0) }'; then level_warn "Swap Used ${SWAP_GB} GB > ${SWAP_GB_WARN} GB"
else level_ok "Swap Used ${SWAP_GB} GB"; fi

echo
echo "【CPU 负载】逻辑核: $CORES  建议 < $CPU_LIMIT"
for pair in "1min:$CPU1" "5min:$CPU5" "15min:$CPU15"; do
  name="${pair%%:*}"
  v="${pair##*:}"
  if awk -v v="$v" -v lim="$CPU_LIMIT" 'BEGIN { exit !(v+0 > lim+0) }' 2>/dev/null; then
    level_warn "Load $name = $v"
  else
    level_ok "Load $name = $v"
  fi
done

echo
echo "【原始 CSV】"
echo "$LINE"
echo
echo "周期统计: $SCRIPT_DIR/mac_analyze.sh week | month"
