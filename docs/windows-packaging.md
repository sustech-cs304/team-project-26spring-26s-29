# Windows Packaging Guide

This document explains how to build a Windows installer that preserves backend, workspace, and local tool capabilities after installation.

## Goal

The packaged app must still support:

- the local FastAPI backend
- workspace file tools
- approval-gated PowerShell execution
- approval-gated Python execution with no dependency on a system-wide Python install

That is why the Windows build uses a bundled Python runtime instead of relying on `python` from `PATH`.

## Repository Expectations

The current packaging config in `package.json` expects:

- Electron build output via `electron-builder`
- backend source copied into `resources/backend`
- a bundled Python runtime under `vendor/windows-python/`, copied into `resources/python`

The packaged Electron main process will look for:

- `resources/python/python.exe`

and will launch the backend from the packaged resources directory.

## 1. Prepare Dependencies

Install frontend dependencies:

```powershell
npm install
```

Install backend dependencies for local development:

```powershell
python -m pip install -r backend/requirements.txt
```

## 2. Prepare The Bundled Python Runtime

1. Download a Windows x64 Python runtime that can be redistributed inside the installer.
2. Extract it into:

```text
vendor/windows-python/
  python.exe
  ...
```

3. Ensure the bundled runtime can import site packages.
   If you use the official embeddable ZIP, update the `pythonXY._pth` file to enable `import site`.
4. Install backend dependencies into that bundled runtime:

```powershell
vendor\windows-python\python.exe -m pip install -r backend\requirements.txt
```

5. Verify the runtime can start the backend from the repo root:

```powershell
vendor\windows-python\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

If this step fails, the packaged app's backend and Python tool will also fail after install.

## 3. Build The Installer

Run:

```powershell
npm run package:win
```

The current target is NSIS x64.

## 4. Install And Verify

After installing:

1. Launch the app once.
2. Confirm the config file was created at:

```text
%LOCALAPPDATA%\Student Productivity Agent\config.json
```

3. Confirm the database file and workspace exist beside it:

```text
%LOCALAPPDATA%\Student Productivity Agent\db.json
```

```text
%LOCALAPPDATA%\Student Productivity Agent\workspace\
  inputs\
  outputs\
```

4. Upload a file in chat and verify it lands under `inputs/<requestId>/...`.
5. Ask the agent to:
   - list workspace files
   - read a staged text file
   - create a file under `outputs/`
   - run a short Python snippet
6. Approve the Python tool request and verify it succeeds without installing system Python.

## 5. How Tool Capability Is Preserved

- `run_workspace_shell` uses Windows PowerShell from the machine.
- `run_workspace_python` uses the same Python runtime that launched the packaged backend.
- Because Electron launches `resources/python/python.exe` in packaged mode, the Python tool remains available after install as long as the bundled runtime contains the backend dependencies.

## Troubleshooting

- If the app launches but chat never becomes ready, check whether `resources/python/python.exe` exists in the installed app directory.
- If shell works but Python tool fails, the bundled runtime usually exists but is missing packages from `backend/requirements.txt`.
- If the packaged backend cannot import `backend.app`, verify the build copied the `backend/` directory into `resources/backend`.
