# Rebuild the Android launcher artwork from the exact Eon desktop icon.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\generate-launcher-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourcePath = Join-Path $repoRoot 'app-icon.png'
$resRoot = Join-Path $repoRoot 'mobil\app\src\main\res'
$source = [System.Drawing.Bitmap]::new($sourcePath)

try {
    if ($source.Width -ne $source.Height) {
        throw "Expected a square desktop icon: $sourcePath"
    }

    function Save-EonIcon {
        param(
            [string] $RelativePath,
            [int] $Size,
            [double] $ArtworkScale,
            [bool] $TransparentArtwork
        )

        $destination = Join-Path $resRoot $RelativePath
        $directory = Split-Path $destination -Parent
        New-Item -ItemType Directory -Force -Path $directory | Out-Null

        $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Black)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

                $edge = [int][Math]::Round($Size * $ArtworkScale)
                $inset = [int][Math]::Floor(($Size - $edge) / 2)
                $bounds = [System.Drawing.Rectangle]::new($inset, $inset, $edge, $edge)
                $graphics.DrawImage($source, $bounds)
            }
            finally {
                $graphics.Dispose()
            }

            if ($TransparentArtwork) {
                # Desktop source is white artwork on black. Preserve the exact
                # antialiasing by moving luminance into alpha for adaptive icons.
                for ($y = 0; $y -lt $Size; $y++) {
                    for ($x = 0; $x -lt $Size; $x++) {
                        $pixel = $bitmap.GetPixel($x, $y)
                        $alpha = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
                        $bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, 255, 255, 255))
                    }
                }
            }

            $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output "Created $RelativePath ($Size x $Size)"
        }
        finally {
            $bitmap.Dispose()
        }
    }

    # The foreground stays inside Android's central safe area even when the
    # launcher applies a round, squircle, or other adaptive icon mask.
    Save-EonIcon -RelativePath 'drawable-nodpi\eon_launcher_foreground.png' -Size 432 -ArtworkScale 0.625 -TransparentArtwork $true

    # Bitmap fallbacks preserve the same black-and-white identity on launchers
    # that request density-specific legacy icons.
    $densities = [ordered]@{
        'mdpi' = 48
        'hdpi' = 72
        'xhdpi' = 96
        'xxhdpi' = 144
        'xxxhdpi' = 192
    }
    foreach ($density in $densities.Keys) {
        Save-EonIcon -RelativePath "mipmap-$density\ic_launcher.png" -Size $densities[$density] -ArtworkScale 0.85 -TransparentArtwork $false
    }
}
finally {
    $source.Dispose()
}
