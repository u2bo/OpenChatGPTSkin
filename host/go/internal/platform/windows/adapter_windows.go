//go:build windows

// Package windows verifies the official Windows Appx installation before any
// launch or CDP action is considered. It deliberately owns no theme/DOM logic.
package windows

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

const (
	expectedIdentity  = "OpenAI.Codex"
	expectedPublisher = "CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B"
	expectedSigner    = "50BDFD77-8903-4850-9FFE-6E8522F64D5B"
	expectedResource  = "OpenAI OpCo, LLC"
	expectedEntry     = "app/ChatGPT.exe"
)

var versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`)

type Install struct {
	PackageRoot              string `json:"packageRoot"`
	EntryPath                string `json:"entryPath"`
	IdentityName             string `json:"identityName"`
	PackageVersion           string `json:"packageVersion"`
	PackagePublisher         string `json:"packagePublisher"`
	AppID                    string `json:"appId"`
	EntryRelativePath        string `json:"entryRelativePath"`
	EntryPoint               string `json:"entryPoint"`
	PackageSignatureStatus   string `json:"packageSignatureStatus"`
	PackageSignerCommonName  string `json:"packageSignerCommonName"`
	CatalogSignatureStatus   string `json:"catalogSignatureStatus"`
	CatalogSignerCommonName  string `json:"catalogSignerCommonName"`
	EntryBlockMapValid       bool   `json:"entryBlockMapValid"`
	ResourceSignatureStatus  string `json:"resourceSignatureStatus"`
	ResourceSignerCommonName string `json:"resourceSignerCommonName"`
}

type ProcessIdentity struct {
	PID            int    `json:"pid"`
	ParentPID      int    `json:"parentPid"`
	StartedAt      string `json:"startedAt"`
	ExecutablePath string `json:"executablePath"`
}

type Error struct {
	Code    string
	Message string
}

func (err Error) Error() string { return err.Message }

type PowerShellRunner interface {
	Run(context.Context, string) ([]byte, error)
}

type defaultRunner struct{}

func (defaultRunner) Run(ctx context.Context, script string) ([]byte, error) {
	command := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create([Console]::In.ReadToEnd()))")
	command.Stdin = strings.NewReader(script)
	var stdout, stderr bytes.Buffer
	command.Stdout, command.Stderr = &stdout, &stderr
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: message}
	}
	return stdout.Bytes(), nil
}

// InspectOfficialCodex performs a fresh Appx inspection. Cached evidence is
// never accepted as an identity substitute.
func InspectOfficialCodex(ctx context.Context) (Install, error) {
	return inspect(ctx, defaultRunner{})
}

func inspect(ctx context.Context, runner PowerShellRunner) (Install, error) {
	inspectionContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	contents, err := runner.Run(inspectionContext, inspectionScript)
	if err != nil {
		return Install{}, err
	}
	var install Install
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&install); err != nil {
		return Install{}, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows Appx inspection returned invalid JSON"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Install{}, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows Appx inspection returned trailing data"}
	}
	if err := verify(install); err != nil {
		return Install{}, err
	}
	return install, nil
}

// ListCodexRoots returns only root ChatGPT.exe processes. Any result is an
// unmanaged instance until it was launched and recorded by this Host, so the
// caller must refuse rather than attach, modify, or terminate it.
func ListCodexRoots(ctx context.Context) ([]ProcessIdentity, error) {
	inspectionContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	contents, err := defaultRunner{}.Run(inspectionContext, rootsScript)
	if err != nil {
		return nil, err
	}
	return parseRoots(contents)
}

func parseRoots(contents []byte) ([]ProcessIdentity, error) {
	var roots []ProcessIdentity
	if len(bytes.TrimSpace(contents)) == 0 || string(bytes.TrimSpace(contents)) == "null" {
		return []ProcessIdentity{}, nil
	}
	if err := json.Unmarshal(contents, &roots); err != nil {
		return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows process inspection returned invalid JSON"}
	}
	for _, root := range roots {
		if root.PID < 1 || root.ParentPID < 0 || root.ExecutablePath == "" || !strings.HasSuffix(strings.ToLower(normalizePath(root.ExecutablePath)), "/"+strings.ToLower(expectedEntry)) || !validTimestamp(root.StartedAt) {
			return nil, Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Windows process inspection returned an invalid root"}
		}
	}
	return roots, nil
}

func RefuseUnmanagedCodex(ctx context.Context) error {
	roots, err := ListCodexRoots(ctx)
	if err != nil {
		return err
	}
	if len(roots) > 0 {
		return Error{Code: "CODEX_ALREADY_RUNNING_UNMANAGED", Message: "A normal Codex instance is already running"}
	}
	return nil
}

func verify(install Install) error {
	valid := install.PackageRoot != "" && install.EntryPath != "" &&
		install.IdentityName == expectedIdentity && versionPattern.MatchString(install.PackageVersion) &&
		install.PackagePublisher == expectedPublisher && install.AppID == "App" &&
		normalizePath(install.EntryRelativePath) == expectedEntry && install.EntryPoint == "Windows.FullTrustApplication" &&
		install.PackageSignatureStatus == "Valid" && install.PackageSignerCommonName == expectedSigner &&
		install.CatalogSignatureStatus == "Valid" && install.CatalogSignerCommonName == expectedSigner &&
		install.EntryBlockMapValid && install.ResourceSignatureStatus == "Valid" &&
		install.ResourceSignerCommonName == expectedResource &&
		strings.EqualFold(normalizePath(install.EntryPath), normalizePath(install.PackageRoot)+"/"+expectedEntry)
	if !valid {
		return Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex Appx identity, signature, block map, or entry path is invalid"}
	}
	return nil
}

func normalizePath(path string) string {
	return strings.TrimRight(strings.ReplaceAll(path, "\\", "/"), "/")
}

func validTimestamp(value string) bool {
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

const inspectionScript = `$ErrorActionPreference = "Stop"
$packages = @(Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue)
if ($packages.Count -ne 1) { throw "Expected exactly one OpenAI.Codex Appx registration" }
$package = $packages[0]
$root = [IO.Path]::GetFullPath([string]$package.InstallLocation)
[xml]$manifest = Get-Content -Raw -LiteralPath ([IO.Path]::Combine($root, "AppxManifest.xml"))
$app = @($manifest.Package.Applications.Application) | Where-Object { $_.Id -eq "App" } | Select-Object -First 1
if ($null -eq $app) { throw "Official Appx application entry is missing" }
$entry = [IO.Path]::GetFullPath([IO.Path]::Combine($root, [string]$app.Executable))
function Signature([string]$path) {
  $value = Get-AuthenticodeSignature -LiteralPath $path
  $name = if ($null -eq $value.SignerCertificate) { "" } else { $value.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }
  return [pscustomobject]@{ status = [string]$value.Status; signer = $name }
}
function Test-BlockMap([string]$packageRoot, [string]$relativePath) {
  [xml]$blockMap = Get-Content -Raw -LiteralPath ([IO.Path]::Combine($packageRoot, "AppxBlockMap.xml"))
  $file = @($blockMap.BlockMap.File) | Where-Object { ([string]$_.Name).Replace("/", "\") -ieq $relativePath.Replace("/", "\") } | Select-Object -First 1
  if ($null -eq $file) { return $false }
  $path = [IO.Path]::Combine($packageRoot, $relativePath)
  $stream = [IO.File]::OpenRead($path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    if ([int64]$file.Size -ne $stream.Length) { return $false }
    foreach ($block in @($file.Block)) {
      $count = [int][Math]::Min(65536, $stream.Length - $stream.Position)
      if ($count -le 0) { return $false }
      $buffer = New-Object byte[] $count
      $read = 0
      while ($read -lt $count) { $next = $stream.Read($buffer, $read, $count - $read); if ($next -le 0) { return $false }; $read += $next }
      if ([Convert]::ToBase64String($sha.ComputeHash($buffer)) -cne [string]$block.Hash) { return $false }
    }
    return $stream.Position -eq $stream.Length
  } finally { $sha.Dispose(); $stream.Dispose() }
}
$packageSig = Signature ([IO.Path]::Combine($root, "AppxSignature.p7x"))
$catalogSig = Signature ([IO.Path]::Combine($root, "AppxMetadata\CodeIntegrity.cat"))
$resourceSig = Signature ([IO.Path]::Combine($root, "app\resources\codex.exe"))
[pscustomobject]@{
  packageRoot = $root; entryPath = $entry; identityName = [string]$manifest.Package.Identity.Name; packageVersion = [string]$manifest.Package.Identity.Version; packagePublisher = [string]$manifest.Package.Identity.Publisher; appId = [string]$app.Id; entryRelativePath = [string]$app.Executable; entryPoint = [string]$app.EntryPoint;
  packageSignatureStatus = $packageSig.status; packageSignerCommonName = $packageSig.signer; catalogSignatureStatus = $catalogSig.status; catalogSignerCommonName = $catalogSig.signer; entryBlockMapValid = Test-BlockMap $root ([string]$app.Executable); resourceSignatureStatus = $resourceSig.status; resourceSignerCommonName = $resourceSig.signer
} | ConvertTo-Json -Compress`

const rootsScript = `$ErrorActionPreference = "Stop"
$all = @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | ForEach-Object {
  [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; executablePath = [string]$_.ExecutablePath }
})
$ids = @{}
foreach ($entry in $all) { $ids[[int]$entry.pid] = $true }
$roots = @($all | Where-Object { -not $ids.ContainsKey([int]$_.parentPid) } | ForEach-Object {
  $process = Get-Process -Id ([int]$_.pid) -ErrorAction Stop
  [pscustomobject]@{ pid = [int]$_.pid; parentPid = [int]$_.parentPid; startedAt = $process.StartTime.ToUniversalTime().ToString("o"); executablePath = [string]$_.executablePath }
})
ConvertTo-Json -InputObject @($roots) -Compress`
