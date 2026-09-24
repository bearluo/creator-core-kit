# 出 VAT 测试包（spine-vat-ui-ab 场景：保真 → A/B 性能 → 穿插/遮挡），arm64 真机。
param(
    [switch]$AllowExistingEditor,
    # Release: Creator debug=false + gradle assembleRelease (native -O2)，测 CPU / 帧时间用。
    [switch]$Release
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cc = if ($env:COCOS_CREATOR) { $env:COCOS_CREATOR } else { 'C:\ProgramData\cocos\editors\Creator\3.8.7\CocosCreator.exe' }
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'E:\android-sdk' }
$javaHome = 'C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot'
$releaseSuffix = if ($Release) { '-release' } else { '' }
$outputName = "android-vatui42-arm64$releaseSuffix"
$configName = "$outputName.json"
$buildPath = Join-Path $project "build\$outputName"
$configPath = Join-Path $project "build-configs\$configName"
$logDir = Join-Path $project 'temp\android-build'
$logStem = "vatui42-arm64$releaseSuffix"
$stdoutLog = Join-Path $logDir "$logStem.stdout.log"
$stderrLog = Join-Path $logDir "$logStem.stderr.log"

if (-not (Test-Path $cc)) { throw "Missing Cocos Creator 3.8.7: $cc" }
if (-not (Test-Path (Join-Path $sdk 'platform-tools\adb.exe'))) { throw "Missing Android SDK: $sdk" }
if (-not (Test-Path $javaHome)) { throw "Missing JDK 17: $javaHome" }
if (-not (Test-Path $configPath)) { throw "Missing build config: $configPath" }

if (-not $AllowExistingEditor) {
    $projectPattern = [regex]::Escape($project)
    $existing = Get-CimInstance Win32_Process -Filter "Name='CocosCreator.exe'" |
        Where-Object { $_.CommandLine -match '--project' -and $_.CommandLine -match $projectPattern }
    if ($existing) {
        throw "Creator is already open for this project. Close it first or pass -AllowExistingEditor."
    }
}

$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
$env:JAVA_HOME = $javaHome
$null = New-Item -ItemType Directory -Path $logDir -Force
$creatorArgs = @(
    '--project', $project,
    '--build', "configPath=$configPath"
)

Write-Host "Building Android $(if ($Release) { 'release' } else { 'debug' }) package (vatui42, arm64-v8a)..."
$process = Start-Process -FilePath $cc -ArgumentList $creatorArgs -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden
# Start-Process -Wait can wait forever on orphaned Electron renderer children.
$process.WaitForExit()
if ($null -ne $process.ExitCode -and $process.ExitCode -ne 0) {
    throw "Cocos Creator build failed with exit code $($process.ExitCode). Logs: $stdoutLog, $stderrLog"
}

$creatorFailurePatterns = @(
    'Missing class:',
    'missing or invalid',
    '[Spine VAT Importer] AssetDB importer 注册失败'
)
$creatorFailures = Select-String -Path $stdoutLog, $stderrLog -Pattern $creatorFailurePatterns -SimpleMatch
if ($creatorFailures) {
    $summary = ($creatorFailures | Select-Object -First 8 | ForEach-Object { $_.Line.Trim() }) -join [Environment]::NewLine
    throw "Cocos Creator reported invalid scripts or extension startup errors:$([Environment]::NewLine)$summary"
}

$gradlew = Join-Path $buildPath 'proj\gradlew.bat'
if (-not (Test-Path $gradlew)) {
    throw "Cocos Creator did not generate the Android project (exit $($process.ExitCode)). Logs: $stdoutLog, $stderrLog"
}

Write-Host 'Compiling APK with Gradle...'
$gradleTask = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
& $gradlew $gradleTask --console=plain -p (Join-Path $buildPath 'proj')
if ($LASTEXITCODE -ne 0) { throw "Gradle $gradleTask failed with exit code $LASTEXITCODE" }

$apk = Get-ChildItem $buildPath -Recurse -Filter '*.apk' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "Gradle exited without an APK under $buildPath" }
Write-Host "APK: $($apk.FullName)"
