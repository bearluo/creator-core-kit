param(
    [ValidateSet('low', 'mid')]
    [string]$Profile = 'low',
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'E:\android-sdk' }
$avdManager = Join-Path $sdk 'cmdline-tools\16.0\bin\avdmanager.bat'
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$image = 'system-images;android-34;google_apis;x86_64'
$name = if ($Profile -eq 'low') { 'spine_runtime_low' } else { 'spine_runtime_mid' }
$device = if ($Profile -eq 'low') { 'pixel_2' } else { 'pixel_3a' }
$avdDir = Join-Path $env:USERPROFILE ".android\avd\$name.avd"
$config = Join-Path $avdDir 'config.ini'

if (-not (Test-Path $avdManager)) { throw "Missing avdmanager: $avdManager" }
if (-not (Test-Path $emulator)) { throw "Missing emulator: $emulator" }

if (-not (Test-Path $config)) {
    'no' | & $avdManager create avd -n $name -k $image -d $device --force
}

$values = @{
    'hw.cpu.ncore' = if ($Profile -eq 'low') { '2' } else { '4' }
    'hw.ramSize' = if ($Profile -eq 'low') { '2048M' } else { '3072M' }
    'disk.dataPartition.size' = if ($Profile -eq 'low') { '4G' } else { '6G' }
    'hw.lcd.width' = if ($Profile -eq 'low') { '720' } else { '1080' }
    'hw.lcd.height' = if ($Profile -eq 'low') { '1280' } else { '1920' }
    'hw.lcd.density' = if ($Profile -eq 'low') { '320' } else { '420' }
    'hw.gpu.enabled' = 'yes'
    'hw.gpu.mode' = 'host'
    'fastboot.forceColdBoot' = 'yes'
    'fastboot.forceFastBoot' = 'no'
    'showDeviceFrame' = 'no'
}

$lines = if (Test-Path $config) { Get-Content $config } else { @() }
foreach ($key in $values.Keys) {
    $value = $values[$key]
    $found = $false
    $lines = @($lines | ForEach-Object {
        if ($_ -match "^\s*$([regex]::Escape($key))\s*=") {
            $found = $true
            "$key=$value"
        } else {
            $_
        }
    })
    if (-not $found) { $lines += "$key=$value" }
}
$seenKeys = @{}
$lines = @($lines | Where-Object {
    if ($_ -match '^\s*([^#=\s]+)\s*=') {
        $lineKey = $matches[1]
        if ($values.ContainsKey($lineKey)) {
            if ($seenKeys.ContainsKey($lineKey)) { return $false }
            $seenKeys[$lineKey] = $true
        }
    }
    return $true
})
Set-Content -Path $config -Value $lines -Encoding ascii

Write-Host "Configured $name ($Profile)"
Get-Content $config | Where-Object { $_ -match '^(hw\.cpu\.ncore|hw\.ramSize|disk\.dataPartition\.size|hw\.lcd\.|hw\.gpu\.|fastboot\.|showDeviceFrame)' }

if ($Start) {
    $port = if ($Profile -eq 'low') { 5560 } else { 5562 }
    $memoryMb = if ($Profile -eq 'low') { 2048 } else { 3072 }
    $cores = if ($Profile -eq 'low') { 2 } else { 4 }
    $serial = "emulator-$port"
    $running = ((& $adb devices) -match [regex]::Escape($serial))
    if ($running) {
        $runningAvd = ((& $adb -s $serial emu avd name 2>$null) | Select-Object -First 1).Trim()
        if ($runningAvd -ne $name) {
            throw "$serial is already running AVD '$runningAvd', expected '$name'"
        }
    } else {
        Start-Process -FilePath $emulator -ArgumentList @('-avd', $name, '-gpu', 'host', '-memory', $memoryMb, '-cores', $cores, '-port', $port, '-no-audio', '-no-metrics', '-no-snapshot')
    }
    & $adb -s $serial wait-for-device
    do {
        Start-Sleep -Seconds 3
        $boot = (& $adb -s $serial shell getprop sys.boot_completed 2>$null) -replace '\s', ''
    } until ($boot -eq '1')
    Write-Host "Booted $serial"
}
