//go:build darwin

package macos

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
)

func shortSocketEndpoint(t *testing.T) string {
	t.Helper()
	directory, err := os.MkdirTemp("/tmp", "ocskin-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(directory) })
	return filepath.Join(directory, "runtime.sock")
}

func TestUnixSocketRoundTripAndPermissions(t *testing.T) {
	endpoint := shortSocketEndpoint(t)
	listener, err := Listen(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	info, err := os.Stat(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
	dispatcher := control.NewDispatcher(func(_ context.Context, request control.Request) (control.Result, error) {
		return control.Result{"command": request.Command}, nil
	})
	serverDone := make(chan error, 1)
	go func() { serverDone <- control.ServeOne(context.Background(), listener, dispatcher) }()
	response, err := control.RoundTrip(context.Background(), func() (control.Connection, error) {
		return Dial(endpoint)
	}, control.Request{ProtocolVersion: 1, RequestID: "00000000-0000-4000-8000-000000000406", Command: "status", Params: []byte(`{}`)})
	if err != nil || !response.OK {
		t.Fatalf("response=%+v error=%v", response, err)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestUnixSocketRefusesUnsafeStartupPath(t *testing.T) {
	endpoint := shortSocketEndpoint(t)
	if err := os.WriteFile(endpoint, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if listener, err := Listen(endpoint); err == nil {
		listener.Close()
		t.Fatal("regular file was replaced by a unix socket")
	}
	contents, err := os.ReadFile(endpoint)
	if err != nil || string(contents) != "keep" {
		t.Fatalf("unsafe startup path changed: contents=%q error=%v", contents, err)
	}
}

func TestUnixSocketClosePreservesReplacementInode(t *testing.T) {
	endpoint := shortSocketEndpoint(t)
	listener, err := Listen(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(endpoint); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(endpoint, []byte("replacement"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(endpoint)
	if err != nil || string(contents) != "replacement" {
		t.Fatalf("replacement inode changed: contents=%q error=%v", contents, err)
	}
}

func TestEndpointStaysShortForLongDataRoot(t *testing.T) {
	dataRoot := filepath.Join(t.TempDir(), strings.Repeat("long-data-root-", 20))
	endpoint := Endpoint(dataRoot)
	if len([]byte(endpoint)) > 80 {
		t.Fatalf("endpoint is too long for a Unix socket: %q", endpoint)
	}
	if endpoint != Endpoint(dataRoot) {
		t.Fatalf("endpoint is not deterministic: %q", endpoint)
	}
	if endpoint == Endpoint(dataRoot+"-other") {
		t.Fatalf("endpoint does not isolate data roots: %q", endpoint)
	}
	wantDirectory := filepath.Join("/tmp", fmt.Sprintf("ocskin-%d", os.Getuid()))
	if filepath.Dir(endpoint) != wantDirectory {
		t.Fatalf("endpoint directory = %q, want %q", filepath.Dir(endpoint), wantDirectory)
	}
	listener, err := Listen(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestUnixSocketRefusesNonPrivateParentDirectory(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "not-private")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if listener, err := Listen(filepath.Join(directory, "runtime.sock")); err == nil {
		listener.Close()
		t.Fatal("listener started in a non-private directory")
	}
}
