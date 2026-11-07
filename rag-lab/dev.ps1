# RAG Lab - development (Windows). API with auto-reload on :8765, Vite UI with hot reload on :5173.
#   ./dev.ps1            then open http://127.0.0.1:5173
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $root "scripts\common.ps1")

Start-OllamaIfInstalled
$py = Initialize-Backend $root
Initialize-Frontend $root

$env:WATCHFILES_FORCE_POLLING = "true"   # reliable --reload on Windows
$api = Start-Process -PassThru -NoNewWindow -WorkingDirectory (Join-Path $root "backend") $py `
  "-m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload --reload-dir app --timeout-graceful-shutdown 3"

Write-Host "`n  RAG Lab (dev) ->  http://127.0.0.1:5173`n"
try { Push-Location (Join-Path $root "frontend"); npx vite --port 5173 --host 127.0.0.1 }
finally { Pop-Location; Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
