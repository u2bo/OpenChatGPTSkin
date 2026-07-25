package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/cdp"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

func TestStudioCloseDoesNotEndControllerAndControllerCleansItsLock(t *testing.T) {
	dataRoot := t.TempDir()
	startupID := "00000000-0000-4000-8000-000000000501"
	startupFile := filepath.Join(dataRoot, "startup.json")
	controllerDone := make(chan error, 1)
	go func() {
		controllerDone <- runController(context.Background(), controllerOptions{
			startupID:   startupID,
			startupFile: startupFile,
			dataRoot:    dataRoot,
			once:        true,
		})
	}()
	waitContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	handshake, err := waitForHandshake(waitContext, startupFile, startupID)
	if err != nil {
		t.Fatal(err)
	}

	studio := startTestStudio(t)
	if err := studio.Close(); err != nil {
		t.Fatal(err)
	}
	requestID := "00000000-0000-4000-8000-000000000502"
	response, err := control.RoundTrip(waitContext, func() (control.Connection, error) {
		return dialControl(handshake.Endpoint)
	}, control.Request{ProtocolVersion: 1, RequestID: requestID, Command: "status", Params: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK {
		t.Fatalf("controller response = %+v", response)
	}
	if err := <-controllerDone; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataRoot, "controller.lock")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("controller lock remains: %v", err)
	}
}

func TestRestoreRespondsBeforeControllerTerminalCleanup(t *testing.T) {
	dataRoot := t.TempDir()
	startupID := "00000000-0000-4000-8000-000000000503"
	startupFile := filepath.Join(dataRoot, "startup.json")
	controllerDone := make(chan error, 1)
	go func() {
		controllerDone <- runController(context.Background(), controllerOptions{
			startupID:   startupID,
			startupFile: startupFile,
			dataRoot:    dataRoot,
		})
	}()
	waitContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	handshake, err := waitForHandshake(waitContext, startupFile, startupID)
	if err != nil {
		t.Fatal(err)
	}
	response, err := control.RoundTrip(waitContext, func() (control.Connection, error) {
		return dialControl(handshake.Endpoint)
	}, control.Request{
		ProtocolVersion: 1,
		RequestID:       "00000000-0000-4000-8000-000000000504",
		Command:         "restore",
		Params:          json.RawMessage(`{}`),
	})
	if err != nil || !response.OK {
		t.Fatalf("restore response=%+v error=%v", response, err)
	}
	select {
	case err := <-controllerDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-waitContext.Done():
		t.Fatal("controller did not exit after terminal restore")
	}
	if _, err := os.Stat(filepath.Join(dataRoot, "controller.lock")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("controller lock remains after restore: %v", err)
	}
	model, err := loadControllerModel(filepath.Join(dataRoot, "runtime-session.json"))
	if err != nil {
		t.Fatal(err)
	}
	if model.status != "stopped" {
		t.Fatalf("restored state=%q", model.status)
	}
}

func TestManagedExitPersistsStoppedState(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "runtime-session.json")
	model := &controllerModel{status: "restored-awaiting-exit", state: statePath, session: testThemeSession{}}
	if err := model.markManagedExit(); err != nil {
		t.Fatal(err)
	}
	reloaded, err := loadControllerModel(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.status != "stopped" || reloaded.session != nil || !model.terminal {
		t.Fatalf("state=%q session=%v terminal=%v", reloaded.status, reloaded.session, model.terminal)
	}
}

func TestControllerStateMachinePersistsAndRequiresRecoveryAfterCrash(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "runtime-session.json")
	model, err := loadControllerModel(statePath)
	if err != nil {
		t.Fatal(err)
	}
	model.factory = func(context.Context) (managedThemeSession, error) { return testThemeSession{}, nil }
	model.load = testThemeLoader
	dispatcher := newControllerDispatcher(model)
	launch := dispatcher.Dispatch(context.Background(), control.Request{
		ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000506", Command: "launch",
		Params: json.RawMessage(`{"themeId":"mountain-mist","themeVersion":"1.3.0"}`),
	})
	if !launch.OK {
		t.Fatalf("launch response = %+v", launch)
	}
	invalid := dispatcher.Dispatch(context.Background(), control.Request{
		ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000507", Command: "launch",
		Params: json.RawMessage(`{"themeId":"mountain-mist","themeVersion":"1.3.0"}`),
	})
	if invalid.OK || invalid.Error == nil || invalid.Error.Code != "RUNTIME_INVALID_TRANSITION" {
		t.Fatalf("invalid transition = %+v", invalid)
	}
	recovered, err := loadControllerModel(statePath)
	if err != nil {
		t.Fatal(err)
	}
	recoveryStatus := newControllerDispatcher(recovered).Dispatch(context.Background(), control.Request{
		ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000508", Command: "status", Params: json.RawMessage(`{}`),
	})
	if !recoveryStatus.OK || !bytes.Contains(recoveryStatus.Result, []byte(`"recovery-required"`)) {
		t.Fatalf("recovery status = %+v", recoveryStatus)
	}
}

func TestFailedThemeLaunchRespondsThenReleasesControllerLock(t *testing.T) {
	dataRoot := t.TempDir()
	startupID := "00000000-0000-4000-8000-000000000509"
	startupFile := filepath.Join(dataRoot, "startup.json")
	controllerDone := make(chan error, 1)
	go func() {
		controllerDone <- runController(context.Background(), controllerOptions{
			startupID: startupID, startupFile: startupFile, dataRoot: dataRoot,
			factory: func(context.Context) (managedThemeSession, error) {
				return nil, errors.New("platform launch failed")
			},
			load: testThemeLoader,
		})
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	handshake, err := waitForHandshake(ctx, startupFile, startupID)
	if err != nil {
		t.Fatal(err)
	}
	response, err := control.RoundTrip(ctx, func() (control.Connection, error) {
		return dialControl(handshake.Endpoint)
	}, control.Request{
		ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000510", Command: "launch",
		Params: json.RawMessage(`{"themeId":"mountain-mist","themeVersion":"1.3.0"}`),
	})
	if err != nil || response.OK || response.Error == nil || response.Error.Code != "THEME_APPLY_FAILED" {
		t.Fatalf("launch response=%+v error=%v", response, err)
	}
	select {
	case err := <-controllerDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("failed Controller did not terminate")
	}
	if _, err := os.Stat(filepath.Join(dataRoot, "controller.lock")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed Controller lock remains: %v", err)
	}
}

func TestRuntimeCommandErrorPreservesControlError(t *testing.T) {
	err := runtimeCommandError(control.CommandError{Code: "THEME_APPLY_FAILED", Message: "Theme payload identity is invalid"}, "INTERNAL")
	var commandError control.CommandError
	if !errors.As(err, &commandError) || commandError.Code != "THEME_APPLY_FAILED" || commandError.Message != "Theme payload identity is invalid" {
		t.Fatalf("error=%+v", err)
	}
}

func TestCleanupThemeSessionAttemptsRestoreAndClose(t *testing.T) {
	restoreErr := errors.New("restore failed")
	closeErr := errors.New("close failed")
	session := &cleanupTrackingSession{restoreErr: restoreErr, closeErr: closeErr}
	err := cleanupThemeSession(context.Background(), session)
	if !session.restored || !session.closed || !errors.Is(err, restoreErr) || !errors.Is(err, closeErr) {
		t.Fatalf("restored=%v closed=%v error=%v", session.restored, session.closed, err)
	}
}

type cleanupTrackingSession struct {
	restored   bool
	closed     bool
	restoreErr error
	closeErr   error
}

func (*cleanupTrackingSession) Apply(context.Context, cdp.ThemePayload) error { return nil }
func (session *cleanupTrackingSession) Restore(context.Context) error {
	session.restored = true
	return session.restoreErr
}
func (*cleanupTrackingSession) WaitForExit(context.Context) error { return nil }
func (session *cleanupTrackingSession) Close() error {
	session.closed = true
	return session.closeErr
}

type testThemeSession struct{}

func (testThemeSession) Apply(context.Context, cdp.ThemePayload) error { return nil }
func (testThemeSession) Restore(context.Context) error                 { return nil }
func (testThemeSession) WaitForExit(context.Context) error             { return nil }
func (testThemeSession) Close() error                                  { return nil }

func testThemeLoader(ref themerepo.Ref) (cdp.ThemePayload, error) {
	document := []byte(`{"schemaVersion":4,"id":"` + ref.ID + `","version":"` + ref.Version + `"}`)
	return cdp.ThemePayload{Document: document, Files: map[string][]byte{}, TotalBytes: len(document)}, nil
}
