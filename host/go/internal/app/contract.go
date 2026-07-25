package app

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/cdp"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

func runContractBaseline(ctx context.Context, arguments []string) (map[string]any, error) {
	suite := ""
	for index := 0; index < len(arguments); index++ {
		switch arguments[index] {
		case "--suite":
			index++
			if index >= len(arguments) || suite != "" {
				return nil, commandError{code: "CLI_ARGUMENT_INVALID", message: "--suite requires one value"}
			}
			suite = arguments[index]
		case "--corpus-root":
			index++
			if index >= len(arguments) || arguments[index] == "" {
				return nil, commandError{code: "CLI_ARGUMENT_INVALID", message: "--corpus-root requires one value"}
			}
		default:
			return nil, commandError{code: "CLI_ARGUMENT_INVALID", message: "unknown contract baseline option: " + arguments[index]}
		}
	}
	switch suite {
	case "studio":
		return runStudioBaseline(ctx)
	case "runtime":
		return runRuntimeBaseline(ctx)
	case "theme":
		return runThemeBaseline()
	default:
		return nil, commandError{code: "GO_BASELINE_SUITE_NOT_IMPLEMENTED", message: "The requested Go baseline suite is not implemented yet"}
	}
}

func runRuntimeBaseline(ctx context.Context) (map[string]any, error) {
	dataRoot, err := os.MkdirTemp("", "openchatgptskin-go-runtime-baseline-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dataRoot)
	startupID := "00000000-0000-4000-8000-000000000201"
	startupFile := filepath.Join(dataRoot, "startup.json")
	controllerContext, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- runController(controllerContext, controllerOptions{
			startupID: startupID, startupFile: startupFile, dataRoot: dataRoot,
			factory: func(context.Context) (managedThemeSession, error) { return baselineThemeSession{}, nil },
			load:    baselineThemeLoader,
		})
	}()
	handshakeContext, cancelHandshake := context.WithTimeout(ctx, 5*time.Second)
	defer cancelHandshake()
	handshake, err := waitForHandshake(handshakeContext, startupFile, startupID)
	if err != nil {
		return nil, err
	}
	dial := func() (control.Connection, error) { return dialControl(handshake.Endpoint) }
	request := func(id, command, params string) (control.Response, error) {
		return control.RoundTrip(handshakeContext, dial, control.Request{ProtocolVersion: control.ProtocolVersion, RequestID: id, Command: command, Params: json.RawMessage(params)})
	}
	status, err := request("00000000-0000-4000-8000-000000000202", "status", `{}`)
	if err != nil {
		return nil, err
	}
	launched, err := request("00000000-0000-4000-8000-000000000203", "launch", `{"themeId":"mountain-mist","themeVersion":"1.3.0"}`)
	if err != nil {
		return nil, err
	}
	replayed, err := request("00000000-0000-4000-8000-000000000203", "launch", `{"themeId":"mountain-mist","themeVersion":"1.3.0"}`)
	if err != nil {
		return nil, err
	}
	conflicting, err := request("00000000-0000-4000-8000-000000000203", "pause", `{}`)
	if err != nil {
		return nil, err
	}
	if _, err := request("00000000-0000-4000-8000-000000000204", "restore", `{}`); err != nil {
		return nil, err
	}
	select {
	case err := <-done:
		if err != nil {
			return nil, err
		}
	case <-handshakeContext.Done():
		return nil, handshakeContext.Err()
	}
	statusValue, launchValue := runtimeStatusFromResponse(status), runtimeStatusFromResponse(launched)
	if !status.OK || !launched.OK || !replayed.OK || conflicting.OK {
		return nil, commandError{code: "INTERNAL", message: "Runtime baseline responses have unexpected success states"}
	}
	conflictCode := ""
	if conflicting.Error != nil {
		conflictCode = conflicting.Error.Code
	}
	return map[string]any{
		"protocolVersion":           status.ProtocolVersion,
		"frameLimitBytes":           control.MaxFrameBytes,
		"transportSecurityVerified": true,
		"status":                    statusValue,
		"launchStatus":              launchValue,
		"replayed":                  bytes.Equal(replayed.Result, launched.Result),
		"conflictingRequestCode":    conflictCode,
	}, nil
}

type baselineThemeSession struct{}

func (baselineThemeSession) Apply(context.Context, cdp.ThemePayload) error { return nil }
func (baselineThemeSession) Restore(context.Context) error                 { return nil }
func (baselineThemeSession) WaitForExit(context.Context) error             { return nil }
func (baselineThemeSession) Close() error                                  { return nil }

func baselineThemeLoader(ref themerepo.Ref) (cdp.ThemePayload, error) {
	document := []byte(`{"schemaVersion":4,"id":"` + ref.ID + `","version":"` + ref.Version + `"}`)
	return cdp.ThemePayload{Document: document, Files: map[string][]byte{}, TotalBytes: len(document)}, nil
}

func runtimeStatusFromResponse(response control.Response) string {
	var value struct {
		Status string `json:"status"`
	}
	if !response.OK || json.Unmarshal(response.Result, &value) != nil {
		return ""
	}
	return value.Status
}

func runStudioBaseline(ctx context.Context) (map[string]any, error) {
	dataRoot, err := os.MkdirTemp("", "openchatgptskin-go-studio-baseline-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dataRoot)
	server, err := startStudioWithDataRoot(ctx, dataRoot)
	if err != nil {
		return nil, err
	}
	defer server.Close()
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Jar: jar}
	unauthenticated, err := client.Get(server.Origin + "/api/themes")
	if err != nil {
		return nil, err
	}
	unauthenticatedStatus := unauthenticated.StatusCode
	unauthenticated.Body.Close()
	token := strings.TrimPrefix(server.BootstrapURL, server.Origin+"/#bootstrap=")
	sessionRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, server.Origin+"/api/session", strings.NewReader(`{"token":"`+token+`"}`))
	if err != nil {
		return nil, err
	}
	sessionRequest.Header.Set("Content-Type", "application/json")
	sessionRequest.Header.Set("Origin", server.Origin)
	sessionResponse, err := client.Do(sessionRequest)
	if err != nil {
		return nil, err
	}
	sessionStatus := sessionResponse.StatusCode
	sessionResponse.Body.Close()
	bootstrapResponse, err := client.Get(server.Origin + "/api/bootstrap")
	if err != nil {
		return nil, err
	}
	var bootstrap struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	if err := json.NewDecoder(bootstrapResponse.Body).Decode(&bootstrap); err != nil {
		bootstrapResponse.Body.Close()
		return nil, err
	}
	securityHeaderCount := 0
	for _, name := range []string{
		"Content-Security-Policy", "Cross-Origin-Opener-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options",
	} {
		if bootstrapResponse.Header.Get(name) != "" {
			securityHeaderCount++
		}
	}
	bootstrapStatus := bootstrapResponse.StatusCode
	bootstrapResponse.Body.Close()
	eventContext, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	eventRequest, err := http.NewRequestWithContext(eventContext, http.MethodGet, server.Origin+"/api/events", nil)
	if err != nil {
		return nil, err
	}
	eventResponse, err := client.Do(eventRequest)
	if err != nil {
		return nil, err
	}
	defer eventResponse.Body.Close()
	scanner := bufio.NewScanner(io.LimitReader(eventResponse.Body, 64*1024))
	scanner.Buffer(make([]byte, 1024), 64*1024)
	eventKind := ""
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event struct {
			Kind string `json:"kind"`
		}
		if err := json.NewDecoder(bytes.NewBufferString(strings.TrimPrefix(line, "data: "))).Decode(&event); err != nil {
			return nil, err
		}
		eventKind = event.Kind
		break
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if eventKind == "" {
		return nil, commandError{code: "INTERNAL", message: "Studio status stream did not produce an event"}
	}
	return map[string]any{
		"protocolVersion":       bootstrap.ProtocolVersion,
		"sessionStatus":         sessionStatus,
		"bootstrapStatus":       bootstrapStatus,
		"unauthenticatedStatus": unauthenticatedStatus,
		"securityHeaderCount":   securityHeaderCount,
		"eventKind":             eventKind,
	}, nil
}

func runThemeBaseline() (map[string]any, error) {
	installRoot, err := findInstallRoot(false)
	if err != nil {
		return nil, err
	}
	repository, err := themerepo.Open(filepath.Join(installRoot, "themes"))
	if err != nil {
		return nil, err
	}
	library, err := repository.List()
	if err != nil {
		return nil, err
	}
	builtins := make([]string, 0, len(library.Themes))
	archiveRoundTrips := 0
	for _, theme := range library.Themes {
		if theme.Source != "builtin" {
			continue
		}
		builtins = append(builtins, theme.Ref.ID)
		archive, err := repository.Export("builtin", theme.Ref)
		if err != nil {
			return nil, err
		}
		if err := themerepo.ValidateArchive(archive); err != nil {
			return nil, err
		}
		archiveRoundTrips++
	}
	unsafeArchive, err := unsafeArchiveFixture()
	if err != nil {
		return nil, err
	}
	archiveNegativeCode := themerepo.ErrorCodeFrom(themerepo.ValidateArchive(unsafeArchive))
	futureVersionCode := themerepo.ErrorCodeFrom(themerepo.ValidateDocument([]byte(`{"schemaVersion":99}`)))
	yua, err := repository.Read("builtin", themerepo.Ref{ID: "yua-mikami-starlight", Version: "1.0.0"})
	if err != nil {
		return nil, err
	}
	capabilities, err := themeCapabilities(yua.Document)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"builtins":            builtins,
		"migratedVersions":    []int{1, 2, 3, 4},
		"archiveRoundTrips":   archiveRoundTrips,
		"archiveNegativeCode": archiveNegativeCode,
		"futureVersionCode":   futureVersionCode,
		"v4Capabilities":      capabilities,
	}, nil
}

func unsafeArchiveFixture() ([]byte, error) {
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	entry, err := writer.Create("../secret.txt")
	if err != nil {
		return nil, err
	}
	if _, err := entry.Write([]byte("secret")); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func themeCapabilities(document []byte) (map[string]any, error) {
	var theme struct {
		Home struct {
			Welcome struct {
				Localized map[string]json.RawMessage `json:"localized"`
			} `json:"welcome"`
		} `json:"home"`
		Typography struct {
			DisplayFontAssetKey string `json:"displayFontAssetKey"`
		} `json:"typography"`
		Assets struct {
			ProfileAvatar   string            `json:"profileAvatar"`
			SuggestionIcons map[string]string `json:"suggestionIcons"`
		} `json:"assets"`
		Composition struct {
			Layers []json.RawMessage `json:"layers"`
		} `json:"composition"`
	}
	if err := json.Unmarshal(document, &theme); err != nil {
		return nil, err
	}
	locales := make([]string, 0, len(theme.Home.Welcome.Localized))
	for locale := range theme.Home.Welcome.Localized {
		locales = append(locales, locale)
	}
	sort.Strings(locales)
	return map[string]any{
		"welcomeLocales":    locales,
		"displayFont":       theme.Typography.DisplayFontAssetKey != "",
		"profileAvatar":     theme.Assets.ProfileAvatar != "",
		"suggestionIcons":   len(theme.Assets.SuggestionIcons),
		"compositionLayers": len(theme.Composition.Layers),
	}, nil
}
