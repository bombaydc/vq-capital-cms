# Starts the CMS in dev mode with Laragon's Node 24 (instead of whatever is on PATH).
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File scripts\dev-laragon.ps1
$ErrorActionPreference = 'Stop'
$nodeDir = 'C:\laragon\bin\nodejs\node-v24'
if (-not (Test-Path "$nodeDir\node.exe")) { throw "Node 24 not found at $nodeDir (Laragon → Tools → Quick add → nodejs)" }
$env:PATH = "$nodeDir;$env:PATH"
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "Using Node $(node -v), npm $(npm -v)" -ForegroundColor Cyan
npm run develop
