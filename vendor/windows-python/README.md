This directory is a placeholder for the bundled Windows Python runtime used by `npm run package:win`.

The packaged Electron app expects a redistributable Python runtime here with:

- `python.exe` at the top level
- backend dependencies from `backend/requirements.txt` installed into that runtime

See [docs/windows-packaging.md](../../docs/windows-packaging.md) for the full preparation workflow.
