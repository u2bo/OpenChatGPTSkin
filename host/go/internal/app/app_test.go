package app

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestParseDefaultsToStudio(t *testing.T) {
	command, err := Parse(nil)
	if err != nil {
		t.Fatal(err)
	}
	if command.Role != RoleStudio {
		t.Fatalf("role = %q, want %q", command.Role, RoleStudio)
	}
}

func TestParseRejectsUnknownRole(t *testing.T) {
	_, err := Parse([]string{"unknown"})
	if err == nil || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
		t.Fatalf("error = %v, want CLI_ARGUMENT_INVALID", err)
	}
}

func TestRuntimeRejectsMissingAndCommandSpecificThemeOptions(t *testing.T) {
	dataRoot := t.TempDir()
	_, err := runRuntime(context.Background(), []string{"launch", "--data-root", dataRoot})
	if err == nil || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
		t.Fatalf("missing theme error = %v", err)
	}
	_, err = runRuntime(context.Background(), []string{
		"status", "--data-root", dataRoot, "--theme", "mountain-mist",
	})
	if err == nil || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
		t.Fatalf("status theme error = %v", err)
	}
}

func TestStudioHealthUsesLoopbackAndHasNoBusinessFallback(t *testing.T) {
	studio, err := StartStudio(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	response, err := http.Get(studio.Origin + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d", response.StatusCode)
	}
	var body struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Role != "studio" {
		t.Fatalf("health role = %q", body.Role)
	}

	missing, err := http.Get(studio.Origin + "/api/themes")
	if err != nil {
		t.Fatal(err)
	}
	defer missing.Body.Close()
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("business fallback status = %d, want 404", missing.StatusCode)
	}
}
