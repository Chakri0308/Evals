# RAG Lab - production (Windows). One process serves the built UI and the API on one port, no auto-reload.
#   ./prod.ps1                  build the UI if needed, then serve on http://127.0.0.1:8765
#   ./prod.ps1 -Rebuild         force a fresh UI build
#   $env:RAG_LAB_HOST="0.0.0.0"; ./prod.ps1   listen on all interfaces
param([switch]$Rebuild)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "scripts\common.ps1")

Start-OllamaIfInstalled
$py = Initialize-Backend $root
Initialize-Frontend $root
$fe = Join-Path $root "frontend"
if ($Rebuild -or -not (Test-Path "$fe\dist\index.html")) { Push-Location $fe; npm run build; Pop-Location }

$hostName = if ($env:RAG_LAB_HOST) { $env:RAG_LAB_HOST } else { "127.0.0.1" }
$port = if ($env:RAG_LAB_PORT) { $env:RAG_LAB_PORT } else { "8765" }
Write-Host "`n  RAG Lab ->  http://${hostName}:${port}`n"
Push-Location (Join-Path $root "backend")
try { & $py -m uvicorn app.main:app --host $hostName --port $port --proxy-headers --timeout-graceful-shutdown 10 }
finally { Pop-Location }
