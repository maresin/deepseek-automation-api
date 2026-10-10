# Stop both agents. Prefers the PID files written by start-all.ps1;
# falls back to killing whatever is listening on the two ports.

[CmdletBinding()]
param()

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$stopped = $false

foreach ($pair in @(@("agent-a.pid", "agent A"), @("agent-b.pid", "agent B"))) {
    $pidfile = Join-Path $Here $pair[0]
    $label = $pair[1]

    if (-not (Test-Path $pidfile)) { continue }

    $pid = (Get-Content $pidfile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($pid) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "-> Stopping $label (PID $pid)"
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            $stopped = $true
        }
    }
    Remove-Item $pidfile -ErrorAction SilentlyContinue
}

# Fallback: anything still on 3000/3001?
foreach ($port in 3000, 3001) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen `
            -ErrorAction SilentlyContinue
        if ($conn) {
            foreach ($pid in ($conn | Select-Object -ExpandProperty OwningProcess -Unique)) {
                Write-Host "-> Killing process on port $port (PID $pid)"
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                $stopped = $true
            }
        }
    } catch { }
}

if ($stopped) {
    Write-Host "Done."
} else {
    Write-Host "Nothing to stop."
}