#!/bin/bash
# 从 metrics.csv 做实时 / 周 / 月 维度统计
# 用法: mac_analyze.sh [realtime|week|month|quarter]

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/macstudio-lib/common.sh" ]]; then
  source "$SCRIPT_DIR/macstudio-lib/common.sh"
else
  source "$SCRIPT_DIR/lib/common.sh"
fi

PERIOD="${1:-realtime}"
LOG="${MACSTUDIO_LOG_FILE}"

if [[ ! -f "$LOG" ]]; then
  echo "日志不存在: $LOG"
  echo "请先运行: $SCRIPT_DIR/mac_monitor.sh --append"
  exit 1
fi

filter_days_awk() {
  local days="$1"
  local title="$2"
  local cutoff
  cutoff="$(date -v-"${days}"d +%Y-%m-%d 2>/dev/null)" || cutoff="$(date -d "-${days} days" +%Y-%m-%d 2>/dev/null)" || cutoff="1970-01-01"

  awk -v cutoff="$cutoff" -v title="$title" -F',' '
    NR == 1 && $1 ~ /^timestamp/ { next }
    $1 >= cutoff {
      n++
      pct = $3 + 0; spare = $4 + 0; err = $5 + 0
      swap = $8 + 0; mem = $9 + 0; cpu5 = $12 + 0; duw = $7 + 0
      if (pct > max_pct) max_pct = pct
      if (swap > max_swap) max_swap = swap
      if (mem > max_mem) max_mem = mem
      if (cpu5 > max_cpu5) max_cpu5 = cpu5
      sum_swap += swap; sum_mem += mem; sum_cpu5 += cpu5
      if (mem > 65) mem_warn++
      if (swap > 5) swap_warn++
      if (err > 0) err_hit++
      if (duw > 0) {
        if (first_duw == "") { first_duw = duw; first_d = $1 }
        last_duw = duw; last_d = $1
      }
      last = $0
    }
    END {
      if (n == 0) { print "【" title "】无数据 (cutoff " cutoff ")"; exit }
      printf "【%s】自 %s 起 样本: %d\n", title, cutoff, n
      printf "  SSD Used%% 最大: %s\n", max_pct+0
      printf "  Available Spare 末次见日志末行\n"
      printf "  Swap 最大: %.2f GB  均: %.2f GB  (>5GB: %d 次)\n", max_swap, sum_swap/n, swap_warn+0
      printf "  Mem Pressure 最大: %d%%  均: %.1f%%  (>65%%: %d 次)\n", max_mem, sum_mem/n, mem_warn+0
      printf "  CPU 5m 最大: %.2f  均: %.2f\n", max_cpu5, sum_cpu5/n
      if (err_hit > 0) printf "  ⚠ Media Integrity Errors 出现: %d 次\n", err_hit
      if (first_duw != "" && last_duw > first_duw)
        printf "  Data Units Written Δ: %d (%s → %s)\n", last_duw-first_duw, first_d, last_d
      if (n >= 2 && max_pct > 0) {
        printf "  提示: 对比首尾 ssd_pct 可估算寿命斜率 (见 docs/ANALYSIS.md)\n"
      }
    }
  ' "$LOG"
}

case "$PERIOD" in
  realtime|rt)
    echo "══ 实时维度（最近 6 条 ≈ 24h @4h）══"
    tail -n 7 "$LOG" | head -n 20
    echo
    filter_days_awk 1 "最近 24 小时汇总"
    ;;
  week|weekly)
    echo "══ 周维度 ══"
    filter_days_awk 7 "最近 7 天"
    ;;
  month|monthly)
    echo "══ 月维度 ══"
    filter_days_awk 30 "最近 30 天"
    ;;
  quarter|90)
    echo "══ 季度维度 ══"
    filter_days_awk 90 "最近 90 天"
    ;;
  *)
    echo "用法: $0 [realtime|week|month|quarter]"
    exit 1
    ;;
esac
