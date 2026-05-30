# Team Report

## 1. Project Overview

Our project is **SUSTech Student Assistant**, a local desktop application designed for Southern University of Science and Technology students. The application combines student productivity workflows with SUSTech-oriented campus information. Its main functions include:

- chatting with a Python-backed assistant;
- managing todos and due dates;
- managing schedule events;
- synchronizing Blackboard items into reviewed todo or schedule suggestions;
- searching and using SUSTech-oriented campus knowledge from the NanKe Manual corpus.

The system is implemented as a local Electron desktop application. The renderer layer uses HTML, CSS, and vanilla JavaScript; the desktop shell and IPC layer use Electron; the backend uses FastAPI; local persistence uses TinyDB. The repository also includes backend unit tests, Electron-side tests, documentation, CI scripts, and a Windows packaging workflow.

The runtime architecture is organized into the following layers:

```text
Renderer UI
  -> preload bridge
  -> Electron main process
  -> local HTTP / WebSocket boundary
  -> FastAPI backend
  -> services / repositories / TinyDB
```

This separation keeps UI code in `src/renderer/`, system and process control in `src/electron/`, and business logic plus persistence in `backend/`.

## 2. Metrics

The following metrics were generated from the project source code using the script `tools/ci/generate-metrics-report.ps1`. The generated result is stored in `metrics-report.txt`.

The measurement scope includes:

- included directories: `backend/`, `src/`, `tools/`;
- excluded directories: `tests/`, `vendor/`, `node_modules/`;
- included file types: `.py`, `.js`, `.mjs`, `.html`, `.css`.

| Metric | Value |
| --- | ---: |
| Lines of Code | 13,333 |
| Number of source files | 76 |
| Cyclomatic complexity | Average CCN 3.1 |
| Number of direct dependencies | 16 |

### 2.1 Dependency Breakdown

| Dependency Type | Count |
| --- | ---: |
| Node runtime dependencies | 2 |
| Node development dependencies | 2 |
| Python dependencies | 12 |
| Total direct dependencies | 16 |

The Node runtime dependencies are `katex` and `markdown-it`. The Node development dependencies are `electron` and `electron-builder`. The Python dependencies are listed in `backend/requirements.txt`, including FastAPI, Uvicorn, TinyDB, document-processing libraries, HTTP/parsing utilities, and the agent framework.

### 2.2 Cyclomatic Complexity Measurement

Cyclomatic complexity was measured by `lizard` with the following command:

```powershell
python -m lizard backend src tools -l python -l javascript
```

The report analyzed 772 functions and reported an average cyclomatic complexity number of 3.1. There were 13 high-complexity warnings. The warnings mainly appear in code paths that handle richer branching logic, such as agent message serialization, Blackboard item classification, schedule update validation, chat preview rendering, and corpus validation. These modules contain more conditional behavior because they need to validate user input, normalize structured content, or classify external data.

## 3. CI/CD Pipeline Description

The project uses **GitHub Actions** as the CI/CD platform. The main workflow file is:

```text
.github/workflows/build-windows-installer.yml
```

Repository link:

```text
https://github.com/sustech-cs304/team-project-26spring-26s-29
```

Workflow configuration link:

```text
https://github.com/sustech-cs304/team-project-26spring-26s-29/blob/main/.github/workflows/build-windows-installer.yml
```

The workflow is named **Build and Release**. It runs on `windows-latest` and is triggered by:

- manual execution through `workflow_dispatch`;
- pushes to the `main` branch;
- version tags matching `v*.*.*`.

### 3.1 Pipeline Steps

| Step | Tool / Technology | Purpose |
| --- | --- | --- |
| Checkout | `actions/checkout@v6` | Check out the repository source code, including submodules. |
| Setup Node | `actions/setup-node@v6` | Install Node.js 24 and enable npm dependency caching. |
| Setup Python | `actions/setup-python@v6` | Install Python 3.14 for backend tests, scripts, and packaging preparation. |
| Install Node dependencies | `npm ci` | Install JavaScript dependencies exactly from `package-lock.json`. |
| Install Python dependencies | `python -m pip install -r backend/requirements.txt` | Install backend dependencies required by FastAPI services, agent runtime, document processing, and tests. |
| Check Python syntax | `python -m compileall backend tools tests` | Compile Python files to detect syntax errors before test execution. |
| Check Node syntax | `tools/ci/check-node-syntax.ps1` | Validate JavaScript syntax in Electron, renderer, and test files. |
| Run tests | `npm test` | Run both backend and Electron test suites. |
| Install metrics tools | `python -m pip install lizard` | Install the tool used to compute cyclomatic complexity. |
| Generate metrics report | `tools/ci/generate-metrics-report.ps1` | Produce `metrics-report.txt` with LOC, source file count, dependencies, and complexity. |
| Upload metrics report | `actions/upload-artifact@v7` | Upload the generated metrics report as a workflow artifact. |
| Prepare bundled Python runtime | `tools/ci/prepare-windows-python.ps1` | Prepare the Python runtime bundled into the Windows application package. |
| Verify bundled Python | `tools/ci/verify-windows-python.ps1` | Check that the bundled Python runtime is usable. |
| Build Windows installer | `npm run package:win` | Build the Windows NSIS installer using `electron-builder`. |
| Report output sizes | `tools/ci/report-dist-output-sizes.ps1` | Print generated installer artifact sizes for inspection. |
| Resolve installer artifact paths | `tools/ci/resolve-installer-artifacts.ps1` | Locate the installer, blockmap, and metadata paths for upload. |
| Upload installer executable | `actions/upload-artifact@v7` | Upload the generated Windows installer executable. |
| Upload installer blockmap | `actions/upload-artifact@v7` | Upload the blockmap if it exists. |
| Upload installer metadata | `actions/upload-artifact@v7` | Upload installer metadata if it exists. |
| Publish GitHub Release | GitHub CLI through `tools/ci/publish-github-release.ps1` | Publish release artifacts automatically when the workflow is triggered by a version tag. |

### 3.2 Testing in the Pipeline

The workflow uses the `npm test` script defined in `package.json`:

```powershell
npm run test:backend && npm run test:electron
```

The backend test command is:

```powershell
python -m unittest discover -s tests -v
```

The Electron-side test command is:

```powershell
node --test tests/electron/*.test.js
```

Therefore, the CI test stage covers both the Python backend and the Electron/Node integration layer. Backend tests validate APIs, repositories, services, agent adapters, agent runtime behavior, Blackboard logic, todo logic, workspace tools, and SUSTech manual corpus behavior. Electron tests validate IPC, app paths, backend process management, configuration/workspace handling, external links, i18n, attachment staging, and packaging configuration.

### 3.3 Packaging and Release

The packaging step uses:

```powershell
npm run package:win
```

This command first builds the SUSTech manual corpus and then invokes `electron-builder`:

```powershell
npm run build:sustech-manual && electron-builder --win nsis --publish never
```

The generated Windows installer is uploaded as a GitHub Actions artifact. When the workflow is triggered by a Git tag such as `v0.3.2`, the final release step publishes the installer through GitHub Releases.

## 4. Snapshots provided

```text
Figure 1. GitHub Actions workflow configuration for building and releasing the Windows installer.
```

<img src="images/image1.png" alt="image-20260530232113695" style="zoom: 80%;" />

```text
Figure 2. Successful execution of the Build and Release GitHub Actions workflow.
```

<img src="images/image2.png" alt="image-20260530232218786" style="zoom:80%;" />

```text
Figure 3. CI job logs and uploaded artifacts produced by the successful pipeline run.
```



<img src="images/image3.png" alt="image-20260530232318895" style="zoom:80%;" />

## 5. Summary

The project contains 13,333 lines of source code across 76 source files, with an average cyclomatic complexity of 3.1 and 16 direct dependencies. Its CI/CD pipeline is implemented with GitHub Actions on Windows. The pipeline installs Node and Python dependencies, checks syntax, runs backend and Electron tests, generates a metrics report, prepares and verifies a bundled Python runtime, builds the Windows installer, uploads artifacts, and publishes a GitHub Release for version tags. This pipeline provides automated validation, metric reporting, packaging, and release support for the SUSTech Student Assistant project.
