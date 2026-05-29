$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& "vendor/windows-python/python.exe" -m pip --version
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& "vendor/windows-python/python.exe" -c "import fastapi, uvicorn, tinydb, agent_framework; print('ok')"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
