# Start both agents in the background, wait for their CLIENT to be
# ready, write PID files. Windows PowerShell 5.1+.
#
#     .\start-all.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $Here "..\..")

$PortA = 3000
$PortB = 3001
$ReadyTimeoutSec = 180

# ---- sanity -----------------------------------------------------

foreach ($f in "env.a.example", "env.b.example") {
    if (-not (Test-Path (Join-Path $Here $f))) {
        Write-Error "Missing $f"
        exit 1
    }
}

if (-not (Test-Path (Join-Path $Here ".env.a"))) {
    Write-Host "-> Creating .env.a from env.a.example"
    Copy-Item (Join-Path $Here "env.a.example") (Join-Path $Here ".env.a")
}
if (-not (Test-Path (Join-Path $Here ".env.b"))) {
    Write-Host "-> Creating .env.b from env.b.example"
    Copy-Item (Join-Path $Here "env.b.example") (Join-Path $Here ".env.b")
}

if (-not (Test-Path (Join-Path $Here "shared-state.json"))) {
    Write-Error "shared-state.json is missing. Run cookies-to-state.py first."
    exit 1
}

function New-ApiKey($label) {
    $suffix = -join ((1..16) | ForEach-Object { "{0:x}" -f (Get-Random -Max 16) })
    "deepseek_agent_${label}_$suffix"
}

foreach ($pair in @(@(".api-key-a", "a"), @(".api-key-b", "b"))) {
    $path = Join-Path $Here $pair[0]
    if (-not (Test-Path $path)) {
        Write-Host "-> Generating $($pair[0])"
        New-ApiKey $pair[1] | Out-File -FilePath $path -Encoding ascii -NoNewline
    }
}

# ---- helper: load env file -------------------------------------
#
# Regex-based parser. Tolerates markdown code fences, CRLF, and
# comment lines with shell metacharacters. Code fences are skipped
# because they do not match the KEY=VALUE pattern.

function Load-Env($path) {
    Get-Content $path | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim())
        }
    }
}

# ---- helper: wait for the CLIENT to be ready -------------------
#
# /health only checks that the HTTP server is listening. The DeepSeek
# client is ready several seconds later, after Chromium launches and
# the selector check passes. Poll /v1/context/status instead:
#   200 → ready
#   401 → wrong key
#   503 → still initialising

function Wait-Ready($port, $keyfile, $label) {
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSec)
    $key = (Get-Content $keyfile -Raw).Trim()

    Write-Host -NoNewline "-> Waiting for $label to be ready (http://localhost:$port)"
    $lastCode = ""

    while ((Get-Date) -lt $deadline) {
        $lastCode = try {
            (Invoke-WebRequest `
                -Uri "http://localhost:$port/v1/context/status" `
                -Headers @{ "Authorization" = "Bearer $key" } `
                -UseBasicParsing -TimeoutSec 5).StatusCode
        } catch [System.Net.WebException] {
            if ($_.Exception.Response) {
                [int]$_.Exception.Response.StatusCode
            } else { 0 }
        } catch { 0 }

        if ($lastCode -eq 200) {
            Write-Host " OK"
            return $true
        }
        if ($lastCode -eq 401) {
            Write-Host " FAIL"
            Write-Host "  $label rejected its API key — check $keyfile"
            return $false
        }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 1
    }

    Write-Host " FAIL"
    Write-Host "  $label did not become ready within $ReadyTimeoutSec s (last code: $lastCode)"
    return $false
}

# ---- start agent A ---------------------------------------------

Write-Host "-> Starting agent A (PORT=$PortA)..."
Push-Location $Here
try {
    Load-Env (Join-Path $Here ".env.a")
    $env:PORT = "$PortA"

    $logA = Join-Path $Here "agent-a.log"
    $procA = Start-Process -FilePath "node" `
        -ArgumentList (Join-Path $ProjectRoot "server.js") `
        -RedirectStandardOutput $logA `
        -RedirectStandardError "$logA.err" `
        -PassThru -WindowStyle Hidden
    $procA.Id | Out-File (Join-Path $Here "agent-a.pid") -Encoding ascii
} finally {
    Pop-Location
}

Start-Sleep -Seconds 3

# ---- start agent B ---------------------------------------------

Write-Host "-> Starting agent B (PORT=$PortB)..."
Push-Location $Here
try {
    Load-Env (Join-Path $Here ".env.b")
    $env:PORT = "$PortB"

    $logB = Join-Path $Here "agent-b.log"
    $procB = Start-Process -FilePath "node" `
        -ArgumentList (Join-Path $ProjectRoot "server.js") `
        -RedirectStandardOutput $logB `
        -RedirectStandardError "$logB.err" `
        -PassThru -WindowStyle Hidden
    $procB.Id | Out-File (Join-Path $Here "agent-b.pid") -Encoding ascii
} finally {
    Pop-Location
}

# ---- wait for both ---------------------------------------------

if (-not (Wait-Ready $PortA (Join-Path $Here ".api-key-a") "agent A")) {
    Write-Host "  Last 30 lines of agent-a.log:"
    Get-Content (Join-Path $Here "agent-a.log") -Tail 30 -ErrorAction SilentlyContinue
    exit 1
}

if (-not (Wait-Ready $PortB (Join-Path $Here ".api-key-b") "agent B")) {
    Write-Host "  Last 30 lines of agent-b.log:"
    Get-Content (Join-Path $Here "agent-b.log") -Tail 30 -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
Write-Host "Both agents are running."
Write-Host "  A: http://localhost:$PortA"
Write-Host "  B: http://localhost:$PortB"
Write-Host "Logs: agent-a.log, agent-b.log"
Write-Host "Stop: .\stop-all.ps1"