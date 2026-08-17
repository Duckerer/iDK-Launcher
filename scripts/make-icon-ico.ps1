Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root "build\icon.png"
$outPath = Join-Path $root "build\icon.ico"

$src = [System.Drawing.Image]::FromFile($srcPath)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += , $ms.ToArray()
  $bmp.Dispose()
  $ms.Dispose()
}
$src.Dispose()

$count = $images.Count
$offset = 6 + 16 * $count
$header = New-Object byte[] ($offset)
[BitConverter]::GetBytes([uint16]0).CopyTo($header, 0)
[BitConverter]::GetBytes([uint16]1).CopyTo($header, 2)
[BitConverter]::GetBytes([uint16]$count).CopyTo($header, 4)

for ($i = 0; $i -lt $count; $i++) {
  $s = $sizes[$i]
  $e = 6 + 16 * $i
  $w = if ($s -ge 256) { 0 } else { $s }
  $header[$e] = $w
  $header[$e + 1] = $w
  $header[$e + 2] = 0
  $header[$e + 3] = 0
  [BitConverter]::GetBytes([uint16]1).CopyTo($header, $e + 4)
  [BitConverter]::GetBytes([uint16]32).CopyTo($header, $e + 6)
  [BitConverter]::GetBytes([uint32]$images[$i].Length).CopyTo($header, $e + 8)
  [BitConverter]::GetBytes([uint32]$offset).CopyTo($header, $e + 12)
  $offset += $images[$i].Length
}

$fs = [System.IO.File]::Create($outPath)
$fs.Write($header, 0, $header.Length)
foreach ($img in $images) { $fs.Write($img, 0, $img.Length) }
$fs.Dispose()

Write-Output "wrote $outPath ($count sizes)"
