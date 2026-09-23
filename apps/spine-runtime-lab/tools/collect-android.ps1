param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Serial = 'emulator-5560',
    [string]$Package = 'com.corekit.spineruntimelab',
    [int]$WarmupSeconds = 12
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$adb = 'E:\android-sdk\platform-tools\adb.exe'
$activity = "$Package/com.cocos.game.AppActivity"
$output = Join-Path $project "temp\android-run\$Name"

if (-not (Test-Path $adb)) { throw "Missing adb: $adb" }
$null = New-Item -ItemType Directory -Path $output -Force

& $adb -s $Serial logcat -c
& $adb -s $Serial shell am force-stop $Package
& $adb -s $Serial shell am start -W -n $activity | Set-Content -Encoding utf8 (Join-Path $output 'start.txt')
Start-Sleep -Seconds $WarmupSeconds

$surface = (& $adb -s $Serial shell dumpsys SurfaceFlinger --list) |
    Where-Object { $_ -like '*SurfaceView*' -and $_ -like "*$Package*" -and $_ -like '*(BLAST)*' } |
    Select-Object -First 1
if ($surface -match '^RequestedLayerState\{(.+?)(?:\s+parentId=|\s+relativeParentId=|\s+z=|\}$)') {
    # Android 16 wraps layer names in RequestedLayerState{...}; --latency needs the inner name.
    $surface = $Matches[1]
}
if ($surface) {
    & $adb -s $Serial shell "dumpsys SurfaceFlinger --latency-clear '$surface'" | Out-Null
    Start-Sleep -Seconds 3
    & $adb -s $Serial shell "dumpsys SurfaceFlinger --latency '$surface'" |
        Set-Content -Encoding utf8 (Join-Path $output 'surface-latency.txt')
}

$pidValue = (& $adb -s $Serial shell pidof $Package).Trim()
if (-not $pidValue) { throw "App process is not running: $Package" }

& $adb -s $Serial shell screencap -p "/sdcard/$Name.png" | Out-Null
& $adb -s $Serial pull "/sdcard/$Name.png" (Join-Path $output 'screen.png') | Out-Null
& $adb -s $Serial shell dumpsys meminfo $Package | Set-Content -Encoding utf8 (Join-Path $output 'meminfo.txt')
& $adb -s $Serial shell top -b -n 5 -d 1 -p $pidValue | Set-Content -Encoding utf8 (Join-Path $output 'top.txt')
& $adb -s $Serial logcat -d -v threadtime | Set-Content -Encoding utf8 (Join-Path $output 'logcat.txt')

$memory = Get-Content -Raw (Join-Path $output 'meminfo.txt')
$pss = if ($memory -match 'TOTAL PSS:\s+(\d+)') { [int]$Matches[1] } else { 0 }
$rss = if ($memory -match 'TOTAL RSS:\s+(\d+)') { [int]$Matches[1] } else { 0 }
$nativePss = if ($memory -match '(?m)^\s*Native Heap\s+(\d+)') { [int]$Matches[1] } else { 0 }
$perfLines = @(Get-Content (Join-Path $output 'logcat.txt') |
    Select-String -SimpleMatch '[SpinePerf]' |
    Select-Object -ExpandProperty Line)
$perfLine = $perfLines | Select-Object -Last 1
$perf = $null
if ($perfLine -and $perfLine -match 'mode=(\S+) instances=(\d+) fps=([\d.]+) p50=([\d.]+) p95=([\d.]+) over25=([\d.]+) samples=(\d+) drawCalls=(\d+) drawCallsAvg=([\d.]+) drawCallsMax=(\d+) gpuInstances=(\d+) triangles=(\d+) textureMB=([\d.]+) bufferMB=([\d.]+)') {
    $perf = [ordered]@{
        runtimeMode = $Matches[1]
        configuredInstances = [int]$Matches[2]
        fps = [double]$Matches[3]
        p50FrameMs = [double]$Matches[4]
        p95FrameMs = [double]$Matches[5]
        framesOver25Percent = [double]$Matches[6]
        frameSamples = [int]$Matches[7]
        drawCalls = [int]$Matches[8]
        averageDrawCalls = [double]$Matches[9]
        windowMaxDrawCalls = [int]$Matches[10]
        gpuInstances = [int]$Matches[11]
        triangles = [int]$Matches[12]
        textureMemoryMb = [double]$Matches[13]
        bufferMemoryMb = [double]$Matches[14]
    }
    $drawCallSamples = @($perfLines | ForEach-Object {
        if ($_ -match 'drawCallsMax=(\d+)') { [int]$Matches[1] }
    })
    if ($drawCallSamples.Count -gt 0) {
        $perf.maxDrawCalls = ($drawCallSamples | Measure-Object -Maximum).Maximum
    }
}
$cpuSamples = Get-Content (Join-Path $output 'top.txt') | ForEach-Object {
    if ($_ -like "*$Package") {
        $columns = $_.Trim() -split '\s+'
        if ($columns.Count -gt 8) { [double]$columns[8] }
    }
}
$latencyPath = Join-Path $output 'surface-latency.txt'
$frameTimes = @()
if (Test-Path $latencyPath) {
    $presentTimes = Get-Content $latencyPath | Select-Object -Skip 1 | ForEach-Object {
        $columns = $_ -split '\s+'
        if ($columns.Count -ge 2 -and $columns[1] -match '^\d+$' -and [int64]$columns[1] -gt 0) {
            [int64]$columns[1]
        }
    }
    for ($i = 1; $i -lt $presentTimes.Count; $i += 1) {
        $deltaMs = ($presentTimes[$i] - $presentTimes[$i - 1]) / 1000000.0
        if ($deltaMs -gt 0 -and $deltaMs -lt 1000) { $frameTimes += $deltaMs }
    }
}

$summary = [ordered]@{
    name = $Name
    serial = $Serial
    pid = [int]$pidValue
    totalPssKb = $pss
    totalRssKb = $rss
    nativePssKb = $nativePss
    cpuSamples = @($cpuSamples)
    averageCpuPercent = if ($cpuSamples.Count -gt 0) {
        [math]::Round(($cpuSamples | Measure-Object -Average).Average, 1)
    } else { 0 }
    runtime = $perf
}
if ($frameTimes.Count -gt 0) {
    $sorted = $frameTimes | Sort-Object
    $average = ($frameTimes | Measure-Object -Average).Average
    $summary.frameSamples = $frameTimes.Count
    $summary.averageFrameMs = [math]::Round($average, 3)
    $summary.averageFps = [math]::Round(1000 / $average, 2)
    $summary.p50FrameMs = [math]::Round($sorted[[math]::Floor(($sorted.Count - 1) * 0.50)], 3)
    $summary.p95FrameMs = [math]::Round($sorted[[math]::Floor(($sorted.Count - 1) * 0.95)], 3)
    $summary.framesOver25Ms = @($frameTimes | Where-Object { $_ -gt 25 }).Count
}
$summary | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $output 'summary.json')
$summary | Format-List
