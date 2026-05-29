$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$installer = Get-ChildItem "dist" -File -Filter "*.exe" | Select-Object -First 1
if (-not $installer) {
  throw "Failed to find the generated Windows installer in dist/."
}

$blockmap = Get-ChildItem "dist" -File -Filter "*.blockmap" | Select-Object -First 1
$metadata = Get-ChildItem "dist" -File -Filter "latest*.yml" | Select-Object -First 1

"installer_path=$($installer.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
if ($blockmap) {
  "blockmap_path=$($blockmap.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}
if ($metadata) {
  "metadata_path=$($metadata.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}
