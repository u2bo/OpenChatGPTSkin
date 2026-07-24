param(
  [string]$OutputDirectory,
  [string]$NodeVersion = '22.18.0'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repositoryRoot 'artifacts\windows-x64'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
$buildRoot = Join-Path $env:TEMP "OpenChatGPTSkin-local-$([Guid]::NewGuid().ToString('N'))"
$nodeOutput = Join-Path $buildRoot 'node'
$releaseRoot = Join-Path $buildRoot 'release\OpenChatGPTSkin'
$temporaryArtifacts = Join-Path $buildRoot 'artifacts'
$innoSetupVersion = '6.7.1'
$innoSetupUrl = "https://github.com/jrsoftware/issrc/releases/download/is-6_7_1/innosetup-$innoSetupVersion.exe"
$innoSetupSha256 = '4D11E8050B6185E0D49BD9E8CC661A7A59F44959A621D31D11033124C4E8A7B0'

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}
$npmExecutable = $npmCommand.Source

function Invoke-Npm {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & $npmExecutable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Invoke-NpmCapture {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $captured = & $npmExecutable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
  return $captured
}

function Test-LockedDependencies {
  & $npmExecutable 'ls' '--depth=0' '--silent' *> $null
  return $LASTEXITCODE -eq 0
}

function Resolve-InnoSetupCompiler {
  $installedCandidates = @(
    $env:INNO_SETUP_COMPILER,
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe'
  ) | Where-Object { $_ }
  $installed = $installedCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($installed) {
    return $installed
  }

  Write-Host "Inno Setup $innoSetupVersion was not found; fetching the verified portable compiler..."
  $installer = Join-Path $buildRoot "innosetup-$innoSetupVersion.exe"
  $portableRoot = Join-Path $buildRoot 'inno-setup'
  $previousProtocol = [Net.ServicePointManager]::SecurityProtocol
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $innoSetupUrl -OutFile $installer
  } finally {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
  }
  $actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
  if (-not $actualHash.Equals($innoSetupSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Inno Setup SHA-256 mismatch: expected $innoSetupSha256, received $actualHash"
  }

  $process = Start-Process -FilePath $installer -ArgumentList @(
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/SP-',
    '/PORTABLE=1',
    "/DIR=$portableRoot"
  ) -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Portable Inno Setup bootstrap failed with exit code $($process.ExitCode)"
  }
  $portableCompiler = Join-Path $portableRoot 'ISCC.exe'
  if (-not (Test-Path -LiteralPath $portableCompiler)) {
    throw 'Portable Inno Setup bootstrap did not create ISCC.exe'
  }
  return $portableCompiler
}

$succeeded = $false
Push-Location $repositoryRoot
try {
  New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
  $env:INNO_SETUP_COMPILER = Resolve-InnoSetupCompiler

  Write-Host '[1/7] Checking locked dependencies...'
  if (Test-LockedDependencies) {
    Write-Host 'Existing dependencies are complete; skipping dependency installation.'
  } else {
    Write-Host 'Dependencies are missing or inconsistent; repairing them from package-lock.json...'
    Invoke-Npm -Arguments @('install', '--no-audit', '--no-fund')
  }

  Write-Host '[2/7] Verifying version, tests, types, and Theme Studio...'
  Invoke-Npm -Arguments @('run', 'release:version')
  Invoke-Npm -Arguments @('run', 'verify')
  Invoke-Npm -Arguments @('run', 'studio:build')

  Write-Host '[3/7] Fetching the official bundled Node.js runtime...'
  $metadataOutput = Invoke-NpmCapture -Arguments @(
    'run', '--silent', 'release:node', '--',
    '--version', $NodeVersion,
    '--platform', 'win32',
    '--arch', 'x64',
    '--output', $buildRoot
  )
  $metadataText = [string]::Join([Environment]::NewLine, @($metadataOutput))
  $metadata = $metadataText | ConvertFrom-Json
  Expand-Archive -LiteralPath $metadata.archivePath -DestinationPath $nodeOutput -Force
  $nodeRoot = Join-Path $nodeOutput $metadata.rootDirectory

  Write-Host '[4/7] Staging and validating the production payload...'
  $commit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "git rev-parse HEAD failed with exit code $LASTEXITCODE"
  }
  Invoke-Npm -Arguments @(
    'run', 'release:stage', '--',
    '--output', $releaseRoot,
    '--node-executable', (Join-Path $nodeRoot 'node.exe'),
    '--node-license', (Join-Path $nodeRoot 'LICENSE'),
    '--node-version', $NodeVersion,
    '--build-commit', $commit,
    '--platform', 'win32',
    '--arch', 'x64'
  )
  Invoke-Npm -Arguments @(
    'run', 'release:acceptance', '--',
    '--release-root', $releaseRoot,
    '--scenario', 'staged-payload'
  )

  Write-Host '[5/7] Building and validating the portable ZIP...'
  Invoke-Npm -Arguments @(
    'run', 'release:package', '--',
    '--release-root', $releaseRoot,
    '--output', $temporaryArtifacts
  )
  $archive = (Get-ChildItem -LiteralPath $temporaryArtifacts -Filter '*.zip' | Select-Object -First 1).FullName
  if (-not $archive) {
    throw 'Portable release archive was not created'
  }
  Invoke-Npm -Arguments @(
    'run', 'release:acceptance:archive', '--',
    '--archive', $archive
  )

  Write-Host '[6/7] Building the Windows Setup executable...'
  $version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
  & (Join-Path $PSScriptRoot 'build-windows-installer.ps1') `
    -ReleaseRoot $releaseRoot `
    -OutputDirectory $temporaryArtifacts `
    -Version $version
  if ($LASTEXITCODE -ne 0) {
    throw "Windows installer build failed with exit code $LASTEXITCODE"
  }

  Write-Host '[7/7] Writing checksums and copying final artifacts...'
  Invoke-Npm -Arguments @(
    'run', 'release:checksums', '--',
    '--output', $temporaryArtifacts
  )
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  Get-ChildItem -LiteralPath $temporaryArtifacts -File | Copy-Item -Destination $output -Force

  $succeeded = $true
} catch {
  Write-Host "Local build files were retained for diagnosis: $buildRoot" -ForegroundColor Yellow
  throw
} finally {
  Pop-Location
}

if ($succeeded) {
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
  Write-Host ''
  Write-Host 'Windows release build completed:' -ForegroundColor Green
  Get-ChildItem -LiteralPath $output -File | Sort-Object Name | Format-Table Name, Length, LastWriteTime -AutoSize
  Write-Host "Output: $output"
}
