# Mac Studio 长期运维看板

在 Mac Studio 上采集 SSD / 内存 / CPU 指标，支持 **实时看板**、**周趋势**、**月/季硬件寿命** 三类分析。

## 目录结构

```
macstudio/
├── docs/
│   ├── METRICS.md      # 指标定义与阈值表
│   └── ANALYSIS.md     # 实时 / 周 / 月 维度说明
├── config/
│   └── thresholds.env  # 告警阈值
├── scripts/
│   ├── mac_monitor.sh  # 采集 → CSV
│   ├── mac_report.sh   # 实时看板 + WARN/CRIT
│   ├── mac_analyze.sh  # 周 / 月 / 季统计
│   ├── install.sh      # 安装到 /usr/local/bin + launchd
│   └── lib/common.sh
├── launchd/            # plist 模板
└── logs/               # 本地日志（不入库）
```

## 前置依赖（在 Mac Studio 上执行）

```bash
brew install smartmontools
# 首次验证（需输入密码）
sudo smartctl -a disk0
```

可选：为 launchd 配置 `smartctl` 免密（`/etc/sudoers.d/smartctl`）：

```
你的用户名 ALL=(ALL) NOPASSWD: /opt/homebrew/sbin/smartctl
```

## 快速开始

```bash
cd macstudio/scripts
chmod +x *.sh lib/common.sh

# 单次采集（打印 CSV）
./mac_monitor.sh

# 追加到日志
export MACSTUDIO_LOG_FILE="$HOME/Library/Logs/macstudio/metrics.csv"
./mac_monitor.sh --append

# 实时看板
./mac_report.sh

# 周期统计
./mac_analyze.sh realtime
./mac_analyze.sh week
./mac_analyze.sh month
```

## 一键安装（每 4 小时自动采集）

```bash
./install.sh
```

安装后：

| 命令 | 作用 |
| --- | --- |
| `mac_monitor.sh --append` | 写入 CSV（launchd 每 4h） |
| `mac_report.sh` | 当前值 + 阈值告警 |
| `mac_analyze.sh week` | 最近 7 天 max/avg |

日志默认：`~/Library/Logs/macstudio/metrics.csv`

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `MACSTUDIO_DISK` | NVMe 设备名，默认 `disk0` |
| `MACSTUDIO_LOG_FILE` | CSV 路径 |
| `SMARTCTL_PATH` | smartctl 可执行文件路径 |
| `MACSTUDIO_CONFIG` | 阈值配置文件 |

## 与 deal-manage 的关系

本目录为 **Mac Studio 主机侧** 运维脚本，在仓库中版本化管理；实际采集在 Mac 上运行，Windows 开发机仅编辑/同步脚本。

详细指标与运维动作见 [docs/METRICS.md](docs/METRICS.md)、[docs/ANALYSIS.md](docs/ANALYSIS.md)。
