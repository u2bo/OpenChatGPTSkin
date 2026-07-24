package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/persistence"
)

const maxStartupLineBytes = 8 * 1024

type startupHandshake struct {
	OK        bool   `json:"ok"`
	StartupID string `json:"startupId"`
	Endpoint  string `json:"endpoint,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type controllerModel struct {
	mu       sync.RWMutex
	status   string
	themeID  string
	version  string
	terminal bool
	state    string
}

type persistedControllerState struct {
	SchemaVersion int    `json:"schemaVersion"`
	Status        string `json:"status"`
	ThemeID       string `json:"themeId,omitempty"`
	ThemeVersion  string `json:"themeVersion,omitempty"`
	UpdatedAt     string `json:"updatedAt"`
}

func loadControllerModel(path string) (*controllerModel, error) {
	model := &controllerModel{status: "stopped", state: path}
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return model, nil
	}
	if err != nil {
		return nil, err
	}
	var persisted persistedControllerState
	decoder := json.NewDecoder(bytesReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&persisted); err != nil || persisted.SchemaVersion != 1 || persisted.Status == "" || persisted.UpdatedAt == "" {
		return nil, control.CommandError{Code: "RUNTIME_SESSION_STALE", Message: "Runtime session evidence is invalid"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, control.CommandError{Code: "RUNTIME_SESSION_STALE", Message: "Runtime session evidence has trailing data"}
	}
	model.status, model.themeID, model.version = persisted.Status, persisted.ThemeID, persisted.ThemeVersion
	if model.status != "stopped" && model.status != "restored-awaiting-exit" {
		model.status = "recovery-required"
		if err := model.persistLocked(); err != nil {
			return nil, err
		}
	}
	return model, nil
}

func bytesReader(contents []byte) *bytes.Reader { return bytes.NewReader(contents) }

func newControllerDispatcher(model *controllerModel) *control.Dispatcher {
	dispatcher := control.NewDispatcher(func(_ context.Context, request control.Request) (control.Result, error) {
		if request.Command == "status" {
			model.mu.RLock()
			defer model.mu.RUnlock()
			return model.result(), nil
		}
		model.mu.Lock()
		defer model.mu.Unlock()
		next := controllerModel{status: model.status, themeID: model.themeID, version: model.version, terminal: model.terminal, state: model.state}
		switch request.Command {
		case "launch":
			if model.status != "stopped" {
				return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be stopped before launch"}
			}
			params, err := control.DecodeThemeParameters(request)
			if err != nil {
				return nil, err
			}
			next.status, next.themeID, next.version = "active", params.ThemeID, params.ThemeVersion
		case "switch":
			if model.status != "active" && model.status != "paused" {
				return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be active or paused before switching theme"}
			}
			params, err := control.DecodeThemeParameters(request)
			if err != nil {
				return nil, err
			}
			next.status, next.themeID, next.version = "active", params.ThemeID, params.ThemeVersion
		case "resume":
			if model.status != "paused" {
				return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be paused before resume"}
			}
			next.status = "active"
		case "pause":
			if model.status != "active" {
				return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be active before pause"}
			}
			next.status = "paused"
		case "restore":
			if model.status == "restored-awaiting-exit" {
				return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime restore is already pending exit"}
			}
			next.status, next.themeID, next.version, next.terminal = "restored-awaiting-exit", "", "", true
		default:
			return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime command is unavailable in the current state"}
		}
		if err := next.persistLocked(); err != nil {
			return nil, err
		}
		model.status, model.themeID, model.version, model.terminal = next.status, next.themeID, next.version, next.terminal
		return model.result(), nil
	})
	return dispatcher
}

func (model *controllerModel) persistLocked() error {
	if model.state == "" {
		return nil
	}
	contents, err := json.MarshalIndent(persistedControllerState{SchemaVersion: 1, Status: model.status, ThemeID: model.themeID, ThemeVersion: model.version, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}, "", "  ")
	if err != nil {
		return err
	}
	contents = append(contents, '\n')
	return atomicStateWrite(model.state, contents)
}

func atomicStateWrite(path string, contents []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".runtime-session-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(contents); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	committed = true
	return nil
}

func (model *controllerModel) result() control.Result {
	result := control.Result{"status": model.status, "themeId": model.themeID, "themeVersion": model.version}
	if model.themeID == "" {
		result["selectedTheme"] = nil
		result["appliedTheme"] = nil
		result["skinApplied"] = false
	} else {
		ref := map[string]string{"id": model.themeID, "version": model.version}
		result["selectedTheme"] = ref
		if model.status == "active" || model.status == "paused" {
			result["appliedTheme"] = ref
			result["skinApplied"] = true
		} else {
			result["appliedTheme"] = nil
			result["skinApplied"] = false
		}
	}
	return result
}

func (model *controllerModel) isTerminal() bool {
	model.mu.RLock()
	defer model.mu.RUnlock()
	return model.terminal
}

func writeHandshake(path string, value startupHandshake) error {
	contents, err := json.Marshal(value)
	if err != nil {
		return err
	}
	contents = append(contents, '\n')
	if len(contents) > maxStartupLineBytes {
		return errors.New("startup handshake exceeds its limit")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".controller-startup-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, err := temporary.Write(contents); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	committed = true
	return nil
}

type controllerOptions struct {
	startupID   string
	startupFile string
	dataRoot    string
	once        bool
}

func runController(ctx context.Context, options controllerOptions) error {
	if options.startupID == "" || options.startupFile == "" || options.dataRoot == "" {
		return commandError{code: "CLI_ARGUMENT_INVALID", message: "controller startup options are required"}
	}
	pid, startedAt, err := currentProcessIdentity()
	if err != nil {
		_ = writeHandshake(options.startupFile, startupHandshake{OK: false, StartupID: options.startupID, ErrorCode: "RUNTIME_IDENTITY_UNAVAILABLE"})
		return err
	}
	lock, err := persistence.Acquire(
		filepath.Join(options.dataRoot, "controller.lock"),
		persistence.Identity{PID: pid, StartedAt: startedAt},
		processAlive,
	)
	if err != nil {
		_ = writeHandshake(options.startupFile, startupHandshake{OK: false, StartupID: options.startupID, ErrorCode: "RUNTIME_BUSY"})
		return err
	}
	defer lock.Release()
	endpoint := controlEndpoint(options.dataRoot)
	listener, err := listenControl(endpoint)
	if err != nil {
		_ = writeHandshake(options.startupFile, startupHandshake{OK: false, StartupID: options.startupID, ErrorCode: "RUNTIME_CONTROL_UNAVAILABLE"})
		return err
	}
	defer listener.Close()
	model, err := loadControllerModel(filepath.Join(options.dataRoot, "runtime-session.json"))
	if err != nil {
		_ = writeHandshake(options.startupFile, startupHandshake{OK: false, StartupID: options.startupID, ErrorCode: "RUNTIME_SESSION_STALE"})
		return err
	}
	if err := writeHandshake(options.startupFile, startupHandshake{OK: true, StartupID: options.startupID, Endpoint: endpoint}); err != nil {
		return err
	}
	dispatcher := newControllerDispatcher(model)
	err = control.Serve(ctx, listener, dispatcher, func() {
		if options.once || model.isTerminal() {
			_ = listener.Close()
		}
	})
	if ctx.Err() != nil || errors.Is(err, net.ErrClosed) && (options.once || model.isTerminal()) {
		return nil
	}
	return err
}

func readHandshake(path, startupID string) (startupHandshake, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return startupHandshake{}, err
	}
	if len(contents) == 0 || len(contents) > maxStartupLineBytes || contents[len(contents)-1] != '\n' ||
		len(contents) > 1 && bytesCount(contents, '\n') != 1 {
		return startupHandshake{}, errors.New("startup handshake framing is invalid")
	}
	var handshake startupHandshake
	if err := json.Unmarshal(contents[:len(contents)-1], &handshake); err != nil {
		return startupHandshake{}, err
	}
	if handshake.StartupID != startupID {
		return startupHandshake{}, errors.New("startup handshake identity changed")
	}
	return handshake, nil
}

func bytesCount(contents []byte, value byte) int {
	count := 0
	for _, current := range contents {
		if current == value {
			count++
		}
	}
	return count
}

func waitForHandshake(ctx context.Context, path, startupID string) (startupHandshake, error) {
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		handshake, err := readHandshake(path, startupID)
		if err == nil {
			_ = os.Remove(path)
			if !handshake.OK {
				return handshake, fmt.Errorf("controller startup failed: %s", handshake.ErrorCode)
			}
			return handshake, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return startupHandshake{}, err
		}
		select {
		case <-ctx.Done():
			return startupHandshake{}, ctx.Err()
		case <-ticker.C:
		}
	}
}
