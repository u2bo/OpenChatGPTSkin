param(
  [Parameter(Mandatory = $true)][string]$ReleaseRoot,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'

$release = (Resolve-Path -LiteralPath $ReleaseRoot).Path
if ((Split-Path -Leaf $release) -ne 'OpenChatGPTSkin') {
  throw 'Release staging directory must be named OpenChatGPTSkin'
}
$manifestPath = Join-Path $release 'release-manifest.json'
$manifest = Get-Content -Raw -Encoding utf8 $manifestPath | ConvertFrom-Json
if ($manifest.version -ne $Version) {
  throw "Installer version does not match Release manifest: $($manifest.version)"
}
if ($manifest.target.platform -ne 'win32' -or $manifest.target.arch -ne 'x64') {
  throw 'Windows installer requires a win32/x64 Release payload'
}

$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$isccCandidates = @(
  $env:INNO_SETUP_COMPILER,
  'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  'C:\Program Files\Inno Setup 6\ISCC.exe'
) | Where-Object { $_ }
$iscc = $isccCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc) {
  throw 'Inno Setup 6 compiler was not found'
}

$script = Join-Path $PSScriptRoot 'windows-installer.iss'
$arguments = @(
  "/DAppVersion=$Version",
  "/DReleaseRoot=$release",
  "/DOutputDirectory=$output",
  $script
)
& $iscc @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup compiler exited with code $LASTEXITCODE"
}

$installer = Join-Path $output "OpenChatGPTSkin_${Version}_windows_x64_Setup.exe"
if (-not (Test-Path -LiteralPath $installer)) {
  throw 'Inno Setup did not create the expected installer'
}
Get-Item -LiteralPath $installer | Select-Object FullName,Length
