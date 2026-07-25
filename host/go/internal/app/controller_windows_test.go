//go:build windows

package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFailedControllerListenLeavesNoOwnedLock(t *testing.T) {
	dataRoot := t.TempDir()
	listener, err := listenControl(controlEndpoint(dataRoot))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	startupFile := filepath.Join(dataRoot, "startup.json")
	err = runController(context.Background(), controllerOptions{
		startupID:   "00000000-0000-4000-8000-000000000505",
		startupFile: startupFile,
		dataRoot:    dataRoot,
	})
	if err == nil {
		t.Fatal("controller unexpectedly listened on an occupied endpoint")
	}
	if _, statErr := os.Stat(filepath.Join(dataRoot, "controller.lock")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("failed startup left lock: %v", statErr)
	}
}

func TestWindowsProcessIdentityIncludesCreationTime(t *testing.T) {
	pid, startedAt, err := currentProcessIdentity()
	if err != nil {
		t.Fatal(err)
	}
	if !processAlive(pid, startedAt) {
		t.Fatal("current process identity was not recognized")
	}
	if processAlive(pid, startedAt+"-changed") {
		t.Fatal("PID-only match accepted a changed creation time")
	}
}

func TestWindowsStartupHandshakeRetriesOnlySharingViolations(t *testing.T) {
	sharing := &os.PathError{Op: "open", Path: "startup.json", Err: windowsSharingViolation}
	if !transientStartupReadError(sharing) {
		t.Fatal("sharing violation was not treated as transient")
	}
	if transientStartupReadError(os.ErrPermission) {
		t.Fatal("permission denial was treated as transient")
	}
}
