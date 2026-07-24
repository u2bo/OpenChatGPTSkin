//go:build windows

package windows

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

type stubRunner struct {
	contents []byte
	err      error
}

func (runner stubRunner) Run(context.Context, string) ([]byte, error) {
	return runner.contents, runner.err
}

func validInstall() Install {
	return Install{
		PackageRoot:  `C:\Program Files\WindowsApps\OpenAI.Codex_26.721.3404.0_x64__2p2nqsd0c76g0`,
		EntryPath:    `C:\Program Files\WindowsApps\OpenAI.Codex_26.721.3404.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe`,
		IdentityName: expectedIdentity, PackageVersion: "26.721.3404.0", PackagePublisher: expectedPublisher,
		AppID: "App", EntryRelativePath: expectedEntry, EntryPoint: "Windows.FullTrustApplication",
		PackageSignatureStatus: "Valid", PackageSignerCommonName: expectedSigner,
		CatalogSignatureStatus: "Valid", CatalogSignerCommonName: expectedSigner,
		EntryBlockMapValid: true, ResourceSignatureStatus: "Valid", ResourceSignerCommonName: expectedResource,
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
