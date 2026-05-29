$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ProgressPreference = "SilentlyContinue"

Remove-Item -Recurse -Force vendor/windows-python -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force vendor/windows-python | Out-Null

Invoke-WebRequest `
  -Uri "https://www.python.org/ftp/python/3.14.4/python-3.14.4-embed-amd64.zip" `
  -OutFile "python-embed.zip"

Expand-Archive "python-embed.zip" -DestinationPath "vendor/windows-python"

$pth = Get-ChildItem "vendor/windows-python" -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) {
  throw "Failed to find python._pth in vendor/windows-python."
}

(Get-Content $pth.FullName) `
  -replace '^#import site$', 'import site' `
  | Set-Content $pth.FullName

Invoke-WebRequest `
  -Uri "https://bootstrap.pypa.io/get-pip.py" `
  -OutFile "get-pip.py"

& "vendor/windows-python/python.exe" "get-pip.py"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& "vendor/windows-python/python.exe" -m pip install `
  --upgrade `
  --disable-pip-version-check `
  --no-cache-dir `
  --no-warn-script-location `
  pip `
  setuptools `
  wheel
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& "vendor/windows-python/python.exe" -m pip install `
  --disable-pip-version-check `
  --no-cache-dir `
  --no-compile `
  --no-warn-script-location `
  -r backend/requirements.txt
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
