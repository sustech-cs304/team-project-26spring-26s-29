$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$tempRoot = $env:RUNNER_TEMP
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  $tempRoot = $env:TEMP
}
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  $tempRoot = [System.IO.Path]::GetTempPath()
}

Get-ChildItem -Recurse -File -Include *.js,*.mjs src,tests,tools | ForEach-Object {
  $checkPath = $_.FullName
  if ($_.Extension -eq ".mjs" -or $_.FullName.Contains("\src\renderer\")) {
    $safeName = $_.FullName.Replace(":", "").Replace("\", "_").Replace("/", "_")
    $checkPath = Join-Path $tempRoot "$safeName.mjs"
    Copy-Item $_.FullName $checkPath -Force
  }

  node --check $checkPath
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
