package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/studio"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

type runtimeThemeRepositoryStub struct {
	library  themerepo.Library
	imported []byte
}

func (repository *runtimeThemeRepositoryStub) List() (themerepo.Library, error) {
	return repository.library, nil
}

func (repository *runtimeThemeRepositoryStub) ImportArchive(contents []byte) (themerepo.Ref, error) {
	repository.imported = append([]byte(nil), contents...)
	return themerepo.Ref{ID: "personal-theme", Version: "1.0.0"}, nil
}

func TestParseDefaultsToStudio(t *testing.T) {
	command, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if command.Role != RoleStudio {
		t.Fatalf("role = %q, want %q", command.Role, RoleStudio)
	}
}

func TestParseRejectsUnknownRole(t *testing.T) {
	_, err := Parse([]string{"unknown"})
	if err == nil || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
		t.Fatalf("error = %v, want CLI_ARGUMENT_INVALID", err)
	}
}

func TestParseAcceptsThemeRole(t *testing.T) {
	command, err := Parse([]string{"theme", "help"})
	if err != nil || command.Role != RoleTheme || len(command.Args) != 1 || command.Args[0] != "help" {
		t.Fatalf("command=%+v error=%v", command, err)
	}
}

func TestThemeRoleEmitsMachineReadableJSON(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := Run(context.Background(), []string{"theme", "help"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	var result struct {
		Role            string         `json:"role"`
		ProtocolVersion int            `json:"protocolVersion"`
		Commands        map[string]any `json:"commands"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("stdout=%s error=%v", stdout.String(), err)
	}
	if result.Role != "theme" || result.ProtocolVersion != 1 || result.Commands["create"] == nil {
		t.Fatalf("result=%+v", result)
	}
	if stderr.Len() != 0 {
		t.Fatalf("unexpected stderr=%s", stderr.String())
	}
}

func TestThemeRoleUsesUsageExitCodeAndStructuredError(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if code := Run(context.Background(), []string{"theme", "unknown"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	if stdout.Len() != 0 || !bytes.Contains(stderr.Bytes(), []byte(`"code":"CLI_ARGUMENT_INVALID"`)) {
		t.Fatalf("stdout=%s stderr=%s", stdout.String(), stderr.String())
	}
}

func TestStudioDevRequiresAnExplicitLoopbackOrigin(t *testing.T) {
	if _, err := parseStudioOptions([]string{"--dev"}); err == nil {
		t.Fatal("--dev without a Vite origin was accepted")
	}
	options, err := parseStudioOptions([]string{"--dev", "--vite-origin", "http://127.0.0.1:5173", "--no-open"})
	if err != nil || options.viteOrigin != "http://127.0.0.1:5173" || !options.noOpen {
		t.Fatalf("studio dev options = %+v error=%v", options, err)
	}
}

func TestInstallRootCandidatesIncludeMacOSBundlePayload(t *testing.T) {
	executable := filepath.Join("Applications", "OpenChatGPTSkin.app", "Contents", "MacOS", "OpenChatGPTSkin")
	candidates := installRootCandidates(executable, filepath.Join("workspace", "OpenChatGPTSkin"))
	expected := filepath.Clean(filepath.Join("Applications", "OpenChatGPTSkin.app", "Contents", "Resources", "payload"))
	if len(candidates) != 3 || candidates[1] != expected {
		t.Fatalf("install root candidates = %v, want payload %q", candidates, expected)
	}
}

func TestInstallRootRequiresManifestOrRepositoryMarkers(t *testing.T) {
	root := t.TempDir()
	for _, path := range []string{
		filepath.Join(root, "themes", "catalog.json"),
		filepath.Join(root, "apps", "theme-studio", "dist", "index.html"),
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if isInstallRoot(root, true) {
		t.Fatal("unmanifested production root was accepted")
	}
	if err := os.WriteFile(filepath.Join(root, "release-manifest.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !isInstallRoot(root, true) {
		t.Fatal("manifested production root was rejected")
	}
}

func TestRuntimeRejectsMissingAndCommandSpecificThemeOptions(t *testing.T) {
	dataRoot := t.TempDir()
	_, err := runRuntime(context.Background(), []string{"launch", "--data-root", dataRoot})
	if err == nil || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
		t.Fatalf("missing theme error = %v", err)
	}
	_, err = runRuntime(context.Background(), []string{
		"status", "--data-root", dataRoot, "--theme", "mountain-mist",
	})
	if err == nil || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
		t.Fatalf("status theme error = %v", err)
	}
}

func TestRuntimeThemeCommandsListAndImportWithoutController(t *testing.T) {
	repository := &runtimeThemeRepositoryStub{library: themerepo.Library{Themes: []themerepo.ListItem{{
		Ref: themerepo.Ref{ID: "mountain-mist", Version: "1.3.0"}, Name: "Mountain Mist",
	}}}}
	listed, err := executeRuntimeThemeCommand(runtimeThemeCommand{name: "list-themes"}, repository)
	if err != nil || len(listed.(themerepo.Library).Themes) != 1 {
		t.Fatalf("list result=%+v error=%v", listed, err)
	}

	archive := filepath.Join(t.TempDir(), "personal-theme.ocskin")
	if err := os.WriteFile(archive, []byte("archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := executeRuntimeThemeCommand(runtimeThemeCommand{name: "import", themeFile: archive}, repository)
	if err != nil || string(repository.imported) != "archive" {
		t.Fatalf("import result=%+v bytes=%q error=%v", imported, repository.imported, err)
	}
	result := imported.(map[string]any)["theme"].(themerepo.Ref)
	if result.ID != "personal-theme" || result.Version != "1.0.0" {
		t.Fatalf("imported ref=%+v", result)
	}
}

func TestRuntimeThemeCommandArgumentsAreFixed(t *testing.T) {
	if _, err := parseRuntimeThemeCommand([]string{"import"}); err == nil {
		t.Fatal("import without --theme-file was accepted")
	}
	if _, err := parseRuntimeThemeCommand([]string{"list-themes", "--theme-file", "theme.ocskin"}); err == nil {
		t.Fatal("list-themes with --theme-file was accepted")
	}
	if _, err := parseRuntimeThemeCommand([]string{"import", "--theme-file", "bad\x00path"}); err == nil {
		t.Fatal("theme file containing NUL was accepted")
	}
}

func TestPersonalRuntimeThemeRequiresExactVersion(t *testing.T) {
	builtins := []themerepo.Ref{{ID: "mountain-mist", Version: "1.3.0"}}
	if err := validateUnversionedRuntimeTheme("mountain-mist", builtins); err != nil {
		t.Fatalf("builtin rejected: %v", err)
	}
	if err := validateUnversionedRuntimeTheme("personal-theme", builtins); err == nil || ErrorCode(err) != "THEME_NOT_FOUND" {
		t.Fatalf("personal theme error=%v", err)
	}
}

func TestRuntimeCLIUnwrapsSuccessAndPreservesSafeRejection(t *testing.T) {
	result, err := runtimeCLIControlResult(control.Response{
		ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000001", OK: true,
		Result: json.RawMessage(`{"status":"active"}`),
	})
	if err != nil || result.(map[string]any)["status"] != "active" {
		t.Fatalf("success result=%+v error=%v", result, err)
	}
	_, err = runtimeCLIControlResult(control.Response{
		ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000002", OK: false,
		Error: &control.Error{Code: "THEME_CLEANUP_FAILED", Message: "cleanup rejected", NextAction: "Quit Codex and retry."},
	})
	if err == nil || ErrorCode(err) != "THEME_CLEANUP_FAILED" {
		t.Fatalf("rejection error=%v", err)
	}
	var output bytes.Buffer
	writeCLIError(&output, err)
	if !bytes.Contains(output.Bytes(), []byte(`"nextAction":"Quit Codex and retry."`)) {
		t.Fatalf("error output=%s", output.String())
	}
}

func TestStoppedRuntimeResponseUsesPublicStatusShape(t *testing.T) {
	response, err := stoppedRuntimeResponse("00000000-0000-4000-8000-000000000003")
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtimeCLIControlResult(response)
	status := result.(map[string]any)
	if err != nil || status["status"] != "stopped" || status["controllerAvailable"] != false {
		t.Fatalf("status=%+v error=%v", status, err)
	}
}

func TestStudioHealthUsesLoopbackAndRejectsUnauthenticatedAPI(t *testing.T) {
	studio := startTestStudio(t)
	var err error
	defer studio.Close()

	response, err := http.Get(studio.Origin + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d", response.StatusCode)
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Role != "studio" {
		t.Fatalf("health role = %q", body.Role)
	}

	missing, err := http.Get(studio.Origin + "/api/themes")
	if err != nil {
		t.Fatal(err)
	}
	defer missing.Body.Close()
	if missing.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated API status = %d, want 401", missing.StatusCode)
	}
}

func startTestStudio(t *testing.T) *studio.RunningServer {
	t.Helper()
	root := t.TempDir()
	themeDirectory := filepath.Join(root, "themes", "builtin", "mountain-mist")
	if err := os.MkdirAll(themeDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	catalog := `{"schemaVersion":1,"builtins":[{"id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","kind":"theme","path":"builtin/mountain-mist","ready":true,"localOnly":false,"licenseId":"LicenseRef-Test","preview":"builtin/mountain-mist/preview.webp"}],"recipes":[]}`
	theme := `{"schemaVersion":4,"kind":"theme","appearance":"light","id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","author":"OpenChatGPTSkin","assets":{"background":"assets/background.webp"},"colors":{},"typography":{},"background":{},"decorations":[],"layout":{},"rights":{"localOnly":false}}`
	if err := os.WriteFile(filepath.Join(root, "themes", "catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDirectory, "theme.json"), []byte(theme), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDirectory, "preview.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(themeDirectory, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDirectory, "assets", "background.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := studio.Start(context.Background(), studio.Config{
		IndexHTML: []byte(`<html><head><meta property="csp-nonce" nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"></head></html>`),
		ThemeRoot: filepath.Join(root, "themes"), DraftRoot: filepath.Join(root, "theme-studio-drafts"), StudioVersion: "0.3.0",
	})
	if err != nil {
		t.Fatal(err)
	}
	return server
}
