package control

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sync"
)

type Handler func(context.Context, Request) (Result, error)

type cachedResponse struct {
	command  string
	response Response
}

type inFlight struct {
	command string
	done    chan struct{}
}

type Dispatcher struct {
	handler  Handler
	mu       sync.Mutex
	mutation sync.Mutex
	cache    map[string]cachedResponse
	order    []string
	inFlight map[string]*inFlight
}

func NewDispatcher(handler Handler) *Dispatcher {
	return &Dispatcher{
		handler:  handler,
		cache:    make(map[string]cachedResponse),
		inFlight: make(map[string]*inFlight),
	}
}

var (
	requestIDPattern    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	themeIDPattern      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	themeVersionPattern = regexp.MustCompile(`^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$`)
)

type ThemeParameters struct {
	ThemeID      string `json:"themeId"`
	ThemeVersion string `json:"themeVersion,omitempty"`
}

func decodeStrictParameters(params json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(params))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func DecodeThemeParameters(request Request) (ThemeParameters, error) {
	var params ThemeParameters
	if err := decodeStrictParameters(request.Params, &params); err != nil {
		return ThemeParameters{}, errors.New("control theme parameters are invalid")
	}
	if len(params.ThemeID) < 3 || len(params.ThemeID) > 80 || !themeIDPattern.MatchString(params.ThemeID) {
		return ThemeParameters{}, errors.New("control theme ID is invalid")
	}
	if params.ThemeVersion != "" && !themeVersionPattern.MatchString(params.ThemeVersion) {
		return ThemeParameters{}, errors.New("control theme version is invalid")
	}
	return params, nil
}

func validateParameters(request Request) error {
	if request.Command == "launch" || request.Command == "switch" {
		_, err := DecodeThemeParameters(request)
		return err
	}
	var params map[string]json.RawMessage
	if err := decodeStrictParameters(request.Params, &params); err != nil || params == nil || len(params) != 0 {
		return errors.New("control parameters must be an empty object")
	}
	return nil
}

func validateRequest(request Request) error {
	if request.ProtocolVersion != ProtocolVersion {
		return errors.New("control protocol version is invalid")
	}
	if !requestIDPattern.MatchString(request.RequestID) {
		return errors.New("control request ID is invalid")
	}
	switch request.Command {
	case "launch", "status", "switch", "pause", "resume", "restore":
	default:
		return errors.New("control command is invalid")
	}
	if len(request.Params) == 0 || !json.Valid(request.Params) {
		return errors.New("control parameters are invalid")
	}
	return validateParameters(request)
}

func rejected(request Request, code, message string) Response {
	return Response{
		ProtocolVersion: ProtocolVersion,
		RequestID:       request.RequestID,
		OK:              false,
		Error:           &Error{Code: code, Message: message, NextAction: "Review Runtime status and retry with a new request ID."},
	}
}

func (dispatcher *Dispatcher) Dispatch(ctx context.Context, request Request) Response {
	if err := validateRequest(request); err != nil {
		return rejected(request, "RUNTIME_CONTROL_UNAVAILABLE", err.Error())
	}
	for {
		dispatcher.mu.Lock()
		if cached, ok := dispatcher.cache[request.RequestID]; ok {
			dispatcher.mu.Unlock()
			if cached.command != request.Command {
				return rejected(request, "RUNTIME_CONTROL_UNAVAILABLE", "request ID belongs to another command")
			}
			return cached.response
		}
		if pending, ok := dispatcher.inFlight[request.RequestID]; ok {
			dispatcher.mu.Unlock()
			if pending.command != request.Command {
				return rejected(request, "RUNTIME_CONTROL_UNAVAILABLE", "request ID belongs to another command")
			}
			select {
			case <-pending.done:
				continue
			case <-ctx.Done():
				return rejected(request, "RUNTIME_CONTROL_UNAVAILABLE", "request was cancelled")
			}
		}
		pending := &inFlight{command: request.Command, done: make(chan struct{})}
		dispatcher.inFlight[request.RequestID] = pending
		dispatcher.mu.Unlock()
		response := dispatcher.execute(ctx, request)
		dispatcher.mu.Lock()
		dispatcher.cache[request.RequestID] = cachedResponse{command: request.Command, response: response}
		dispatcher.order = append(dispatcher.order, request.RequestID)
		for len(dispatcher.order) > 32 {
			oldest := dispatcher.order[0]
			dispatcher.order = dispatcher.order[1:]
			delete(dispatcher.cache, oldest)
		}
		delete(dispatcher.inFlight, request.RequestID)
		close(pending.done)
		dispatcher.mu.Unlock()
		return response
	}
}

func (dispatcher *Dispatcher) execute(ctx context.Context, request Request) Response {
	if request.Command != "status" {
		dispatcher.mutation.Lock()
		defer dispatcher.mutation.Unlock()
	}
	result, err := dispatcher.handler(ctx, request)
	if err != nil {
		return rejected(request, "INTERNAL", "The Runtime command could not be completed.")
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return rejected(request, "INTERNAL", "The Runtime result could not be encoded.")
	}
	return Response{ProtocolVersion: ProtocolVersion, RequestID: request.RequestID, OK: true, Result: payload}
}
