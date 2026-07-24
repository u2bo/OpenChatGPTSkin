package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/studio"
)

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

func TestStudioDevRequiresAnExplicitLoopbackOrigin(t *testing.T) {
	if _, err := parseStudioOptions([]string{"--dev"}); err == nil {
		t.Fatal("--dev without a Vite origin was accepted")
	}
	options, err := parseStudioOptions([]string{"--dev", "--vite-origin", "http://127.0.0.1:5173", "--no-open"})
	if err != nil || options.viteOrigin != "http://127.0.0.1:5173" || !options.noOpen {
		t.Fatalf("studio dev options = %+v error=%v", options, err)
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
		ThemeRoot: filepath.Join(root, "themes"), DraftRoot: filepath.Join(root, "theme-studio-drafts"), StudioVersion: "0.3.0-alpha.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return server
}
