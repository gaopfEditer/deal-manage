# 统计维度说明（实时 / 周 / 月）

采集脚本将指标追加到 `logs/metrics.csv` 后，按不同时间轴观察，暴露的问题类型不同。

## 1. 实时维度（每 4 小时，或 `mac_report.sh` 随时查看）

**观察对象**：Swap Used、Memory Pressure、CPU Load、SSD Temperature（瞬时指标）。

**能说明的问题**：

- **进程泄漏 / 死锁**：某一时刻 Swap 从数百 MB 飙到 8 GB，或内存压力持续高位 → 当前 Agent、Docker、本地大模型等可能泄漏。
- **异常高负载**：CPU 负载连续多个采样点偏高 → 后台死循环或批任务未限流。

**运维动作**：Kill 高占用进程，或重启 Mac Studio。

```bash
./scripts/mac_report.sh          # 人类可读 + 阈值告警
./scripts/mac_analyze.sh realtime
```

## 2. 周维度（每周趋势）

**观察对象**：Swap 最大值/平均值、Data Units Written 周增量、内存压力高位次数。

**能说明的问题**：

- **写放大**：日志/采集脚本高频写盘 → 周写入量陡增，需改 Redis 缓存或降日志级别。
- **内存常态化吃紧**：Swap 周均值持续攀升但未死机 → 64GB 对多 Agent 并行偏紧，需优化驻留或扩容。

**运维动作**：优化代码；可配置每周一凌晨 `launchd` 定时重启（见 `launchd/`）。

```bash
./scripts/mac_analyze.sh week
```

## 3. 月 / 季 / 年维度（硬件寿命）

**观察对象**：Percentage Used 斜率、Available Spare、Media Integrity Errors。

**能说明的问题**：

- **退役时间估算**：例如一月 `Percentage Used` +1% → 按当前强度约 100 个月寿命（示意，需结合 NVMe 型号 TBW）。
- **不可逆物理损伤**：`Media Integrity Errors` 从 0 变 1+，或 `Available Spare` < 100% → 立刻双重备份并联系 Apple / 第三方维修。

**运维动作**：启动 NAS/云端双备份；勿指望重启修复硬件错误。

```bash
./scripts/mac_analyze.sh month
./scripts/mac_analyze.sh quarter   # 约 90 天
```
