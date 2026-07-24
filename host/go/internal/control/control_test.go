package control

import (
	"context"
	"encoding/json"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

func request(id, command string) Request {
	params := json.RawMessage(`{}`)
	if command == "launch" || command == "switch" {
		params = json.RawMessage(`{"themeId":"mountain-mist","themeVersion":"1.3.0"}`)
	}
	return Request{ProtocolVersion: 1, RequestID: id, Command: command, Params: params}
}

func TestFrameRoundTripAndBounds(t *testing.T) {
	frame, err := EncodeFrame(request("00000000-0000-4000-8000-000000000401", "status"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeRequest(frame)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Command != "status" {
		t.Fatalf("command = %q", decoded.Command)
	}
	if _, err := DecodeRequest(make([]byte, MaxFrameBytes+5)); err == nil {
		t.Fatal("oversized frame was accepted")
	}
}

func TestRequestParametersAreCommandStrict(t *testing.T) {
	for name, value := range map[string]Request{
		"status fields": requestWithParams(
			"00000000-0000-4000-8000-000000000411", "status", `{"unexpected":true}`,
		),
		"launch missing theme": requestWithParams(
			"00000000-0000-4000-8000-000000000412", "launch", `{}`,
		),
		"launch unknown field": requestWithParams(
			"00000000-0000-4000-8000-000000000413", "launch", `{"themeId":"mountain-mist","unknown":true}`,
		),
		"launch invalid theme ID": requestWithParams(
			"00000000-0000-4000-8000-000000000417", "launch", `{"themeId":"../mountain-mist"}`,
		),
		"launch invalid theme version": requestWithParams(
			"00000000-0000-4000-8000-000000000418", "launch", `{"themeId":"mountain-mist","themeVersion":"latest"}`,
		),
		"pause array": requestWithParams(
			"00000000-0000-4000-8000-000000000414", "pause", `[]`,
		),
		"pause null": requestWithParams(
			"00000000-0000-4000-8000-000000000416", "pause", `null`,
		),
	} {
		t.Run(name, func(t *testing.T) {
			frame, err := EncodeFrame(value)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := DecodeRequest(frame); err == nil {
				t.Fatal("invalid command parameters were accepted")
			}
		})
	}
	valid := requestWithParams(
		"00000000-0000-4000-8000-000000000415", "launch", `{"themeId":"mountain-mist","themeVersion":"1.3.0"}`,
	)
	frame, err := EncodeFrame(valid)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeRequest(frame); err != nil {
		t.Fatalf("valid theme parameters were rejected: %v", err)
	}
}

func TestRequestRejectsUnknownTopLevelFields(t *testing.T) {
	frame, err := EncodeFrame(map[string]any{
		"protocolVersion": ProtocolVersion,
		"requestId":       "00000000-0000-4000-8000-000000000419",
		"command":         "status",
		"params":          map[string]any{},
		"unexpected":      true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeRequest(frame); err == nil {
		t.Fatal("unknown top-level request field was accepted")
	}
}

func requestWithParams(id, command, params string) Request {
	return Request{
		ProtocolVersion: ProtocolVersion,
		RequestID:       id,
		Command:         command,
		Params:          json.RawMessage(params),
	}
}

func TestDispatcherIsIdempotentAndRejectsChangedCommand(t *testing.T) {
	dispatcher := NewDispatcher(func(_ context.Context, request Request) (Result, error) {
		return Result{"command": request.Command}, nil
	})
	id := "00000000-0000-4000-8000-000000000402"
	first := dispatcher.Dispatch(context.Background(), request(id, "launch"))
	replay := dispatcher.Dispatch(context.Background(), request(id, "launch"))
	changed := dispatcher.Dispatch(context.Background(), request(id, "pause"))
	if !first.OK || !replay.OK || string(first.Result) != string(replay.Result) {
		t.Fatalf("replay changed: first=%+v replay=%+v", first, replay)
	}
	if changed.OK || changed.Error == nil || changed.Error.Code != "RUNTIME_CONTROL_UNAVAILABLE" {
		t.Fatalf("changed command response = %+v", changed)
	}
}

func TestStatusRunsWhileMutationsRemainSerialized(t *testing.T) {
	mutationStarted := make(chan struct{})
	releaseMutation := make(chan struct{})
	var activeMutations int32
	var maxMutations int32
	dispatcher := NewDispatcher(func(_ context.Context, request Request) (Result, error) {
		if request.Command == "status" {
			return Result{"status": "ready"}, nil
		}
		active := atomic.AddInt32(&activeMutations, 1)
		if active > atomic.LoadInt32(&maxMutations) {
			atomic.StoreInt32(&maxMutations, active)
		}
		select {
		case <-mutationStarted:
		default:
			close(mutationStarted)
		}
		<-releaseMutation
		atomic.AddInt32(&activeMutations, -1)
		return Result{"status": "done"}, nil
	})

	mutation := make(chan Response, 1)
	go func() {
		mutation <- dispatcher.Dispatch(context.Background(), request("00000000-0000-4000-8000-000000000403", "launch"))
	}()
	<-mutationStarted
	statusDone := make(chan Response, 1)
	go func() {
		statusDone <- dispatcher.Dispatch(context.Background(), request("00000000-0000-4000-8000-000000000404", "status"))
	}()
	select {
	case response := <-statusDone:
		if !response.OK {
			t.Fatalf("status failed: %+v", response)
		}
	case <-time.After(time.Second):
		t.Fatal("status waited behind mutation")
	}
	close(releaseMutation)
	<-mutation
	if maxMutations != 1 {
		t.Fatalf("max mutations = %d", maxMutations)
	}
}

func TestServeAllowsStatusWhileMutationIsInFlight(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	mutationStarted := make(chan struct{})
	releaseMutation := make(chan struct{})
	dispatcher := NewDispatcher(func(_ context.Context, request Request) (Result, error) {
		if request.Command == "status" {
			return Result{"status": "ready"}, nil
		}
		close(mutationStarted)
		<-releaseMutation
		return Result{"status": "done"}, nil
	})
	serverContext, cancelServer := context.WithCancel(context.Background())
	serverDone := make(chan error, 1)
	go func() { serverDone <- Serve(serverContext, listener, dispatcher, nil) }()
	dial := func() (Connection, error) { return net.Dial("tcp", listener.Addr().String()) }

	mutationDone := make(chan error, 1)
	go func() {
		_, roundTripErr := RoundTrip(context.Background(), dial, request(
			"00000000-0000-4000-8000-000000000405", "launch",
		))
		mutationDone <- roundTripErr
	}()
	<-mutationStarted
	statusContext, cancelStatus := context.WithTimeout(context.Background(), time.Second)
	defer cancelStatus()
	status, err := RoundTrip(statusContext, dial, request(
		"00000000-0000-4000-8000-000000000406", "status",
	))
	if err != nil || !status.OK {
		t.Fatalf("parallel status response=%+v error=%v", status, err)
	}
	close(releaseMutation)
	if err := <-mutationDone; err != nil {
		t.Fatal(err)
	}
	cancelServer()
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}
