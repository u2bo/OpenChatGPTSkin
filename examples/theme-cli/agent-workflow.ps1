param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [Parameter(Mandatory = $true)]
  [string]$Background,

  [Parameter(Mandatory = $true)]
  [string]$ThemeDirectory,

  [Parameter(Mandatory = $true)]
  [string]$Archive,

  [string]$UnpackDirectory = "$ThemeDirectory-unpacked",
  [string]$Patch = (Join-Path $PSScriptRoot "theme-patch.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

foreach ($path in @($Executable, $Background, $Patch)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required file does not exist: $path"
  }
}
foreach ($path in @($ThemeDirectory, $Archive, $UnpackDirectory)) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite an existing target: $path"
  }
}

& $Executable theme contract
if ($LASTEXITCODE -ne 0) { throw "theme contract failed with exit code $LASTEXITCODE" }

& $Executable theme create --dir $ThemeDirectory --id agent-demo --name "Agent Demo" --author "Theme Agent" --appearance dark --background $Background
if ($LASTEXITCODE -ne 0) { throw "theme create failed with exit code $LASTEXITCODE" }

& $Executable theme config --dir $ThemeDirectory --patch $Patch
if ($LASTEXITCODE -ne 0) { throw "theme config failed with exit code $LASTEXITCODE" }

& $Executable theme show --dir $ThemeDirectory
if ($LASTEXITCODE -ne 0) { throw "theme show failed with exit code $LASTEXITCODE" }

& $Executable theme validate --dir $ThemeDirectory
if ($LASTEXITCODE -ne 0) { throw "theme validate failed with exit code $LASTEXITCODE" }

& $Executable theme pack --dir $ThemeDirectory --out $Archive
if ($LASTEXITCODE -ne 0) { throw "theme pack failed with exit code $LASTEXITCODE" }

& $Executable theme unpack --file $Archive --out $UnpackDirectory
if ($LASTEXITCODE -ne 0) { throw "theme unpack failed with exit code $LASTEXITCODE" }

& $Executable theme validate --dir $UnpackDirectory
if ($LASTEXITCODE -ne 0) { throw "unpacked theme validate failed with exit code $LASTEXITCODE" }

Write-Host "Theme project: $ThemeDirectory"
Write-Host "Archive: $Archive"
Write-Host "Unpacked project: $UnpackDirectory"
