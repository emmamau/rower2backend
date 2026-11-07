Add-Type -AssemblyName System.Drawing

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    Write-Error "Chrome executable not found at $chromePath"
    exit 1
}

$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path "$toolsDir\..\..").Path
$storeDir = Join-Path $repoRoot "garmin\resources\store"
$drawablesDir = Join-Path $repoRoot "garmin\resources\drawables\images"
$frontendPublicDir = Join-Path $repoRoot "frontend\public"
$frontendDistDir = Join-Path $repoRoot "frontend\dist\frontend\browser"

Write-Host "Repo root: $repoRoot"
Write-Host "Store dir: $storeDir"

function Render-Html([string]$htmlFile, [string]$outFile, [int]$width, [int]$height, [bool]$transparent = $false) {
    Write-Host "Rendering $htmlFile -> $outFile ($($width)x$($height))..."
    $args = @(
        "--headless=new",
        "--disable-gpu",
        "--force-device-scale-factor=1",
        "--screenshot=`"$outFile`"",
        "--window-size=$width,$height"
    )
    if ($transparent) {
        $args += "--default-background-color=00000000"
    }
    $args += "`"$htmlFile`""

    $p = Start-Process -FilePath $chromePath -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -or -not (Test-Path $outFile)) {
        Write-Error "Failed to render $htmlFile"
    }
}

function Convert-PngToJpg([string]$srcPng, [string]$dstJpg, [int]$quality = 95) {
    Write-Host "Converting $srcPng -> $dstJpg (JPEG quality $quality)..."
    $img = [System.Drawing.Image]::FromFile((Resolve-Path $srcPng))
    $bmp = [System.Drawing.Bitmap]::new($img.Width, $img.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(6, 9, 19))
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
    $g.Dispose()
    $img.Dispose()

    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    $bmp.Save($dstJpg, $codec, $encoderParams)
    $bmp.Dispose()
    $encoderParams.Dispose()
}

$iconHtml = Join-Path $toolsDir "icon.html"
$heroHtml = Join-Path $toolsDir "banner_hero.html"
$dynamicHtml = Join-Path $toolsDir "banner_dynamic.html"
$launcherHtml = Join-Path $toolsDir "launcher.html"

# 1. Render Store Icon 500x500
$tmpIconPng = Join-Path $toolsDir "tmp_icon_500x500.png"
Render-Html $iconHtml $tmpIconPng 500 500 $true
Copy-Item $tmpIconPng (Join-Path $storeDir "store_icon_500x500.png") -Force
Convert-PngToJpg $tmpIconPng (Join-Path $storeDir "store_icon_500x500.jpg") 95

# 2. Render Hero Banner 1024x500 & 1440x720
$tmpHero1024Png = Join-Path $toolsDir "tmp_hero_1024x500.png"
Render-Html $heroHtml $tmpHero1024Png 1024 500 $false
Convert-PngToJpg $tmpHero1024Png (Join-Path $storeDir "store_banner_1024x500.jpg") 95

$tmpHero1440Png = Join-Path $toolsDir "tmp_hero_1440x720.png"
Render-Html $heroHtml $tmpHero1440Png 1440 720 $false
Convert-PngToJpg $tmpHero1440Png (Join-Path $storeDir "store_banner_1440x720.jpg") 95

# 3. Render Dynamic Banner 1024x500 & 1440x720
$tmpDyn1024Png = Join-Path $toolsDir "tmp_dyn_1024x500.png"
Render-Html $dynamicHtml $tmpDyn1024Png 1024 500 $false
Convert-PngToJpg $tmpDyn1024Png (Join-Path $storeDir "store_banner_dynamic_1024x500.jpg") 95

$tmpDyn1440Png = Join-Path $toolsDir "tmp_dyn_1440x720.png"
Render-Html $dynamicHtml $tmpDyn1440Png 1440 720 $false
Convert-PngToJpg $tmpDyn1440Png (Join-Path $storeDir "store_banner_dynamic_1440x720.jpg") 95

# 4. Render Watch Launcher Icons & Web Icons
$launcherSizes = @(40, 60, 65, 70)
foreach ($size in $launcherSizes) {
    $outPng = Join-Path $drawablesDir "launcher_icon_$size.png"
    Render-Html $launcherHtml $outPng $size $size $true
}
# Default 40x40 launcher_icon.png
Copy-Item (Join-Path $drawablesDir "launcher_icon_40.png") (Join-Path $drawablesDir "launcher_icon.png") -Force

# Web icons (kayak-icon.png is 70x70)
if (Test-Path $frontendPublicDir) {
    Copy-Item (Join-Path $drawablesDir "launcher_icon_70.png") (Join-Path $frontendPublicDir "kayak-icon.png") -Force
}
if (Test-Path $frontendDistDir) {
    Copy-Item (Join-Path $drawablesDir "launcher_icon_70.png") (Join-Path $frontendDistDir "kayak-icon.png") -Force
}

# Clean temporary PNG files
Remove-Item -Path "$toolsDir\tmp_*.png" -Force -ErrorAction SilentlyContinue

Write-Host "All Garmin store assets and launcher icons successfully generated!"
