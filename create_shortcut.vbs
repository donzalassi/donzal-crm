Set oWS = WScript.CreateObject("WScript.Shell")
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetAbsolutePathName(".")

sLinkFile = oWS.SpecialFolders("Desktop") & "\단골비서.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = currentDir & "\단골비서실행.bat"
oLink.WorkingDirectory = currentDir
oLink.IconLocation = "shell32.dll, 43"
oLink.Save
