Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir

' If Koda.exe exists, launch it directly (native GUI app, zero console window)
kodaExe = currentDir & "\Koda.exe"
If fso.FileExists(kodaExe) Then
    WshShell.Run """" & kodaExe & """", 1, False
    WScript.Quit
End If

' Fallback: Check if port 3000 is open, if not start node server hidden
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.open "GET", "http://127.0.0.1:3000/", False
http.setTimeouts 400, 400, 400, 400
http.send
serverRunning = (http.status = 200)
On Error Goto 0

If Not serverRunning Then
    WshShell.Run "node server.js", 0, False
    WScript.Sleep 800
End If

' Launch standalone Desktop App window without any console
edge1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edge2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
chrome1 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chrome2 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

If fso.FileExists(edge1) Then
    WshShell.Run """" & edge1 & """ --app=""http://localhost:3000"" --app-id=""koda-frontier-ai"" --window-size=1360,860", 1, False
ElseIf fso.FileExists(edge2) Then
    WshShell.Run """" & edge2 & """ --app=""http://localhost:3000"" --app-id=""koda-frontier-ai"" --window-size=1360,860", 1, False
ElseIf fso.FileExists(chrome1) Then
    WshShell.Run """" & chrome1 & """ --app=""http://localhost:3000"" --window-size=1360,860", 1, False
ElseIf fso.FileExists(chrome2) Then
    WshShell.Run """" & chrome2 & """ --app=""http://localhost:3000"" --window-size=1360,860", 1, False
Else
    WshShell.Run "http://localhost:3000", 1, False
End If
