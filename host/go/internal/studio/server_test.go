package studio

import (
	"bytes"
	"context"
	"encoding/json"
	stdimage "image"
	"image/color"
	"image/png"
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
	if err := os.WriteFile(filepath.Join(themeDirectory, "assets", "background.webp"), fixturePNG(t), 0o600); err != nil {
		t.Fatal(err)
	}
	return Config{
		IndexHTML: []byte(`<html><head><meta property="csp-nonce" nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"></head><body><script nonce="__OPEN_CHATGPT_SKIN_CSP_NONCE__"></script></body></html>`),
		ThemeRoot: filepath.Join(root, "themes"), PersonalRoot: filepath.Join(root, "theme-store"), DraftRoot: filepath.Join(root, "theme-studio-drafts"), StudioVersion: "0.2.0",
	}
}

func fixturePNG(t *testing.T) []byte {
	t.Helper()
	image := stdimage.NewNRGBA(stdimage.Rect(0, 0, 8, 4))
	image.SetNRGBA(1, 1, color.NRGBA{R: 80, G: 120, B: 255, A: 255})
	var output bytes.Buffer
	if err := png.Encode(&output, image); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
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
		_, _ = response.Write([]byte(`<html><head><script type="module">window.__vite_inline = true</script><script nonce="existing">window.__vite_existing = true</script></head><body>Vite</body></html>`))
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
	if response.StatusCode != http.StatusOK || !strings.Contains(string(contents), `property="csp-nonce"`) ||
		!strings.Contains(string(contents), `<script type="module" nonce="`) ||
		strings.Count(string(contents), `nonce="existing"`) != 1 {
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

func TestStudioDraftRoutesPersistAndExportPersonalVersion(t *testing.T) {
	server, err := Start(context.Background(), studioFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client := sessionClient(t, server)
	create, err := http.NewRequest(http.MethodPost, server.Origin+"/api/drafts", strings.NewReader(`{"source":{"source":"builtin","ref":{"id":"mountain-mist","version":"1.3.0"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	create.Header.Set("Origin", server.Origin)
	create.Header.Set("Content-Type", "application/json")
	response, err := client.Do(create)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusCreated {
		response.Body.Close()
		t.Fatalf("create status = %d", response.StatusCode)
	}
	var created struct {
		DraftID  string `json:"draftId"`
		Revision int    `json:"revision"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		response.Body.Close()
		t.Fatal(err)
	}
	response.Body.Close()
	save, err := http.NewRequest(http.MethodPost, server.Origin+"/api/drafts/"+created.DraftID+"/save", strings.NewReader(`{"expectedRevision":0}`))
	if err != nil {
		t.Fatal(err)
	}
	save.Header.Set("Origin", server.Origin)
	save.Header.Set("Content-Type", "application/json")
	response, err = client.Do(save)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		t.Fatalf("save status = %d", response.StatusCode)
	}
	var saved struct {
		Ref themerepo.Ref `json:"ref"`
	}
	if err := json.NewDecoder(response.Body).Decode(&saved); err != nil {
		response.Body.Close()
		t.Fatal(err)
	}
	response.Body.Close()
	if saved.Ref != (themerepo.Ref{ID: "mountain-mist-custom", Version: "1.0.0"}) {
		t.Fatalf("saved ref = %+v", saved.Ref)
	}
	response, err = client.Get(server.Origin + "/api/export?id=" + saved.Ref.ID + "&version=" + saved.Ref.Version)
	if err != nil {
		t.Fatal(err)
	}
	archive, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || len(archive) == 0 || response.Header.Get("Content-Type") != "application/vnd.open-chatgpt-skin+zip" {
		t.Fatalf("export status=%d bytes=%d type=%q", response.StatusCode, len(archive), response.Header.Get("Content-Type"))
	}
}

func TestStudioAppliesOnlySavedThemeAndReturnsRuntimeStatus(t *testing.T) {
	config := studioFixture(t)
	applied := themerepo.Ref{}
	config.ApplyTheme = func(_ context.Context, ref themerepo.Ref) (RuntimeStatus, error) {
		applied = ref
		active := true
		return RuntimeStatus{Status: "active", ControllerAvailable: true, SelectedTheme: &ref, AppliedTheme: &ref, SkinApplied: &active, NextAction: "Theme is active."}, nil
	}
	config.RestoreTheme = func(context.Context) (RuntimeStatus, error) {
		active := false
		return RuntimeStatus{Status: "restored-awaiting-exit", ControllerAvailable: true, SkinApplied: &active, NextAction: "Waiting for normal exit."}, nil
	}
	server, err := Start(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client := sessionClient(t, server)
	apply, err := http.NewRequest(http.MethodPost, server.Origin+"/api/themes/apply", strings.NewReader(`{"id":"mountain-mist","version":"1.3.0"}`))
	if err != nil {
		t.Fatal(err)
	}
	apply.Header.Set("Origin", server.Origin)
	apply.Header.Set("Content-Type", "application/json")
	response, err := client.Do(apply)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || applied != (themerepo.Ref{ID: "mountain-mist", Version: "1.3.0"}) {
		t.Fatalf("apply status=%d ref=%+v", response.StatusCode, applied)
	}
	var runtime RuntimeStatus
	if err := json.NewDecoder(response.Body).Decode(&runtime); err != nil || runtime.Status != "active" || runtime.SkinApplied == nil || !*runtime.SkinApplied {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
	restore, err := http.NewRequest(http.MethodPost, server.Origin+"/api/runtime/restore", nil)
	if err != nil {
		t.Fatal(err)
	}
	restore.Header.Set("Origin", server.Origin)
	response, err = client.Do(restore)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("restore status=%d", response.StatusCode)
	}
}
