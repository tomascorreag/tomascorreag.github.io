# optimize-assets.ps1
#
# PowerShell equivalent of optimize-assets.sh. Same behavior, same flags.
#
# Usage:
#   pwsh scripts/optimize-assets.ps1
#   pwsh scripts/optimize-assets.ps1 -AssetsDir src/assets -DryRun
#   pwsh scripts/optimize-assets.ps1 -NoFallbacks -NoAvif
#
# Requires ffmpeg on PATH.  Install:  winget install ffmpeg

[CmdletBinding()]
param(
    [string]$AssetsDir = "src/assets",
    [switch]$NoFallbacks,
    [switch]$NoAvif,
    # Pass -NoStripUnusedAlpha to leave source PNGs alone. Default behavior
    # strips alpha from PNGs whose alpha channel is fully opaque (modifies
    # source files in place, preserves bit depth). Idempotent on re-run.
    [switch]$NoStripUnusedAlpha,
    [switch]$DryRun,
    [switch]$Force,
    [int]$WebpQ = 82,
    [int]$AvifCrf = 30,
    [int]$Vp9Crf = 32,
    [int]$Mp4Crf = 23
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "ffmpeg not found on PATH. Install:  winget install ffmpeg"
    exit 1
}
$script:HaveFfprobe = [bool](Get-Command ffprobe -ErrorAction SilentlyContinue)
if (-not (Test-Path $AssetsDir -PathType Container)) {
    Write-Error "asset directory not found: $AssetsDir"
    exit 1
}

$script:ImgConverted = 0
$script:VidConverted = 0
$script:Skipped      = 0
$script:Failed       = 0

function Need-Update([string]$src, [string]$dst) {
    if ($Force) { return $true }
    if (-not (Test-Path $dst)) { return $true }
    return (Get-Item $src).LastWriteTime -gt (Get-Item $dst).LastWriteTime
}

function Run-Ff([string[]]$FfArgs) {
    if ($DryRun) {
        Write-Host "    [dry-run] ffmpeg $($FfArgs -join ' ')"
        return $true
    }
    # -nostdin: prevents ffmpeg from reading stdin (matches bash version; safe default).
    & ffmpeg -nostdin -y -loglevel error -hide_banner @FfArgs
    return ($LASTEXITCODE -eq 0)
}

# Run ffmpeg for an image encode. Clean pass first; on failure, retry once
# with error tolerance + metadata strip (handles PNGs with malformed EXIF).
# Only the retry drops metadata — clean files keep their EXIF/ICC intact.
# Read the source stream's pix_fmt via ffprobe. Empty string on failure.
function Get-PixFmt([string]$Src) {
    if (-not $script:HaveFfprobe) { return '' }
    $v = & ffprobe -v error -select_streams v:0 `
        -show_entries stream=pix_fmt -of csv=p=0 $Src 2>$null
    if (-not $v) { return '' }
    return $v.Trim()
}

# Whether a pix_fmt string carries an alpha plane. Contains 'a' (rgba, bgra,
# argb, ya8, yuva*, gbrap) or is pal8 (palettized, may have tRNS).
function Test-PixFmtHasAlpha([string]$PixFmt) {
    return ($PixFmt -match 'a' -or $PixFmt -eq 'pal8')
}

# Classify whether a source image uses transparency.
# Returns one of: 'transparent' | 'opaque' | 'unknown'
#   transparent = alpha channel present AND at least one non-opaque pixel
#   opaque      = no alpha channel, OR alpha channel is all-fully-opaque
#   unknown     = detection failed (ffprobe missing, decode error)
function Get-TransparencyClass([string]$Src) {
    if (-not $script:HaveFfprobe) { return 'unknown' }
    $pixFmt = Get-PixFmt $Src
    if (-not (Test-PixFmtHasAlpha $pixFmt)) { return 'opaque' }
    # Sample the alpha plane. alphaextract -> format=gray normalizes to 8-bit
    # so YMIN is always 0..255. signalstats+metadata=mode=print emits the stats
    # to stderr, which we capture via 2>&1.
    $ffOut = & ffmpeg -nostdin -hide_banner -loglevel info -i $Src `
        -vf "alphaextract,format=gray,signalstats,metadata=mode=print" `
        -f null - 2>&1
    $line = $ffOut | Select-String 'signalstats\.YMIN=' | Select-Object -First 1
    if (-not $line) { return 'unknown' }
    if ($line -match 'YMIN=(\d+)') {
        $ymin = [int]$Matches[1]
        if ($ymin -lt 255) { return 'transparent' } else { return 'opaque' }
    }
    return 'unknown'
}

# Strip the alpha channel from a PNG in place, preserving bit depth.
# 8-bit rgba -> rgb24, 16-bit rgba64* -> rgb48be. Atomic via temp+mv.
# Caller should only invoke when alpha is known-unused.
function Remove-PngAlpha([string]$Src) {
    $pixFmt = Get-PixFmt $Src
    $outFmt = if ($pixFmt -match '64') { 'rgb48be' } else { 'rgb24' }
    if ($DryRun) {
        Write-Host "    [dry-run] strip alpha: $Src ($pixFmt -> $outFmt)"
        return $true
    }
    $tmp = "$Src.stripalpha.tmp.png"
    & ffmpeg -nostdin -y -loglevel error -hide_banner -i $Src -pix_fmt $outFmt $tmp
    if ($LASTEXITCODE -eq 0) {
        Move-Item -Force -LiteralPath $tmp -Destination $Src
        return $true
    } else {
        if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp }
        return $false
    }
}

function Run-ImgFf([string]$Src, [string]$Dst, [string[]]$EncoderArgs) {
    $clean = @('-i', $Src) + $EncoderArgs + @($Dst)
    if (Run-Ff $clean) { return $true }

    Write-Host "    clean pass failed - retrying with -err_detect ignore_err + metadata strip" -ForegroundColor Yellow
    $retry = @('-err_detect', 'ignore_err', '-max_error_rate', '1.0',
               '-i', $Src, '-map_metadata', '-1') + $EncoderArgs + @($Dst)
    if (Run-Ff $retry) {
        Write-Host "    (recovered - metadata stripped on this file only)" -ForegroundColor Yellow
        return $true
    }
    Write-Host "    FAILED: $Src -> $Dst" -ForegroundColor Red
    $script:Failed++
    return $false
}

function Convert-Image([string]$src) {
    $base = [System.IO.Path]::ChangeExtension($src, $null).TrimEnd('.')
    $webp = "$base.webp"
    $avif = "$base.avif"
    $ext  = [System.IO.Path]::GetExtension($src).TrimStart('.').ToLower()

    # Classify once (ffmpeg decode is expensive and we need the answer twice:
    # for the alpha-strip decision and the AVIF-skip decision).
    $alphaClass = 'opaque'
    if ($ext -in 'png','jpg','jpeg') {
        $alphaClass = Get-TransparencyClass $src
    }

    # Strip fully-opaque alpha channels on PNG sources. Saves ~5-15% on disk
    # and removes the AVIF-skip penalty for PNGs that only had alpha out of
    # habit. Gated by -NoStripUnusedAlpha (default: strip). Modifies in place.
    if (-not $NoStripUnusedAlpha -and $ext -eq 'png' -and $alphaClass -eq 'opaque') {
        $srcPixFmt = Get-PixFmt $src
        if (Test-PixFmtHasAlpha $srcPixFmt) {
            Write-Host "  ALPHA  $src  (unused alpha - stripping)"
            if (-not (Remove-PngAlpha $src)) {
                Write-Host "    FAILED to strip alpha: $src" -ForegroundColor Red
                $script:Failed++
            }
        }
    }

    if ($ext -ne 'webp') {
        if (Need-Update $src $webp) {
            Write-Host "  IMG  $src  ->  $(Split-Path $webp -Leaf)"
            $encoderArgs = @('-quality', "$WebpQ", '-compression_level', '6')
            if (Run-ImgFf $src $webp $encoderArgs) { $script:ImgConverted++ }
        } else { $script:Skipped++ }
    }

    if (-not $NoAvif -and $ext -ne 'avif') {
        # Skip AVIF when source has real transparency. ffmpeg+libaom silently
        # drops alpha and emits a single-stream yuv420p AVIF, producing a black
        # background. WebP handles alpha correctly and is the <picture> fallback.
        # Unknown class (detection failed) also skips - safer than risking a
        # black-bg output. Proper fix would be avifenc (libavif).
        if ($alphaClass -eq 'transparent') {
            Write-Host "  IMG  $src  ->  (skipped AVIF: source has transparency)"
            $script:Skipped++
        } elseif ($alphaClass -eq 'unknown') {
            Write-Host "  IMG  $src  ->  (skipped AVIF: alpha detection failed)"
            $script:Skipped++
        } elseif (Need-Update $src $avif) {
            Write-Host "  IMG  $src  ->  $(Split-Path $avif -Leaf)"
            $encoderArgs = @(
                '-c:v', 'libaom-av1', '-crf', "$AvifCrf", '-b:v', '0',
                '-still-picture', '1', '-cpu-used', '6',
                '-pix_fmt', 'yuv420p'
            )
            if (Run-ImgFf $src $avif $encoderArgs) { $script:ImgConverted++ }
        } else { $script:Skipped++ }
    }
}

function Convert-Video([string]$src) {
    $base = [System.IO.Path]::ChangeExtension($src, $null).TrimEnd('.')
    $webm = "$base.webm"
    $mp4  = "$base.mp4"
    $ext  = [System.IO.Path]::GetExtension($src).TrimStart('.').ToLower()

    if ($ext -ne 'webm') {
        if (Need-Update $src $webm) {
            Write-Host "  VID  $src  ->  $(Split-Path $webm -Leaf)"
            $ffArgs = @(
                '-i', $src,
                '-c:v', 'libvpx-vp9', '-crf', "$Vp9Crf", '-b:v', '0',
                '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
                '-c:a', 'libopus', '-b:a', '96k',
                $webm
            )
            if (Run-Ff $ffArgs) {
                $script:VidConverted++
            } else {
                Write-Host "    FAILED: $src -> $webm" -ForegroundColor Red
                $script:Failed++
            }
        } else { $script:Skipped++ }
    }

    if (-not $NoFallbacks -and $ext -ne 'mp4') {
        if (Need-Update $src $mp4) {
            Write-Host "  VID  $src  ->  $(Split-Path $mp4 -Leaf)"
            $ffArgs = @(
                '-i', $src,
                '-c:v', 'libx264', '-crf', "$Mp4Crf", '-preset', 'medium',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                '-c:a', 'aac', '-b:a', '128k',
                $mp4
            )
            if (Run-Ff $ffArgs) {
                $script:VidConverted++
            } else {
                Write-Host "    FAILED: $src -> $mp4" -ForegroundColor Red
                $script:Failed++
            }
        } else { $script:Skipped++ }
    }
}

Write-Host "Scanning: $AssetsDir"
Write-Host "  fallbacks=$(-not $NoFallbacks)  avif=$(-not $NoAvif)  strip_alpha=$(-not $NoStripUnusedAlpha)  dry_run=$DryRun  force=$Force"
Write-Host ""

# For a video pair (foo.mp4 + foo.webm), returns $true if $File is the "source"
# (the older of the pair; assumption: we generated the newer one on a prior run).
function Test-VideoSource([string]$File) {
    $base = [System.IO.Path]::ChangeExtension($File, $null).TrimEnd('.')
    $mp4  = "$base.mp4"
    $webm = "$base.webm"
    if (-not (Test-Path $mp4) -or -not (Test-Path $webm)) { return $true }
    $mp4Time  = (Get-Item $mp4).LastWriteTime
    $webmTime = (Get-Item $webm).LastWriteTime
    if ($mp4Time -lt $webmTime) {
        return ($File -eq $mp4)
    } else {
        return ($File -eq $webm)
    }
}

Get-ChildItem -Path $AssetsDir -Recurse -File | ForEach-Object {
    $ext = $_.Extension.TrimStart('.').ToLower()
    switch -Regex ($ext) {
        # Image sources only: raster originals. webp/avif are outputs, never inputs.
        '^(png|jpg|jpeg)$'            { Convert-Image  $_.FullName }
        # Video sources: resolve mp4/webm pair via mtime to find the original.
        '^(mp4|mov|m4v|webm)$'        {
            if (Test-VideoSource $_.FullName) { Convert-Video $_.FullName }
        }
    }
}

Write-Host ""
Write-Host "Done."
Write-Host "  images converted: $script:ImgConverted"
Write-Host "  videos converted: $script:VidConverted"
Write-Host "  up-to-date:       $script:Skipped"
Write-Host "  failed:           $script:Failed"

if ($script:Failed -gt 0) { exit 1 } else { exit 0 }
