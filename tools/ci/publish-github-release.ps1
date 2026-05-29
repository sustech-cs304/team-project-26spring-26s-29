$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$assets = @(
  Get-ChildItem "dist" -File -Filter "*.exe"
  Get-ChildItem "dist" -File -Filter "*.blockmap"
  Get-ChildItem "dist" -File -Filter "latest*.yml"
)
if (-not ($assets | Where-Object { $_.Extension -eq ".exe" })) {
  throw "Failed to find the generated Windows installer in dist/."
}
$assetPaths = $assets | ForEach-Object { $_.FullName }

gh release view $env:RELEASE_TAG *> $null
$releaseExists = $LASTEXITCODE -eq 0

if ($releaseExists) {
  gh release upload $env:RELEASE_TAG @assetPaths --clobber
} else {
  gh release create $env:RELEASE_TAG @assetPaths --title $env:RELEASE_TAG --generate-notes --verify-tag
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
