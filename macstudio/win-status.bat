@echo off
chcp 65001 >nul
title Windows 系统性损耗综合看板

:: ========================================================================
:: 【自动化提权逻辑】这段代码确保脚本双击即拥有真正的最高管理员权限
:: ========================================================================
:init
setlocal DisableDelayedExpansion
set "batchPath=%~0"
for %%A in ("%batchPath%") do set "batchPath=%%~fA"
set "vbsGetAdmin=%temp%\vbsGetAdmin.vbs"
fltmc >nul 2>&1
if "%errorlevel%" NEQ "0" (
    echo [提示] 正在获取系统底层硬件访问权限...
    echo Set UAC = CreateObject^("Shell.Application"^) > "%vbsGetAdmin%"
    echo UAC.ShellExecute "cmd.exe", "/c ""%batchPath%"" ", "", "runas", 1 >> "%vbsGetAdmin%"
    "%vbsGetAdmin%"
    del "%vbsGetAdmin%"
    exit /B
)
pushd "%cd%"
cd /d "%~dp0"
:: ========================================================================

cls
echo ========================================================================
echo                  Windows 系统性损耗综合看板 (全量校对版)
echo ========================================================================
echo 检查时间: %date% %time%
echo ------------------------------------------------------------------------

:: --- 1. 算力与热力指标 (CPU 温度) ---
echo [1. 算力与热力负载]
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $raw = Get-CimInstance -Namespace 'root\wmi' -ClassName 'MSAcpi_ThermalZoneTemperature' -ErrorAction Stop; if ($raw) { $temp = [Math]::Round(($raw[0].CurrentTemperature / 10) - 273.15, 1); Write-Host '   CPU 当前核心温度 : ' -NoNewline; Write-Host ($temp.ToString() + ' °C') -ForegroundColor Green } } catch { Write-Host '   CPU 温度读取失败（当前主板BIOS未向系统开放ACPI温度接口）。' -ForegroundColor Red }"

:: --- 2. 内存与虚拟内存指标 (Commit Charge) ---
echo.
echo [2. 内存与虚拟内存损耗]
powershell -NoProfile -ExecutionPolicy Bypass -Command "$commit = (Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory).PercentCommittedBytesInUse; Write-Host '   当前虚拟内存提交率 (Commit Charge): ' -NoNewline; if ($commit -gt 80) { Write-Host ($commit.ToString() + ' %% (高位运行，建议近期重启系统)') -ForegroundColor Yellow } else { Write-Host ($commit.ToString() + ' %% (流畅)') -ForegroundColor Green }"

:: --- 3. 存储盘空间与固态磨损均衡缓冲区 ---
echo.
echo [3. C盘剩余空间比例]
powershell -NoProfile -ExecutionPolicy Bypass -Command "$free = Get-CimInstance -ClassName Win32_LogicalDisk -Filter \"DeviceID='C:'\" | %% {[Math]::Round(($_.FreeSpace / $_.Size) * 100, 2)}; Write-Host '   C盘当前剩余空间 : ' -NoNewline; if ($free -lt 15) { Write-Host ($free.ToString() + ' %% (警告：低于15%%，固态硬盘垃圾回收效率将严重下降！)') -ForegroundColor Red } else { Write-Host ($free.ToString() + ' %% (空间充足)') -ForegroundColor Green }"

:: --- 4. 磁盘物理健康状态列表 ---
echo.
echo [4. 磁盘物理健康列表]
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-PhysicalDisk | ForEach-Object { $color = if ($_.HealthStatus -eq 'Healthy') { 'Green' } else { 'Red' }; Write-Host '   硬盘 #' $_.DeviceId ' [' $_.FriendlyName '] -> 状态: ' -NoNewline; Write-Host $_.HealthStatus -ForegroundColor $color }"

:: --- 5. 磁盘致命坏道与故障预测 ---
echo.
echo [5. 磁盘硬件物理故障预测]
powershell -NoProfile -ExecutionPolicy Bypass -Command "$predict = Get-CimInstance -Namespace 'root\cimv2' -ClassName 'Win32_DiskDrive' -ErrorAction SilentlyContinue; $hasError = $false; foreach($disk in $predict) { if ($disk.PredictFailure -eq $true) { Write-Host '   [严重警告] 磁盘 ' $disk.DeviceID ' 预测到物理故障！请立刻备份！' -ForegroundColor Red; $hasError = $true } }; if (-not $hasError) { Write-Host '   磁盘预警检查通过：未发现物理硬件坏道预警(PASS)。' -ForegroundColor Green }"

echo ------------------------------------------------------------------------
echo [运维提示] 
echo  - 如果 [Commit Charge] > 80%% -> 软件内存泄漏，建议【重启系统】。
echo  - 如果 C盘剩余空间 < 12%% -> 固态写入性能会变差，建议【清理垃圾】。
echo  - 如果 [物理故障预测] 触发警告 -> 硬件不可逆物理损坏，立刻【更换硬盘】。
echo ========================================================================
echo.
echo 按任意键退出看板...
pause >nul