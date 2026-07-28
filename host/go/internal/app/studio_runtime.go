package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/studio"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

func readStudioRuntimeStatus(dataRoot string) studio.RuntimeStatus {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	response, err := sendRuntime(ctx, dataRoot, control.Request{
		ProtocolVersion: control.ProtocolVersion,
		RequestID:       studioRequestID(),
		Command:         "status",
		Params:          json.RawMessage(`{}`),
	})
	if err != nil || !response.OK {
		return studio.StoppedRuntimeStatus()
	}
	status, err := studioStatusFromResponse(response)
	if err != nil {
		return studio.StoppedRuntimeStatus()
	}
	status.ControllerAvailable = true
	return status
}

func applyStudioTheme(ctx context.Context, dataRoot string, ref themerepo.Ref) (studio.RuntimeStatus, error) {
	current := readStudioRuntimeStatus(dataRoot)
	command := "launch"
	if current.Status == "active" || current.Status == "paused" {
		command = "switch"
	}
	response, err := runRuntime(ctx, []string{command, "--data-root", dataRoot, "--theme", ref.ID, "--theme-version", ref.Version})
	if err != nil {
		return studio.RuntimeStatus{}, studioRuntimeError(err)
	}
	return studioRuntimeStatus(response)
}

func restoreStudioTheme(ctx context.Context, dataRoot string) (studio.RuntimeStatus, error) {
	response, err := runRuntime(ctx, []string{"restore", "--data-root", dataRoot})
	if err != nil {
		return studio.RuntimeStatus{}, studioRuntimeError(err)
	}
	return studioRuntimeStatus(response)
}

func studioRuntimeStatus(response control.Response) (studio.RuntimeStatus, error) {
	status, err := studioStatusFromResponse(response)
	if err != nil {
		return studio.RuntimeStatus{}, studioRuntimeError(err)
	}
	return status, nil
}

func studioRuntimeError(err error) error {
	var command commandError
	if errors.As(err, &command) {
		return studio.RuntimeError{Code: command.code, Message: command.message}
	}
	return err
}

func studioRequestID() string {
	value, err := requestID()
	if err != nil {
		return "00000000-0000-4000-8000-000000000601"
	}
	return value
}

func studioStatusFromResponse(response control.Response) (studio.RuntimeStatus, error) {
	if !response.OK {
		if response.Error != nil {
			return studio.RuntimeStatus{}, commandError{code: response.Error.Code, message: response.Error.Message}
		}
		return studio.RuntimeStatus{}, commandError{code: "RUNTIME_CONTROL_UNAVAILABLE", message: "Runtime did not return a status"}
	}
	var result struct {
		Status        string         `json:"status"`
		SelectedTheme *themerepo.Ref `json:"selectedTheme"`
		AppliedTheme  *themerepo.Ref `json:"appliedTheme"`
		SkinApplied   *bool          `json:"skinApplied"`
		NextAction    string         `json:"nextAction"`
	}
	if err := json.Unmarshal(response.Result, &result); err != nil || result.Status == "" || result.SkinApplied == nil {
		return studio.RuntimeStatus{}, commandError{code: "RUNTIME_STATUS_UNAVAILABLE", message: "Runtime status payload is invalid"}
	}
	return studio.RuntimeStatus{
		Status: result.Status, ControllerAvailable: true, SelectedTheme: result.SelectedTheme,
		AppliedTheme: result.AppliedTheme, SkinApplied: result.SkinApplied, NextAction: result.NextAction,
	}, nil
}
