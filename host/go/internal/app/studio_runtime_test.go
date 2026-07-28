package app

import (
	"errors"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/control"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/studio"
)

func TestStudioRuntimeStatusPreservesControllerRejection(t *testing.T) {
	_, err := studioRuntimeStatus(control.Response{
		ProtocolVersion: control.ProtocolVersion,
		RequestID:       "00000000-0000-4000-8000-000000000701",
		OK:              false,
		Error: &control.Error{
			Code:    "CDP_NOT_READY",
			Message: "Managed ChatGPT did not expose a compatible target",
		},
	})
	var runtimeError studio.RuntimeError
	if !errors.As(err, &runtimeError) || runtimeError.Code != "CDP_NOT_READY" ||
		runtimeError.Message != "Managed ChatGPT did not expose a compatible target" {
		t.Fatalf("error=%v", err)
	}
}
