package persistence

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLockOwnershipAndStaleReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "controller.lock")
	first := Identity{PID: 101, StartedAt: "2026-07-24T00:00:00Z"}
	lock, err := Acquire(path, first, func(pid int, startedAt string) bool {
		return pid == first.PID && startedAt == first.StartedAt
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Acquire(path, Identity{PID: 102, StartedAt: first.StartedAt}, func(pid int, startedAt string) bool {
		return pid == first.PID && startedAt == first.StartedAt
	}); !IsBusy(err) {
		t.Fatalf("second acquire error = %v, want busy", err)
	}
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}

	stale, err := Acquire(path, first, func(int, string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if err := stale.Release(); err != nil {
		t.Fatal(err)
	}
}

func TestLockDoesNotDeleteReplacementOwner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "controller.lock")
	identity := Identity{PID: 201, StartedAt: "2026-07-24T00:00:00Z"}
	lock, err := Acquire(path, identity, func(int, string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	replacement := Identity{SchemaVersion: 1, PID: 202, StartedAt: identity.StartedAt}
	contents, err := json.Marshal(replacement)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(contents, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := lock.Release(); err == nil {
		t.Fatal("old owner deleted a replacement lock")
	}
}

func TestAcquirePreservesUnrecognizedLockEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "controller.lock")
	contents := []byte(`{"schemaVersion":99,"pid":301,"startedAt":"2026-07-24T00:00:00Z"}`)
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Acquire(path, Identity{PID: 302, StartedAt: "2026-07-24T00:00:00Z"}, func(int, string) bool {
		return false
	}); err == nil {
		t.Fatal("unrecognized lock schema was replaced")
	}
	preserved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(preserved) != string(contents) {
		t.Fatalf("unrecognized lock evidence changed: %q", preserved)
	}
}
