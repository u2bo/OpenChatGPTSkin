//go:build windows

package windows

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"testing"
)

type stubRunner struct {
	contents []byte
	err      error
}

type stubApplicationActivator struct {
	appUserModelID string
	arguments      string
	processID      uint32
	err            error
}

func (runner stubRunner) Run(context.Context, string) ([]byte, error) {
	return runner.contents, runner.err
}

func (activator *stubApplicationActivator) ActivateApplication(appUserModelID, arguments string) (uint32, error) {
	activator.appUserModelID = appUserModelID
	activator.arguments = arguments
	return activator.processID, activator.err
}

func validInstall() Install {
	return Install{
		PackageRoot:  `C:\Program Files\WindowsApps\OpenAI.Codex_26.721.3404.0_x64__2p2nqsd0c76g0`,
		EntryPath:    `C:\Program Files\WindowsApps\OpenAI.Codex_26.721.3404.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe`,
		IdentityName: expectedIdentity, PackageFamilyName: expectedFamily, PackageVersion: "26.721.3404.0", PackagePublisher: expectedPublisher,
		AppID: "App", EntryRelativePath: expectedEntry, EntryPoint: "Windows.FullTrustApplication",
		PackageSignatureStatus: "Valid", PackageSignerCommonName: expectedSigner,
		CatalogSignatureStatus: "Valid", CatalogSignerCommonName: expectedSigner,
		EntryBlockMapValid: true, ResourceSignatureStatus: "Valid", ResourceSignerCommonName: expectedResource,
	}
}

func TestManagedActivationUsesVerifiedAppxIdentityAndCDPArguments(t *testing.T) {
	activator := &stubApplicationActivator{processID: 321}
	processID, err := activateOfficialCodex(validInstall(), 9222, activator)
	if err != nil {
		t.Fatal(err)
	}
	if processID != 321 || activator.appUserModelID != expectedFamily+"!App" {
		t.Fatalf("pid=%d appUserModelID=%q", processID, activator.appUserModelID)
	}
	if activator.arguments != "--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222" {
		t.Fatalf("arguments=%q", activator.arguments)
	}
}

func TestInspectionAcceptsCompleteOfficialIdentity(t *testing.T) {
	contents, err := json.Marshal(validInstall())
	if err != nil {
		t.Fatal(err)
	}
	actual, err := inspect(context.Background(), stubRunner{contents: contents})
	if err != nil || actual.IdentityName != expectedIdentity {
		t.Fatalf("install=%+v error=%v", actual, err)
	}
}

func TestPowerShellInspectionNeverCreatesAVisibleConsole(t *testing.T) {
	command := newPowerShellCommand(context.Background())
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow || command.SysProcAttr.CreationFlags&0x08000000 == 0 {
		t.Fatalf("PowerShell inspection may create a visible console: %+v", command.SysProcAttr)
	}
}

func TestInspectionRejectsSubstitutedPublisher(t *testing.T) {
	value := validInstall()
	value.PackagePublisher = "CN=Unknown"
	contents, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	_, err = inspect(context.Background(), stubRunner{contents: contents})
	var identityError Error
	if !errors.As(err, &identityError) || identityError.Code != "CODEX_IDENTITY_INVALID" {
		t.Fatalf("error=%v", err)
	}
}

func TestInspectionRejectsUnexpectedFields(t *testing.T) {
	contents := []byte(`{"packageRoot":"x","unexpected":true}`)
	_, err := inspect(context.Background(), stubRunner{contents: contents})
	var inspectionError Error
	if !errors.As(err, &inspectionError) || inspectionError.Code != "PROCESS_INSPECTION_DENIED" {
		t.Fatalf("error=%v", err)
	}
}

func TestRefuseUnmanagedCodexUsesTheRootProcessBoundary(t *testing.T) {
	root := ProcessIdentity{PID: 101, ParentPID: 1, StartedAt: "2026-07-24T00:00:00Z", ExecutablePath: validInstall().EntryPath}
	contents, err := json.Marshal([]ProcessIdentity{root})
	if err != nil {
		t.Fatal(err)
	}
	// The public list boundary rejects malformed identities; launch code can use
	// only a verified root rather than an arbitrary child ChatGPT process.
	if _, err := parseRoots(contents); err != nil {
		t.Fatal(err)
	}
}

func TestPortInspectionRejectsMissingOwner(t *testing.T) {
	_, err := validatePortInspection(portInspection{Host: "127.0.0.1", Port: 9222}, 9222)
	var runtimeError Error
	if !errors.As(err, &runtimeError) || runtimeError.Code != "CDP_NOT_READY" {
		t.Fatalf("error=%v", err)
	}
}

func TestPortInspectionAcceptsLoopbackOwnerInItsTree(t *testing.T) {
	actual, err := validatePortInspection(portInspection{
		Host: "127.0.0.1", Port: 9222, OwningPID: 202, Ancestors: []int{202, 101, 1},
	}, 9222)
	if err != nil || actual.OwningPID != 202 {
		t.Fatalf("inspection=%+v error=%v", actual, err)
	}
}

func TestProcessAncestryStopsAtManagedRootBeforeParentCycle(t *testing.T) {
	ancestors, err := buildProcessAncestors(202, 101, map[int]int{202: 101, 101: 101})
	if err != nil || len(ancestors) != 2 || ancestors[0] != 202 || ancestors[1] != 101 {
		t.Fatalf("ancestors=%v error=%v", ancestors, err)
	}
}

func TestProcessAncestryRejectsCycleBeforeManagedRoot(t *testing.T) {
	_, err := buildProcessAncestors(202, 101, map[int]int{202: 303, 303: 202})
	var runtimeError Error
	if !errors.As(err, &runtimeError) || runtimeError.Code != "CDP_ENDPOINT_UNSAFE" {
		t.Fatalf("error=%v", err)
	}
}

func TestLiveOfficialCodexInspection(t *testing.T) {
	if os.Getenv("OPENCHATGPTSKIN_LIVE_WINDOWS_TEST") != "1" {
		t.Skip("set OPENCHATGPTSKIN_LIVE_WINDOWS_TEST=1 on a prepared Windows device")
	}
	install, err := InspectOfficialCodex(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if install.PackageVersion != "26.721.3404.0" {
		t.Fatalf("unexpected installed Codex version: %s", install.PackageVersion)
	}
}

func TestLiveClosedCodexHasNoUnmanagedRoot(t *testing.T) {
	if os.Getenv("OPENCHATGPTSKIN_LIVE_WINDOWS_TEST") != "1" {
		t.Skip("set OPENCHATGPTSKIN_LIVE_WINDOWS_TEST=1 on a prepared Windows device")
	}
	roots, err := ListCodexRoots(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(roots) != 0 {
		t.Fatalf("expected no normal Codex root after exit, found %+v", roots)
	}
	if err := RefuseUnmanagedCodex(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestLiveCDPPortInspection(t *testing.T) {
	value := os.Getenv("OPENCHATGPTSKIN_CDP_PORT")
	if value == "" {
		t.Skip("set OPENCHATGPTSKIN_CDP_PORT to a managed loopback CDP port")
	}
	port, err := strconv.Atoi(value)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := loopbackTCPPortOwner(port)
	if err != nil {
		t.Fatal(err)
	}
	inspection, err := inspectPort(context.Background(), port, owner)
	if err != nil {
		t.Fatal(err)
	}
	if inspection.Port != port || inspection.Host != "127.0.0.1" || inspection.OwningPID < 1 {
		t.Fatalf("inspection=%+v", inspection)
	}
}

func TestLiveManagedLaunchOwnsLoopbackCDP(t *testing.T) {
	if os.Getenv("OPENCHATGPTSKIN_LIVE_WINDOWS_TEST") != "1" {
		t.Skip("set OPENCHATGPTSKIN_LIVE_WINDOWS_TEST=1 on a prepared Windows device")
	}
	launch, err := LaunchManaged(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if launch.Port < 1 || launch.Root.PID < 1 || launch.Install.IdentityName != expectedIdentity {
		t.Fatalf("managed launch evidence is incomplete: %+v", launch)
	}
}
