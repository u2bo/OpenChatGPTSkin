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

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/cdp"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/persistence"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

const maxStartupLineBytes = 8 * 1024

type startupHandshake struct {
	OK        bool   `json:"ok"`
	StartupID string `json:"startupId"`
	Endpoint  string `json:"endpoint,omitempty"`
	ErrorCode string `json:"errorCode,omitempty"`
}

type controllerModel struct {
	mu           sync.RWMutex
	status       string
	themeID      string
	version      string
	terminal     bool
	state        string
	session      managedThemeSession
	factory      sessionFactory
	load         themeLoader
	restoreWatch managedThemeSession
}

type persistedControllerState struct {
	SchemaVersion int    `json:"schemaVersion"`
	Status        string `json:"status"`
	ThemeID       string `json:"themeId,omitempty"`
	ThemeVersion  string `json:"themeVersion,omitempty"`
	UpdatedAt     string `json:"updatedAt"`
}

func loadControllerModel(path string) (*controllerModel, error) {
	model := &controllerModel{status: "stopped", state: path, factory: newManagedThemeSession, load: defaultThemeLoader(filepath.Dir(path))}
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
	if model.status == "restored-awaiting-exit" {
		// Restore has already removed the theme and closed the CDP session before
		// this state is persisted. After a controller restart the in-memory exit
		// watcher cannot be recovered, so the only valid durable state is stopped.
		model.status, model.themeID, model.version = "stopped", "", ""
		if err := model.persistLocked(); err != nil {
			return nil, err
		}
	} else if model.status != "stopped" {
		model.status = "recovery-required"
		if err := model.persistLocked(); err != nil {
			return nil, err
		}
	}
	return model, nil
}

func bytesReader(contents []byte) *bytes.Reader { return bytes.NewReader(contents) }

func newControllerDispatcher(model *controllerModel) *control.Dispatcher {
	dispatcher := control.NewDispatcher(func(runtimeContext context.Context, request control.Request) (control.Result, error) {
		if request.Command == "status" {
			model.mu.RLock()
			defer model.mu.RUnlock()
			return model.result(), nil
		}
		switch request.Command {
		case "launch":
			params, err := control.DecodeThemeParameters(request)
			if err != nil {
				return nil, err
			}
			return model.launch(runtimeContext, params)
		case "switch":
			params, err := control.DecodeThemeParameters(request)
			if err != nil {
				return nil, err
			}
			return model.switchTheme(runtimeContext, params)
		case "resume":
			return model.resume(runtimeContext)
		case "pause":
			return model.pause(runtimeContext)
		case "restore":
			return model.restore(runtimeContext)
		default:
			return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime command is unavailable in the current state"}
		}
	})
	return dispatcher
}

func (model *controllerModel) launch(ctx context.Context, parameters control.ThemeParameters) (control.Result, error) {
	model.mu.RLock()
	stopped := model.status == "stopped"
	model.mu.RUnlock()
	if !stopped {
		return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be stopped before launch"}
	}
	if _, err := model.setOperation("launching", parameters.ThemeID, parameters.ThemeVersion, false); err != nil {
		return nil, err
	}
	payload, ref, err := model.theme(ctx, parameters)
	if err != nil {
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		return nil, runtimeCommandError(err, "THEME_APPLY_FAILED")
	}
	if model.factory == nil {
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		return nil, control.CommandError{Code: "RUNTIME_CONTROL_UNAVAILABLE", Message: "Runtime platform adapter is unavailable"}
	}
	session, err := model.factory(ctx)
	if err == nil {
		err = session.Apply(ctx, payload)
	}
	if err != nil {
		fallback := "THEME_APPLY_FAILED"
		if session != nil {
			if cleanupErr := cleanupThemeSession(ctx, session); cleanupErr != nil {
				err, fallback = cleanupErr, "THEME_CLEANUP_FAILED"
			}
		}
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		return nil, runtimeCommandError(err, fallback)
	}
	model.mu.Lock()
	model.status, model.themeID, model.version, model.session = "active", ref.ID, ref.Version, session
	err = model.persistLocked()
	result := model.result()
	model.mu.Unlock()
	if err != nil {
		cleanupErr := cleanupThemeSession(ctx, session)
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		if cleanupErr != nil {
			return nil, runtimeCommandError(cleanupErr, "THEME_CLEANUP_FAILED")
		}
		return nil, err
	}
	return result, nil
}

func (model *controllerModel) switchTheme(ctx context.Context, parameters control.ThemeParameters) (control.Result, error) {
	model.mu.Lock()
	if model.status != "active" && model.status != "paused" || model.session == nil {
		model.mu.Unlock()
		return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must have an active managed session before switching theme"}
	}
	session := model.session
	previousStatus, previousThemeID, previousVersion := model.status, model.themeID, model.version
	model.status, model.themeID, model.version = "switching", parameters.ThemeID, parameters.ThemeVersion
	if err := model.persistLocked(); err != nil {
		model.status, model.themeID, model.version = previousStatus, previousThemeID, previousVersion
		model.mu.Unlock()
		return nil, err
	}
	model.mu.Unlock()
	payload, ref, err := model.theme(ctx, parameters)
	if err == nil {
		err = session.Apply(ctx, payload)
	}
	if err != nil {
		fallback := "THEME_APPLY_FAILED"
		if cleanupErr := cleanupThemeSession(ctx, session); cleanupErr != nil {
			err, fallback = cleanupErr, "THEME_CLEANUP_FAILED"
		}
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		return nil, runtimeCommandError(err, fallback)
	}
	model.mu.Lock()
	model.status, model.themeID, model.version = "active", ref.ID, ref.Version
	err = model.persistLocked()
	result := model.result()
	model.mu.Unlock()
	if err != nil {
		cleanupErr := cleanupThemeSession(ctx, session)
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		if cleanupErr != nil {
			return nil, runtimeCommandError(cleanupErr, "THEME_CLEANUP_FAILED")
		}
		return nil, err
	}
	return result, nil
}

func (model *controllerModel) pause(ctx context.Context) (control.Result, error) {
	model.mu.RLock()
	if model.status != "active" || model.session == nil {
		model.mu.RUnlock()
		return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be active before pause"}
	}
	session := model.session
	model.mu.RUnlock()
	if err := session.Restore(ctx); err != nil {
		return nil, runtimeCommandError(err, "THEME_CLEANUP_FAILED")
	}
	result, err := model.setOperation("paused", model.themeID, model.version, false)
	if err == nil {
		return result, nil
	}
	cleanupErr := cleanupThemeSession(ctx, session)
	if stopErr := model.stopAfterFailure(); stopErr != nil {
		return nil, stopErr
	}
	if cleanupErr != nil {
		return nil, runtimeCommandError(cleanupErr, "THEME_CLEANUP_FAILED")
	}
	return nil, err
}

func (model *controllerModel) resume(ctx context.Context) (control.Result, error) {
	model.mu.RLock()
	if model.status != "paused" || model.session == nil {
		model.mu.RUnlock()
		return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime must be paused before resume"}
	}
	parameters := control.ThemeParameters{ThemeID: model.themeID, ThemeVersion: model.version}
	session := model.session
	model.mu.RUnlock()
	payload, ref, err := model.theme(ctx, parameters)
	if err == nil {
		err = session.Apply(ctx, payload)
	}
	if err != nil {
		fallback := "THEME_APPLY_FAILED"
		if cleanupErr := cleanupThemeSession(ctx, session); cleanupErr != nil {
			err, fallback = cleanupErr, "THEME_CLEANUP_FAILED"
		}
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		return nil, runtimeCommandError(err, fallback)
	}
	result, err := model.setOperation("active", ref.ID, ref.Version, false)
	if err == nil {
		return result, nil
	}
	cleanupErr := cleanupThemeSession(ctx, session)
	if stopErr := model.stopAfterFailure(); stopErr != nil {
		return nil, stopErr
	}
	if cleanupErr != nil {
		return nil, runtimeCommandError(cleanupErr, "THEME_CLEANUP_FAILED")
	}
	return nil, err
}

func (model *controllerModel) restore(ctx context.Context) (control.Result, error) {
	model.mu.RLock()
	if model.status == "restored-awaiting-exit" {
		model.mu.RUnlock()
		return nil, control.CommandError{Code: "RUNTIME_INVALID_TRANSITION", Message: "Runtime restore is already pending exit"}
	}
	session := model.session
	model.mu.RUnlock()
	if session != nil {
		if err := session.Restore(ctx); err != nil {
			return nil, runtimeCommandError(err, "THEME_CLEANUP_FAILED")
		}
		if err := session.Close(); err != nil {
			return nil, runtimeCommandError(err, "THEME_CLEANUP_FAILED")
		}
	}
	model.mu.Lock()
	if session == nil {
		model.status, model.themeID, model.version, model.session = "stopped", "", "", nil
		model.restoreWatch = nil
		model.terminal = true
	} else {
		model.status, model.themeID, model.version, model.session = "restored-awaiting-exit", "", "", session
		model.restoreWatch = session
	}
	err := model.persistLocked()
	result := model.result()
	model.mu.Unlock()
	if err != nil {
		if stopErr := model.stopAfterFailure(); stopErr != nil {
			return nil, stopErr
		}
		return nil, err
	}
	return result, nil
}

func (model *controllerModel) theme(_ context.Context, parameters control.ThemeParameters) (cdp.ThemePayload, themerepo.Ref, error) {
	if model.load == nil {
		return cdp.ThemePayload{}, themerepo.Ref{}, control.CommandError{Code: "THEME_NOT_FOUND", Message: "Theme repository is unavailable"}
	}
	payload, err := model.load(themerepo.Ref{ID: parameters.ThemeID, Version: parameters.ThemeVersion})
	if err != nil {
		return cdp.ThemePayload{}, themerepo.Ref{}, err
	}
	var identity struct {
		ID      string `json:"id"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(payload.Document, &identity); err != nil || identity.ID != parameters.ThemeID || identity.Version == "" {
		return cdp.ThemePayload{}, themerepo.Ref{}, control.CommandError{Code: "THEME_APPLY_FAILED", Message: "Theme payload identity is invalid"}
	}
	return payload, themerepo.Ref{ID: identity.ID, Version: identity.Version}, nil
}

func (model *controllerModel) setOperation(status, themeID, version string, terminal bool) (control.Result, error) {
	model.mu.Lock()
	defer model.mu.Unlock()
	previousStatus, previousThemeID, previousVersion, previousTerminal := model.status, model.themeID, model.version, model.terminal
	model.status, model.themeID, model.version, model.terminal = status, themeID, version, terminal
	if err := model.persistLocked(); err != nil {
		model.status, model.themeID, model.version, model.terminal = previousStatus, previousThemeID, previousVersion, previousTerminal
		return nil, err
	}
	return model.result(), nil
}

func (model *controllerModel) stopAfterFailure() error {
	model.mu.Lock()
	defer model.mu.Unlock()
	model.status, model.themeID, model.version, model.session, model.terminal = "stopped", "", "", nil, false
	model.restoreWatch = nil
	if err := model.persistLocked(); err != nil {
		return err
	}
	model.terminal = true
	return nil
}

func cleanupThemeSession(ctx context.Context, session managedThemeSession) error {
	restoreErr := session.Restore(ctx)
	closeErr := session.Close()
	return errors.Join(restoreErr, closeErr)
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
	} else {
		ref := map[string]string{"id": model.themeID, "version": model.version}
		result["selectedTheme"] = ref
	}
	if model.status == "active" && model.session != nil {
		result["appliedTheme"] = map[string]string{"id": model.themeID, "version": model.version}
		result["skinApplied"] = true
		result["nextAction"] = "The verified platform adapter confirmed the active theme."
	} else {
		result["appliedTheme"] = nil
		result["skinApplied"] = false
		result["nextAction"] = "A verified platform adapter must apply and confirm the theme."
	}
	return result
}

func (model *controllerModel) isTerminal() bool {
	model.mu.RLock()
	defer model.mu.RUnlock()
	return model.terminal
}

func (model *controllerModel) takeRestoreWatch() managedThemeSession {
	model.mu.Lock()
	defer model.mu.Unlock()
	session := model.restoreWatch
	model.restoreWatch = nil
	return session
}

func (model *controllerModel) markManagedExit() error {
	model.mu.Lock()
	defer model.mu.Unlock()
	if model.status != "restored-awaiting-exit" {
		return nil
	}
	model.status, model.themeID, model.version, model.session = "stopped", "", "", nil
	model.restoreWatch = nil
	if err := model.persistLocked(); err != nil {
		return err
	}
	model.terminal = true
	return nil
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
	factory     sessionFactory
	load        themeLoader
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
	if options.factory != nil {
		model.factory = options.factory
	}
	if options.load != nil {
		model.load = options.load
	}
	if err := writeHandshake(options.startupFile, startupHandshake{OK: true, StartupID: options.startupID, Endpoint: endpoint}); err != nil {
		return err
	}
	dispatcher := newControllerDispatcher(model)
	err = control.Serve(ctx, listener, dispatcher, func() {
		if session := model.takeRestoreWatch(); session != nil {
			go func() {
				if session.WaitForExit(ctx) == nil && model.markManagedExit() == nil {
					_ = listener.Close()
				}
			}()
		}
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
		if !errors.Is(err, os.ErrNotExist) && !transientStartupReadError(err) {
			return startupHandshake{}, err
		}
		select {
		case <-ctx.Done():
			return startupHandshake{}, ctx.Err()
		case <-ticker.C:
		}
	}
}
