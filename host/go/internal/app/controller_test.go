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

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
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
}

func TestControllerStateMachinePersistsAndRequiresRecoveryAfterCrash(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "runtime-session.json")
	model, err := loadControllerModel(statePath)
	if err != nil {
		t.Fatal(err)
	}
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
