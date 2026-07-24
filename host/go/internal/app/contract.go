package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"
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
	if suite != "studio" {
		return nil, commandError{code: "GO_BASELINE_SUITE_NOT_IMPLEMENTED", message: "The requested Go baseline suite is not implemented yet"}
	}
	return runStudioBaseline(ctx)
}

func runStudioBaseline(ctx context.Context) (map[string]any, error) {
	server, err := StartStudio(ctx)
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
