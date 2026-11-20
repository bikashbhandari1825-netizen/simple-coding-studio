$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$log = Join-Path $here 'fix-icon.log'
Start-Transcript -Path $log -Force | Out-Null
$r = Join-Path $env:LOCALAPPDATA 'SimpleCodingStudio'
$setup = Join-Path $root 'installer\SimpleCodingStudio-Setup.exe'
$ico = Join-Path $root 'installer\icon.ico'
"REAL LOCALAPPDATA = $env:LOCALAPPDATA"
"Setup exists: $(Test-Path $setup)  Icon exists: $(Test-Path $ico)"
Get-Process SimpleCodingStudio -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path "$r\Update.exe") { Start-Process "$r\Update.exe" '--uninstall -s' -Wait; Start-Sleep 5 }
Start-Process $setup
$exe = $null
for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; $f = Get-ChildItem "$r\app-*\SimpleCodingStudio.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1; if ($f) { $exe = $f.FullName; break } }
"Installed exe: $exe"
Start-Sleep 8
Get-Process SimpleCodingStudio -ErrorAction SilentlyContinue | Stop-Process -Force
Copy-Item $ico "$r\app.ico" -Force
Copy-Item $ico "$r\scs-logo.ico" -Force
$sh = New-Object -ComObject WScript.Shell
$sm = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Get-ChildItem $sm -Recurse -Filter '*Simple Coding*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $sm -Directory -Filter 'Bikash' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$desk = [Environment]::GetFolderPath('Desktop')
foreach ($p in @("$sm\Simple Coding Studio.lnk", "$desk\Simple Coding Studio.lnk")) {
  $l = $sh.CreateShortcut($p)
  $l.TargetPath = $exe
  $l.WorkingDirectory = Split-Path $exe
  $l.IconLocation = "$r\scs-logo.ico,0"
  $l.Description = 'Simple Coding Studio'
  $l.Save()
}
Stop-Process -Name explorer -Force
Start-Sleep 2
Remove-Item "$env:LOCALAPPDATA\IconCache.db" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache*" -Force -ErrorAction SilentlyContinue
& ie4uinit.exe -show
Start-Sleep 1
if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer }
Start-Sleep 15
'--- VERIFY ---'
foreach ($p in @("$sm\Simple Coding Studio.lnk", "$desk\Simple Coding Studio.lnk")) {
  $l = $sh.CreateShortcut($p)
  "{0}`n   target={1} exists={2}`n   icon={3} exists={4}" -f $p, $l.TargetPath, (Test-Path $l.TargetPath), $l.IconLocation, (Test-Path ($l.IconLocation -replace ',\d+$',''))
}
Get-StartApps | Where-Object Name -like '*Simple Coding*' | Format-List
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Icon]::ExtractAssociatedIcon("$desk\Simple Coding Studio.lnk").ToBitmap()
$bmp.Save((Join-Path $here 'verify-desktop-icon.png'))
'Saved verify-desktop-icon.png'
Stop-Transcript | Out-Null
