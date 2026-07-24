//go:build darwin

package macos

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
)

func TestUnixSocketRoundTripAndPermissions(t *testing.T) {
	endpoint := filepath.Join(t.TempDir(), "runtime.sock")
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
	endpoint := filepath.Join(t.TempDir(), "runtime.sock")
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
	endpoint := filepath.Join(t.TempDir(), "runtime.sock")
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
