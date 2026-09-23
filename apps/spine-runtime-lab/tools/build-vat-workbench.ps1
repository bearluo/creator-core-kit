[CmdletBinding()]
param(
  [string]$CreatorPath = 'C:\ProgramData\cocos\editors\Creator\3.8.7\CocosCreator.exe'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'build-configs\web-vat-workbench.json'
$outputRoot = Join-Path $projectRoot 'build\web-vat-workbench'
$tempRoot = Join-Path $projectRoot 'temp\vat-workbench-build'
$stdoutLog = Join-Path $tempRoot 'stdout.log'
$stderrLog = Join-Path $tempRoot 'stderr.log'

if (-not (Test-Path -LiteralPath $CreatorPath -PathType Leaf)) {
  throw "Cocos Creator 3.8.7 not found: $CreatorPath"
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$process = Start-Process -FilePath $CreatorPath `
  -ArgumentList @('--project', $projectRoot, '--build', "configPath=$configPath") `
  -PassThru `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden
$process.WaitForExit()

$finished = Select-String -LiteralPath $stdoutLog -Pattern 'build Task .* Finished' -Quiet
if (-not $finished) {
  Get-Content -LiteralPath $stdoutLog -Tail 80
  Get-Content -LiteralPath $stderrLog -Tail 80
  throw "VAT workbench build failed with exit code $($process.ExitCode)"
}

$indexPath = Join-Path $outputRoot 'index.html'
if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
  throw "Build completed but index.html is missing: $indexPath"
}

$marker = 'data-spine-vat-workbench'
$html = [IO.File]::ReadAllText($indexPath)
if (-not $html.Contains($marker)) {
  $bootstrap = '<script data-spine-vat-workbench>const u=new URL(location.href);u.searchParams.set("workbench","1");history.replaceState(null,"",u);</script>'
  $html = $html -replace '<head>', "<head>`r`n  $bootstrap"
  [IO.File]::WriteAllText($indexPath, $html, [Text.UTF8Encoding]::new($false))
}

$runtimeZipPath = Join-Path $outputRoot 'spine-vat-runtime.zip'
$extensionRoot = Join-Path $projectRoot 'extensions\spine-vat-importer'
$runtimeSources = @(
  Get-ChildItem -LiteralPath $extensionRoot -Recurse -File | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($extensionRoot, $_.FullName).Replace('\', '/')
    @{
      Source = $_.FullName
      Entry = "spine-vat-runtime/extensions/spine-vat-importer/$relative"
    }
  }
)
$runtimeSources += @{
  Source = Join-Path $projectRoot 'tools\spine-vat-runtime-README.md'
  Entry = 'spine-vat-runtime/README.md'
}

Add-Type -AssemblyName System.IO.Compression
$zipStream = [IO.File]::Open(
  $runtimeZipPath,
  [IO.FileMode]::Create,
  [IO.FileAccess]::Write,
  [IO.FileShare]::None
)
$archive = [IO.Compression.ZipArchive]::new(
  $zipStream,
  [IO.Compression.ZipArchiveMode]::Create,
  $false
)
try {
  foreach ($runtimeSource in $runtimeSources) {
    if (-not (Test-Path -LiteralPath $runtimeSource.Source -PathType Leaf)) {
      throw "VAT runtime source is missing: $($runtimeSource.Source)"
    }
    $entry = $archive.CreateEntry($runtimeSource.Entry, [IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $sourceStream = [IO.File]::OpenRead($runtimeSource.Source)
    try {
      $sourceStream.CopyTo($entryStream)
    } finally {
      $sourceStream.Dispose()
      $entryStream.Dispose()
    }
  }
} finally {
  $archive.Dispose()
  $zipStream.Dispose()
}

Write-Host "VAT workbench ready: $outputRoot"
Write-Host "Creator runtime package: $runtimeZipPath"
Write-Host 'Local preview: node tools/static-server.mjs build/web-vat-workbench 18120'
