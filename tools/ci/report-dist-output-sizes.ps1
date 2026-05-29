$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Get-ChildItem "dist" -File | Select-Object Name, @{
  Name = "SizeMB"
  Expression = { [math]::Round($_.Length / 1MB, 1) }
} | Format-Table -AutoSize
