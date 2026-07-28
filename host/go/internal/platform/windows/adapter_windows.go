//go:build windows

// Package windows verifies the official Windows Appx installation before any
// launch or CDP action is considered. It deliberately owns no theme/DOM logic.
package windows

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const (
	expectedIdentity       = "OpenAI.Codex"
	expectedFamily         = "OpenAI.Codex_2p2nqsd0c76g0"
	expectedPublisher      = "CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B"
	expectedSigner         = "50BDFD77-8903-4850-9FFE-6E8522F64D5B"
	expectedResource       = "OpenAI OpCo, LLC"
	expectedEntry          = "app/ChatGPT.exe"
	managedCDPReadyTimeout = 90 * time.Second
	createNoWindow         = 0x08000000
)

var versionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`)

type Install struct {
	PackageRoot              string `json:"packageRoot"`
	EntryPath                string `json:"entryPath"`
	IdentityName             string `json:"identityName"`
	PackageFamilyName        string `json:"packageFamilyName"`
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

type ManagedLaunch struct {
	Install Install
	Root    ProcessIdentity
	Port    int
}

type portInspection struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	OwningPID int    `json:"owningPid"`
	Ancestors []int  `json:"ancestors"`
}

type Error struct {
	Code    string
	Message string
}

func (err Error) Error() string { return err.Message }

type PowerShellRunner interface {
	Run(context.Context, string) ([]byte, error)
}

type applicationActivator interface {
	ActivateApplication(appUserModelID, arguments string) (uint32, error)
}

type defaultRunner struct{}

func newPowerShellCommand(ctx context.Context) *exec.Cmd {
	command := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create([Console]::In.ReadToEnd()))")
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	return command
}

func (defaultRunner) Run(ctx context.Context, script string) ([]byte, error) {
	command := newPowerShellCommand(ctx)
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

// LaunchManaged starts only a freshly verified official Appx entry. A normal
// already-running instance is never attached to, and the selected CDP port is
// accepted only when it belongs to the launched process tree.
func LaunchManaged(ctx context.Context) (ManagedLaunch, error) {
	if err := RefuseUnmanagedCodex(ctx); err != nil {
		return ManagedLaunch{}, err
	}
	install, err := InspectOfficialCodex(ctx)
	if err != nil {
		return ManagedLaunch{}, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return ManagedLaunch{}, Error{Code: "CODEX_LAUNCH_FAILED", Message: "Could not reserve an IPv4 loopback CDP port"}
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		return ManagedLaunch{}, err
	}
	launchedAfter := time.Now().UTC().Add(-time.Second)
	activatedPID, err := activateOfficialCodex(install, port, windowsApplicationActivator{})
	if err != nil {
		return ManagedLaunch{}, err
	}
	deadline := time.Now().Add(managedCDPReadyTimeout)
	for time.Now().Before(deadline) {
		roots, rootsErr := ListCodexRoots(ctx)
		if rootsErr != nil {
			return ManagedLaunch{}, rootsErr
		}
		for _, root := range roots {
			started, parseErr := time.Parse(time.RFC3339Nano, root.StartedAt)
			if parseErr == nil && root.PID == int(activatedPID) && !started.Before(launchedAfter) && strings.EqualFold(normalizePath(root.ExecutablePath), normalizePath(install.EntryPath)) {
				inspection, inspectErr := inspectPort(ctx, port, root.PID)
				if inspectErr != nil {
					var platformError Error
					if errors.As(inspectErr, &platformError) && platformError.Code != "CDP_NOT_READY" {
						return ManagedLaunch{}, inspectErr
					}
					continue
				}
				if inspection.Host == "127.0.0.1" && inspection.Port == port && containsPID(inspection.Ancestors, root.PID) {
					return ManagedLaunch{Install: install, Root: root, Port: port}, nil
				}
				return ManagedLaunch{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP endpoint is not owned by the managed Codex process"}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return ManagedLaunch{}, Error{Code: "CDP_NOT_READY", Message: "Managed Codex did not expose an owned IPv4 loopback CDP endpoint"}
}

func activateOfficialCodex(install Install, port int, activator applicationActivator) (uint32, error) {
	if port < 1 || port > 65535 || install.PackageFamilyName != expectedFamily || install.AppID != "App" {
		return 0, Error{Code: "CODEX_IDENTITY_INVALID", Message: "Codex Appx activation identity is invalid"}
	}
	appUserModelID := install.PackageFamilyName + "!" + install.AppID
	arguments := fmt.Sprintf("--remote-debugging-address=127.0.0.1 --remote-debugging-port=%d", port)
	processID, err := activator.ActivateApplication(appUserModelID, arguments)
	if err != nil || processID == 0 {
		message := "Windows could not activate the verified ChatGPT application"
		if err != nil {
			message += ": " + err.Error()
		}
		return 0, Error{Code: "CODEX_LAUNCH_FAILED", Message: message}
	}
	return processID, nil
}

// WaitForManagedExit observes only the exact process identity created by this
// Host. It never attaches to or terminates a later normal Codex instance.
func WaitForManagedExit(ctx context.Context, managed ProcessIdentity) error {
	if managed.PID < 1 || !validTimestamp(managed.StartedAt) || managed.ExecutablePath == "" {
		return Error{Code: "PROCESS_INSPECTION_DENIED", Message: "Managed Codex identity is invalid"}
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		roots, err := ListCodexRoots(ctx)
		if err != nil {
			return err
		}
		found := false
		for _, root := range roots {
			if root.PID == managed.PID && root.StartedAt == managed.StartedAt && strings.EqualFold(normalizePath(root.ExecutablePath), normalizePath(managed.ExecutablePath)) {
				found = true
				break
			}
		}
		if !found {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func inspectPort(ctx context.Context, port, managedRootPID int) (portInspection, error) {
	if port < 1 || port > 65535 {
		return portInspection{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP port is invalid"}
	}
	if managedRootPID < 1 {
		return portInspection{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "Managed Codex root process is invalid"}
	}
	if err := ctx.Err(); err != nil {
		return portInspection{}, err
	}
	owner, err := loopbackTCPPortOwner(port)
	if err != nil {
		return portInspection{}, err
	}
	ancestors, err := processAncestors(owner, managedRootPID)
	if err != nil {
		return portInspection{}, err
	}
	return validatePortInspection(portInspection{
		Host: "127.0.0.1", Port: port, OwningPID: owner, Ancestors: ancestors,
	}, port)
}

func validatePortInspection(value portInspection, port int) (portInspection, error) {
	if value.Host != "127.0.0.1" || value.Port != port || value.OwningPID < 1 || len(value.Ancestors) == 0 {
		return portInspection{}, Error{Code: "CDP_NOT_READY", Message: "CDP endpoint is not ready"}
	}
	if !containsPID(value.Ancestors, value.OwningPID) {
		return portInspection{}, Error{Code: "CDP_ENDPOINT_UNSAFE", Message: "CDP endpoint owner is not in its process ancestry"}
	}
	return value, nil
}

func containsPID(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func verify(install Install) error {
	valid := install.PackageRoot != "" && install.EntryPath != "" &&
		install.IdentityName == expectedIdentity && install.PackageFamilyName == expectedFamily && versionPattern.MatchString(install.PackageVersion) &&
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
  packageRoot = $root; entryPath = $entry; identityName = [string]$manifest.Package.Identity.Name; packageFamilyName = [string]$package.PackageFamilyName; packageVersion = [string]$manifest.Package.Identity.Version; packagePublisher = [string]$manifest.Package.Identity.Publisher; appId = [string]$app.Id; entryRelativePath = [string]$app.Executable; entryPoint = [string]$app.EntryPoint;
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
