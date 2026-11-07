# Shared steps for dev.ps1 / prod.ps1 (dot-sourced).

function Start-OllamaIfInstalled {
  try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null }
  catch {
    $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $ollama) { Start-Process -WindowStyle Hidden $ollama "serve"; Write-Host "started ollama" }
    else { Write-Warning "Ollama not found - LLM answers fall back to extractive quotes (install from https://ollama.com)" }
  }
}

# Creates backend/.venv on first run and returns the venv's python.exe
function Initialize-Backend([string]$root) {
  $be = Join-Path $root "backend"
  $py = "$be\.venv\Scripts\python.exe"
  if (-not (Test-Path $py)) {
    python -m venv "$be\.venv"
    & $py -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    & $py -m pip install -r "$be\requirements.txt"
  }
  return $py
}

function Initialize-Frontend([string]$root) {
  $fe = Join-Path $root "frontend"
  if (-not (Test-Path "$fe\node_modules")) { Push-Location $fe; npm install; Pop-Location }
}
