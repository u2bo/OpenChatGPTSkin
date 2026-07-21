param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$DataDirectory,
  [string]$ReportPath
)

$ErrorActionPreference = 'Stop'

$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$install = [IO.Path]::GetFullPath($InstallDirectory)
if (Test-Path -LiteralPath $install) {
  throw "Installer acceptance directory already exists: $install"
}
$startMenuGroup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\OpenChatGPTSkin'
if (Test-Path -LiteralPath $startMenuGroup) {
  throw "Installer acceptance Start menu group already exists: $startMenuGroup"
}
$expectedDataRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'OpenChatGPTSkin'))
$sentinelRoot = [IO.Path]::GetFullPath($DataDirectory)
if (-not $sentinelRoot.Equals($expectedDataRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Installer acceptance must use the production user data directory: $expectedDataRoot"
}
if (Test-Path -LiteralPath $sentinelRoot) {
  throw "Installer acceptance data directory already exists: $sentinelRoot"
}
$themeSentinel = Join-Path $sentinelRoot 'theme-store\themes\acceptance-theme\1.0.0\theme.json'
$draftSentinel = Join-Path $sentinelRoot 'theme-studio\drafts\acceptance-draft.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $themeSentinel) -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $draftSentinel) -Force | Out-Null
Set-Content -LiteralPath $themeSentinel -Value '{"preserved":true}' -Encoding utf8
Set-Content -LiteralPath $draftSentinel -Value '{"preserved":true}' -Encoding utf8

function Assert-UserDataPreserved {
  if (-not (Test-Path -LiteralPath $themeSentinel) -or -not (Test-Path -LiteralPath $draftSentinel)) {
    throw 'Installer modified or removed existing personal theme data'
  }
}

$arguments = @(
  '/CURRENTUSER',
  '/VERYSILENT',
  '/SUPPRESSMSGBOXES',
  '/NORESTART',
  "/DIR=$install"
)
$process = Start-Process -FilePath $setup -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) {
  throw "Installer exited with code $($process.ExitCode)"
}
Assert-UserDataPreserved

$manifest = Join-Path $install 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifest)) {
  throw 'Installed Release manifest is missing'
}
$releaseManifest = Get-Content -Raw -Encoding utf8 $manifest | ConvertFrom-Json
$uninstallRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{A7E2825E-2E95-4AF1-B0B7-CC5D7482AF36}_is1'
$registration = Get-ItemProperty -LiteralPath $uninstallRegistry -ErrorAction Stop
if ($registration.DisplayVersion -ne $releaseManifest.version) {
  throw "Installer registration version mismatch: $($registration.DisplayVersion)"
}
if ([IO.Path]::GetFullPath($registration.InstallLocation).TrimEnd('\') -ne $install.TrimEnd('\')) {
  throw "Installer registration location mismatch: $($registration.InstallLocation)"
}
$startShortcut = Join-Path $startMenuGroup 'OpenChatGPTSkin.lnk'
$uninstallShortcut = Join-Path $startMenuGroup '卸载 OpenChatGPTSkin.lnk'
if (-not (Test-Path -LiteralPath $startShortcut) -or -not (Test-Path -LiteralPath $uninstallShortcut)) {
  throw 'Windows Start menu launch or uninstall entry is missing'
}

npm run release:acceptance -- --release-root $install --scenario installed-payload
if ($LASTEXITCODE -ne 0) {
  throw "Installed payload acceptance failed with code $LASTEXITCODE"
}

$upgrade = Start-Process -FilePath $setup -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
if ($upgrade.ExitCode -ne 0) {
  throw "Installer overwrite upgrade exited with code $($upgrade.ExitCode)"
}
Assert-UserDataPreserved
$upgradedRegistration = Get-ItemProperty -LiteralPath $uninstallRegistry -ErrorAction Stop
if ($upgradedRegistration.DisplayVersion -ne $releaseManifest.version) {
  throw 'Installer overwrite upgrade changed the registered version incorrectly'
}

$uninstaller = Join-Path $install 'unins000.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) {
  throw 'Windows uninstaller is missing'
}
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList @(
  '/VERYSILENT',
  '/SUPPRESSMSGBOXES',
  '/NORESTART'
) -Wait -PassThru -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) {
  throw "Uninstaller exited with code $($uninstall.ExitCode)"
}
if (Test-Path -LiteralPath $install) {
  throw 'Program directory remains after uninstall'
}
if (Test-Path -LiteralPath $uninstallRegistry) {
  throw 'Installer registration remains after uninstall'
}
if (Test-Path -LiteralPath $startMenuGroup) {
  throw 'Windows Start menu group remains after uninstall'
}
Assert-UserDataPreserved

Remove-Item -LiteralPath $sentinelRoot -Recurse -Force

$report = [ordered]@{
  scenario = 'windows-installer'
  installerAccepted = $true
  payloadAccepted = $true
  registrationVersionVerified = $true
  startMenuEntriesVerified = $true
  upgradePreservedData = $true
  uninstallPreservedData = $true
}
$reportJson = $report | ConvertTo-Json -Compress
if ($ReportPath) {
  $reportOutput = [IO.Path]::GetFullPath($ReportPath)
  New-Item -ItemType Directory -Path (Split-Path -Parent $reportOutput) -Force | Out-Null
  Set-Content -LiteralPath $reportOutput -Value $reportJson -Encoding utf8
}
Write-Output $reportJson
