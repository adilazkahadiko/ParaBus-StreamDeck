# Original geometry shared with imgs/plugin.svg; no third-party artwork.
Add-Type -AssemblyName System.Drawing
$taskImageDirectory = Join-Path $PSScriptRoot '../io.github.adilazkahadiko.parabus.sdPlugin/imgs'
foreach ($taskScale in @(1, 2)) {
    $taskBitmap = New-Object System.Drawing.Bitmap (144 * $taskScale), (144 * $taskScale)
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    $taskGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $taskGraphics.ScaleTransform($taskScale, $taskScale)
    $taskGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#122e32'))
    $taskLine = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e7f6f1')), 6
    $taskAccent = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#79e2ca')), 12
    foreach ($taskX in @(35, 72, 109)) { $taskGraphics.DrawLine($taskLine, $taskX, 28, $taskX, 90) }
    $taskGraphics.DrawLine($taskAccent, 25, 47, 45, 47)
    $taskGraphics.DrawLine($taskAccent, 62, 72, 82, 72)
    $taskGraphics.DrawLine($taskAccent, 99, 38, 119, 38)
    $taskSuffix = if ($taskScale -eq 2) { '@2x' } else { '' }
    $taskBitmap.Save((Join-Path $taskImageDirectory "plugin$taskSuffix.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $taskAccent.Dispose(); $taskLine.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
}
