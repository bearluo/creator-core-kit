<#
把本 Creator 工程打成 zip，解压后用 Creator 3.8.7 直接打开。

内容 = git 认为属于工程的文件（已跟踪 + 未跟踪但没被忽略，含未提交的改动）。
library/ temp/ build/ profiles/ artifacts/、本机的 native/.../localCfg.cmake 都被 .gitignore 挡掉，不打。

用法：
  powershell -File tools/pack-project.ps1                 # → build/spine-runtime-lab-<时间>.zip
  powershell -File tools/pack-project.ps1 -Out D:\x.zip
#>
param(
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$name = Split-Path -Leaf $root
if (-not $Out) {
  $Out = Join-Path $root ("build\{0}-{1}.zip" -f $name, (Get-Date -Format 'yyyyMMdd-HHmm'))
}
$Out = [System.IO.Path]::GetFullPath($Out)

Push-Location $root
try {
  $files = @(git -c core.quotepath=off ls-files --cached --others --exclude-standard -- .)
  if ($LASTEXITCODE -ne 0) { throw 'git ls-files 失败（需要在 git 仓库里运行）' }
  # 已删除但还没提交的文件 ls-files 仍会列出，跳过
  $files = $files | Sort-Object -Unique | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
  if (Test-Path $Out) { Remove-Item $Out }
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::Open($Out, 'Create')
  try {
    foreach ($file in $files) {
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, (Join-Path $root $file), "$name/$file", 'Optimal')
    }
  } finally {
    $zip.Dispose()
  }
  $size = (Get-Item $Out).Length / 1MB
  Write-Host ("{0} 个文件 → {1}（{2:N1} MB）" -f $files.Count, $Out, $size)
} finally {
  Pop-Location
}
