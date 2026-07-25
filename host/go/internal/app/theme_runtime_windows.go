//go:build windows

package app

import (
	"context"
	"errors"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/cdp"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	platform "github.com/u2bo/OpenChatGPTSkin/host/go/internal/platform/windows"
)

type windowsThemeSession struct {
	connection *cdp.Connection
	root       platform.ProcessIdentity
}

func newManagedThemeSession(ctx context.Context) (managedThemeSession, error) {
	launch, err := platform.LaunchManaged(ctx)
	if err != nil {
		return nil, platformRuntimeError(err)
	}
	endpoint := cdp.Endpoint{Host: "127.0.0.1", Port: launch.Port}
	target, err := waitForCompatibleTarget(ctx, endpoint)
	if err != nil {
		return nil, platformRuntimeError(err)
	}
	connection, err := cdp.Connect(ctx, endpoint, target)
	if err != nil {
		return nil, platformRuntimeError(err)
	}
	return &windowsThemeSession{connection: connection, root: launch.Root}, nil
}

func (session *windowsThemeSession) Apply(ctx context.Context, payload cdp.ThemePayload) error {
	return session.connection.ApplyTheme(ctx, payload)
}

func (session *windowsThemeSession) Restore(ctx context.Context) error {
	return session.connection.RestoreTheme(ctx)
}

func (session *windowsThemeSession) WaitForExit(ctx context.Context) error {
	return platform.WaitForManagedExit(ctx, session.root)
}

func (session *windowsThemeSession) Close() error { return session.connection.Close() }

func platformRuntimeError(err error) error {
	var platformError platform.Error
	if errors.As(err, &platformError) {
		return control.CommandError{Code: platformError.Code, Message: platformError.Message}
	}
	return err
}
