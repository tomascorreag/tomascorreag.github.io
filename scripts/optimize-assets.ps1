# optimize-assets.ps1 — thin forwarder to optimize-assets.sh
#
# The bash script is the single source of truth: it gained source resizing,
# responsive width tiers, bloated-master video handling, the webm-inversion
# guard, and the asset-dims.json manifest. Maintaining a behavioral twin in
# PowerShell guaranteed drift (and it had already drifted — the old twin
# would have re-encoded webms the optimizer deliberately deleted), so this
# stub just runs the real thing through Git Bash — the same shell npm uses
# on Windows (see .npmrc script-shell).
#
# Usage:
#   pwsh scripts/optimize-assets.ps1                 # defaults to src/assets
#   pwsh scripts/optimize-assets.ps1 path/to/dir
#   $env:DRY_RUN=1; pwsh scripts/optimize-assets.ps1 # env knobs pass through

$ErrorActionPreference = 'Stop'

$bash = @(
    "$env:ProgramFiles\Git\bin\bash.exe",
    "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $bash) {
    # Fall back to whatever bash is on PATH (beware: WSL bash has its own
    # PATH and usually can't see a Windows-installed ffmpeg).
    $cmd = Get-Command bash -ErrorAction SilentlyContinue
    if ($cmd) { $bash = $cmd.Source }
}

if (-not $bash) {
    Write-Error "Git Bash not found. Install Git for Windows or run: bash scripts/optimize-assets.sh"
    exit 1
}

& $bash "$PSScriptRoot/optimize-assets.sh" @args
exit $LASTEXITCODE
