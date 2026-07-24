//go:build windows

package windows

import (
	"context"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
)

func TestNamedPipeRoundTrip(t *testing.T) {
	endpoint := TestEndpoint(t.Name())
	listener, err := Listen(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	dispatcher := control.NewDispatcher(func(_ context.Context, request control.Request) (control.Result, error) {
		return control.Result{"command": request.Command}, nil
	})
	serverDone := make(chan error, 1)
	go func() { serverDone <- control.ServeOne(context.Background(), listener, dispatcher) }()
	response, err := control.RoundTrip(context.Background(), func() (control.Connection, error) {
		return Dial(endpoint)
	}, control.Request{
		ProtocolVersion: 1,
		RequestID:       "00000000-0000-4000-8000-000000000405",
		Command:         "status",
		Params:          []byte(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK {
		t.Fatalf("response = %+v", response)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}
