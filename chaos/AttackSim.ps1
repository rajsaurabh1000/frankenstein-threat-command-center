# Cyber attack simulation — writes to data/live_stream.log
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $RepoRoot "data"
$LogPath = Join-Path $DataDir "live_stream.log"
$StopPath = Join-Path $DataDir ".attack_stop"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Host "Starting Cyber Attack Simulation..." -ForegroundColor Red
Write-Host "Log: $LogPath" -ForegroundColor DarkGray

while ($true) {
    if (Test-Path $StopPath) {
        Write-Host "Stop flag detected — attack simulation halted." -ForegroundColor Green
        exit 0
    }

    $attackTypes = @("Brute Force", "SQL Injection", "Port Scan", "Credential Stuffing")
    $randomAttack = $attackTypes | Get-Random
    $severity = Get-Random -Minimum 1 -Maximum 10

    $logEntry = @{
        time   = Get-Date -Format "HH:mm:ss"
        ts     = (Get-Date).ToUniversalTime().ToString("o")  # full ISO-8601 UTC; bridge prefers it
        type   = $randomAttack
        severity = $severity
        origin = "103.25.12.$(Get-Random -Minimum 1 -Maximum 255)"
    }

    $json = $logEntry | ConvertTo-Json -Compress
    Add-Content -Path $LogPath -Value $json -Encoding utf8

    Write-Host "Generated Threat: $randomAttack (Severity: $severity)" -ForegroundColor Yellow
    Start-Sleep -Seconds (Get-Random -Minimum 1 -Maximum 3)
}
