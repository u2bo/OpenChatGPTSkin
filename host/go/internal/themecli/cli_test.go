package themecli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

var pngSignature = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

func commandObject(t *testing.T, result any, err error) map[string]any {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	contents, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(contents, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	contents, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestHelpDescribesTheMachineReadableThemeRole(t *testing.T) {
	result, err := Execute([]string{"help"})
	value := commandObject(t, result, err)
	if value["role"] != "theme" || value["protocolVersion"] != float64(1) {
		t.Fatalf("help=%+v", value)
	}
	commands, ok := value["commands"].(map[string]any)
	if !ok {
		t.Fatalf("commands=%T", value["commands"])
	}
	for _, name := range []string{"create", "config", "show", "validate", "pack", "unpack"} {
		if _, exists := commands[name]; !exists {
			t.Fatalf("help is missing %q: %+v", name, commands)
		}
	}
}

func TestCreateConfigureShowValidatePackAndUnpack(t *testing.T) {
	root := t.TempDir()
	background := filepath.Join(root, "background.png")
	if err := os.WriteFile(background, pngSignature, 0o600); err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(root, "agent-theme")
	created, err := Execute([]string{
		"create",
		"--dir", project,
		"--id", "agent-theme",
		"--name", "Agent Theme",
		"--author", "Theme Agent",
		"--appearance", "dark",
		"--background", background,
	})
	createdValue := commandObject(t, created, err)
	if createdValue["created"] != true || createdValue["complete"] != true {
		t.Fatalf("created=%+v", createdValue)
	}
	if _, err := Execute([]string{"validate", "--dir", project}); err != nil {
		t.Fatal(err)
	}

	patchPath := filepath.Join(root, "patch.json")
	writeJSON(t, patchPath, map[string]any{
		"description": "Configured by the executable",
		"colors":      map[string]any{"accent": "#abcdef"},
		"background":  map[string]any{"overlay": 0.5},
	})
	if _, err := Execute([]string{"config", "--dir", project, "--patch", patchPath}); err != nil {
		t.Fatal(err)
	}
	shown, err := Execute([]string{"show", "--dir", project})
	shownValue := commandObject(t, shown, err)
	theme := shownValue["theme"].(map[string]any)
	if theme["description"] != "Configured by the executable" ||
		theme["colors"].(map[string]any)["accent"] != "#abcdef" {
		t.Fatalf("theme=%+v", theme)
	}

	archive := filepath.Join(root, "agent-theme.ocskin")
	if _, err := Execute([]string{"pack", "--dir", project, "--out", archive}); err != nil {
		t.Fatal(err)
	}
	archiveBefore, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Execute([]string{"pack", "--dir", project, "--out", archive}); ErrorCode(err) != "CLI_WRITE" {
		t.Fatalf("existing archive error=%v code=%q", err, ErrorCode(err))
	}
	archiveAfter, err := os.ReadFile(archive)
	if err != nil || string(archiveAfter) != string(archiveBefore) {
		t.Fatalf("existing archive changed: error=%v", err)
	}

	unpacked := filepath.Join(root, "unpacked")
	if _, err := Execute([]string{"unpack", "--file", archive, "--out", unpacked}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(unpacked, "manifest.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := Execute([]string{"unpack", "--file", archive, "--out", unpacked}); ErrorCode(err) != "CLI_WRITE" {
		t.Fatalf("existing unpack error=%v code=%q", err, ErrorCode(err))
	}
}

func TestDraftAndRejectedConfigurationLeaveClearEvidence(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "draft-theme")
	if _, err := Execute([]string{
		"create",
		"--dir", project,
		"--id", "draft-theme",
		"--name", "Draft Theme",
		"--author", "Theme Agent",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := Execute([]string{"validate", "--dir", project, "--draft"}); err != nil {
		t.Fatal(err)
	}
	if _, err := Execute([]string{"validate", "--dir", project}); ErrorCode(err) != "THEME_SCHEMA_INVALID" {
		t.Fatalf("complete validation error=%v code=%q", err, ErrorCode(err))
	}

	themePath := filepath.Join(project, "theme.json")
	before, err := os.ReadFile(themePath)
	if err != nil {
		t.Fatal(err)
	}
	patchPath := filepath.Join(root, "invalid.json")
	writeJSON(t, patchPath, map[string]any{"unknown": true})
	if _, err := Execute([]string{"config", "--dir", project, "--patch", patchPath}); ErrorCode(err) != "THEME_SCHEMA_INVALID" {
		t.Fatalf("invalid patch error=%v code=%q", err, ErrorCode(err))
	}
	after, err := os.ReadFile(themePath)
	if err != nil || string(after) != string(before) {
		t.Fatalf("invalid patch changed theme: error=%v", err)
	}

	if err := os.WriteFile(patchPath, []byte(`{"__proto__":{"polluted":true}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Execute([]string{"config", "--dir", project, "--patch", patchPath}); ErrorCode(err) != "THEME_PATCH_INVALID" {
		t.Fatalf("forbidden patch error=%v code=%q", err, ErrorCode(err))
	}
}

func TestCreateRejectsInvalidAssetsAndUsageWithoutPartialOutput(t *testing.T) {
	root := t.TempDir()
	background := filepath.Join(root, "invalid.png")
	if err := os.WriteFile(background, []byte("not-a-png"), 0o600); err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(root, "invalid-theme")
	_, err := Execute([]string{
		"create",
		"--dir", project,
		"--id", "invalid-theme",
		"--name", "Invalid Theme",
		"--author", "Theme Agent",
		"--background", background,
	})
	if ErrorCode(err) != "ASSET_SIGNATURE_INVALID" {
		t.Fatalf("invalid asset error=%v code=%q", err, ErrorCode(err))
	}
	if _, statErr := os.Stat(project); !os.IsNotExist(statErr) {
		t.Fatalf("failed create left output: %v", statErr)
	}

	for _, arguments := range [][]string{
		{},
		{"unknown"},
		{"create", "--id", "one", "--id", "two"},
		{"create", "--appearance", "neon"},
	} {
		if _, err := Execute(arguments); !IsUsage(err) || ErrorCode(err) != "CLI_ARGUMENT_INVALID" {
			t.Fatalf("arguments=%v error=%v code=%q", arguments, err, ErrorCode(err))
		}
	}
}
