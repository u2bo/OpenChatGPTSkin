package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
}

func newControllerDispatcher() (*control.Dispatcher, *controllerModel) {
	model := &controllerModel{status: "stopped"}
	dispatcher := control.NewDispatcher(func(_ context.Context, request control.Request) (control.Result, error) {
		if request.Command == "status" {
			model.mu.RLock()
			defer model.mu.RUnlock()
			return control.Result{"status": model.status, "themeId": model.themeID, "themeVersion": model.version}, nil
		}
		model.mu.Lock()
		defer model.mu.Unlock()
		switch request.Command {
		case "launch", "switch", "resume":
			params := control.ThemeParameters{}
			if request.Command != "resume" {
				var err error
				params, err = control.DecodeThemeParameters(request)
				if err != nil {
					return nil, err
				}
			}
			if params.ThemeID != "" {
				model.themeID = params.ThemeID
			}
			if params.ThemeVersion != "" {
				model.version = params.ThemeVersion
			}
			model.status = "active"
		case "pause":
			model.status = "paused"
		case "restore":
			model.status = "stopped"
			model.themeID, model.version = "", ""
			model.terminal = true
		}
		return control.Result{"status": model.status, "themeId": model.themeID, "themeVersion": model.version}, nil
	})
	return dispatcher, model
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
	if err := writeHandshake(options.startupFile, startupHandshake{OK: true, StartupID: options.startupID, Endpoint: endpoint}); err != nil {
		return err
	}
	dispatcher, model := newControllerDispatcher()
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
