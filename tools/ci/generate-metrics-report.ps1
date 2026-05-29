$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Count-ObjectProperties($Object) {
  if ($null -eq $Object) {
    return 0
  }
  return @($Object.PSObject.Properties).Count
}

$tempRoot = $env:RUNNER_TEMP
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  $tempRoot = $env:TEMP
}
if ([string]::IsNullOrWhiteSpace($tempRoot)) {
  $tempRoot = [System.IO.Path]::GetTempPath()
}
$lizardReportPath = Join-Path $tempRoot "project-lizard-report.txt"
$lizardWarningsPath = Join-Path $tempRoot "project-lizard-warnings.txt"

$sourceFiles = Get-ChildItem -Recurse -File -Path backend,src,tools -Include *.py,*.js,*.mjs,*.html,*.css
$sourceFileCount = $sourceFiles.Count
$linesOfCode = ($sourceFiles | Get-Content | Measure-Object -Line).Lines

$packageJson = Get-Content package.json -Raw | ConvertFrom-Json
$nodeDependencies = Count-ObjectProperties $packageJson.dependencies
$nodeDevDependencies = Count-ObjectProperties $packageJson.devDependencies
$pythonDependencies = (Get-Content backend/requirements.txt | Where-Object {
  $_.Trim() -and -not $_.Trim().StartsWith("#")
}).Count
$dependencyCount = $nodeDependencies + $nodeDevDependencies + $pythonDependencies

python -m lizard backend src tools -l python -l javascript -i 999 | Out-File -FilePath $lizardReportPath -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

python -m lizard backend src tools -l python -l javascript --warnings_only -i 999 | Out-File -FilePath $lizardWarningsPath -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$lizardSummary = Get-Content $lizardReportPath | Select-String "^\s*\d+\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+\s+\d+\s+" | Select-Object -Last 1
if (-not $lizardSummary) {
  throw "Failed to parse lizard summary."
}

$parts = ($lizardSummary.Line.Trim() -split "\s+")
$avgCcn = [double]$parts[2]
$functionCount = [int]$parts[4]
$complexityWarningCount = [int]$parts[5]
$fullLizardReport = Get-Content $lizardReportPath -Raw
$lizardWarnings = Get-Content $lizardWarningsPath -Raw

@"
Project Metrics Report
======================

Scope
-----
Included directories: backend/, src/, tools/
Excluded directories: tests/, vendor/, node_modules/
File types: .py, .js, .mjs, .html, .css

Summary
-------
Lines of Code: $linesOfCode
Number of source files: $sourceFileCount
Cyclomatic complexity: Avg CCN $avgCcn
Number of dependencies: $dependencyCount

Dependency Breakdown
--------------------
Node runtime dependencies: $nodeDependencies
Node dev dependencies: $nodeDevDependencies
Python dependencies: $pythonDependencies
Total direct dependencies: $dependencyCount

Cyclomatic Complexity Details
-----------------------------
Tool: lizard
Functions analyzed: $functionCount
High-complexity warnings: $complexityWarningCount

Commands
--------
Source files:
Get-ChildItem -Recurse -File -Path backend,src,tools -Include *.py,*.js,*.mjs,*.html,*.css

Lines of Code:
Get-ChildItem -Recurse -File -Path backend,src,tools -Include *.py,*.js,*.mjs,*.html,*.css | Get-Content | Measure-Object -Line

Cyclomatic complexity:
python -m lizard backend src tools -l python -l javascript

Full Lizard Report
------------------
$fullLizardReport

Lizard Warnings
---------------
$lizardWarnings
"@ | Out-File metrics-report.txt -Encoding utf8
