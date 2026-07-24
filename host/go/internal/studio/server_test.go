package studio

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

func studioFixture(t *testing.T) Config {
	t.Helper()
	root := t.TempDir()
	themeDirectory := filepath.Join(root, "themes", "builtin", "mountain-mist")
	if err := os.MkdirAll(themeDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	catalog := `{"schemaVersion":1,"builtins":[{"id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","kind":"theme","path":"builtin/mountain-mist","ready":true,"localOnly":false,"licenseId":"LicenseRef-Test","preview":"builtin/mountain-mist/preview.webp"}],"recipes":[]}`
	theme := `{"schemaVersion":4,"kind":"theme","appearance":"light","id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","author":"OpenChatGPTSkin","rights":{"localOnly":false}}`
	if err := os.WriteFile(filepath.Join(root, "themes", "catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDirectory, "theme.json"), []byte(theme), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDirectory, "preview.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
	return Config{
		IndexHTML: []byte(`<html><head><meta property="csp-nonce" nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"></head><body><script nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"></script></body></html>`),
		ThemeRoot: filepath.Join(root, "themes"), StudioVersion: "0.2.0",
	}
}

func sessionClient(t *testing.T, server *RunningServer) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}
	request, err := http.NewRequest(http.MethodPost, server.Origin+"/api/session", strings.NewReader(`{"token":"`+strings.TrimPrefix(server.BootstrapURL, server.Origin+"/#bootstrap=")+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", server.Origin)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("session status = %d", response.StatusCode)
	}
	return client
}

func TestStudioServesOnlyLoopbackSecureSessionAndThemeLibrary(t *testing.T) {
	server, err := Start(context.Background(), studioFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	response, err := http.Get(server.Origin + "/")
	if err != nil {
		t.Fatal(err)
	}
	contents, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.Header.Get("Content-Security-Policy") == "" || strings.Contains(string(contents), cspNoncePlaceholder) {
		t.Fatal("production UI has no complete CSP nonce")
	}
	client := sessionClient(t, server)
	libraryResponse, err := client.Get(server.Origin + "/api/themes")
	if err != nil {
		t.Fatal(err)
	}
	defer libraryResponse.Body.Close()
	if libraryResponse.StatusCode != http.StatusOK {
		t.Fatalf("theme library status = %d", libraryResponse.StatusCode)
	}
	var library themerepo.Library
	if err := json.NewDecoder(libraryResponse.Body).Decode(&library); err != nil {
		t.Fatal(err)
	}
	if len(library.Themes) != 1 || library.Themes[0].PreviewURL == nil {
		t.Fatalf("library = %+v", library)
	}
}

func TestStudioRejectsReplayCrossOriginAndUnauthenticatedAPI(t *testing.T) {
	server, err := Start(context.Background(), studioFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	response, err := http.Get(server.Origin + "/api/themes")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", response.StatusCode)
	}
	token := strings.TrimPrefix(server.BootstrapURL, server.Origin+"/#bootstrap=")
	request, err := http.NewRequest(http.MethodPost, server.Origin+"/api/session", strings.NewReader(`{"token":"`+token+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "http://127.0.0.1:1")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d", response.StatusCode)
	}
	_ = sessionClient(t, server)
	request, err = http.NewRequest(http.MethodPost, server.Origin+"/api/session", strings.NewReader(`{"token":"`+token+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", server.Origin)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed session status = %d", response.StatusCode)
	}
}

func TestStudioDevProxyAcceptsOnlyLoopbackAndDoesNotForwardSessionState(t *testing.T) {
	for _, origin := range []string{
		"https://127.0.0.1:5173", "http://example.com:5173", "http://127.0.0.1", "http://127.0.0.1:5173/path",
	} {
		if _, err := validateViteOrigin(origin); err == nil {
			t.Fatalf("invalid Vite origin was accepted: %s", origin)
		}
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Cookie") != "" || request.Header.Get("Authorization") != "" || request.Header.Get("Origin") != "" {
			t.Fatal("Studio session state was forwarded to Vite")
		}
		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = response.Write([]byte("<html><head></head><body>Vite</body></html>"))
	}))
	defer upstream.Close()
	config := studioFixture(t)
	config.IndexHTML = nil
	config.ViteOrigin = upstream.URL
	server, err := Start(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	response, err := http.Get(server.Origin + "/")
	if err != nil {
		t.Fatal(err)
	}
	contents, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(string(contents), `property="csp-nonce"`) {
		t.Fatalf("dev proxy response = %d %s", response.StatusCode, contents)
	}
	api, err := http.Get(server.Origin + "/api/themes")
	if err != nil {
		t.Fatal(err)
	}
	api.Body.Close()
	if api.StatusCode != http.StatusUnauthorized {
		t.Fatalf("API was forwarded to Vite: %d", api.StatusCode)
	}
}
