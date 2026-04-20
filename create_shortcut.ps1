$CurrentDir = Get-Location
$ShortcutPath = "$HOME\Desktop\단골비서.lnk"
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$CurrentDir\단골비서실행.bat"
$Shortcut.WorkingDirectory = "$CurrentDir"
$Shortcut.IconLocation = "shell32.dll,43"
$Shortcut.Save()
