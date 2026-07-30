package themecli

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

var forbiddenPatchKeys = map[string]struct{}{
	"__proto__":   {},
	"constructor": {},
	"prototype":   {},
}

type createInput struct {
	directory  string
	id         string
	name       string
	author     string
	version    string
	appearance string
	background string
}

type createResult struct {
	directory string
	theme     map[string]any
	complete  bool
}

func defaultTheme(input createInput, backgroundPath string) map[string]any {
	assets := map[string]any{}
	if backgroundPath != "" {
		assets["background"] = backgroundPath
	}
	modules := []any{
		map[string]any{"id": "sidebar", "order": 0, "visible": true, "size": "regular", "align": "stretch", "spacing": 12},
		map[string]any{"id": "topbar", "order": 1, "visible": true, "size": "regular", "align": "stretch", "spacing": 12},
		map[string]any{"id": "hero", "order": 2, "visible": true, "size": "expanded", "align": "stretch", "spacing": 16},
		map[string]any{"id": "suggestions", "order": 3, "visible": true, "size": "regular", "align": "stretch", "spacing": 16},
		map[string]any{"id": "project-picker", "order": 4, "visible": true, "size": "regular", "align": "stretch", "spacing": 16},
		map[string]any{"id": "composer", "order": 5, "visible": true, "size": "regular", "align": "center", "spacing": 12},
		map[string]any{"id": "task-background", "order": 6, "visible": true, "size": "regular", "align": "stretch", "spacing": 0},
		map[string]any{"id": "content-layer", "order": 7, "visible": true, "size": "regular", "align": "stretch", "spacing": 12},
	}
	return map[string]any{
		"schemaVersion": 4,
		"kind":          "theme",
		"appearance":    input.appearance,
		"id":            input.id,
		"name":          input.name,
		"version":       input.version,
		"author":        input.author,
		"assets":        assets,
		"colors": map[string]any{
			"accent": "#10a37f", "secondary": "#7c3aed", "text": "#f7f7f8", "textSecondary": "#d1d5db",
			"muted": "#9ca3af", "link": "#34d399", "inputText": "#f7f7f8", "placeholder": "#9ca3af",
			"codeText": "#e5e7eb", "panel": "#171717", "border": "#3f3f46", "success": "#22c55e",
			"warning": "#f59e0b", "danger": "#ef4444", "info": "#38bdf8",
		},
		"typography": map[string]any{
			"uiFamily": "Segoe UI", "codeFamily": "Cascadia Code", "displayFamily": "Segoe UI", "scale": 1,
			"uiSize": 14, "codeSize": 13, "uiWeight": 500, "codeWeight": 400, "lineHeight": 1.5,
			"displaySize": 32, "displayWeight": 600, "displayLineHeight": 1.2, "displayLetterSpacing": 0,
		},
		"background": map[string]any{
			"positionX": 0.5, "positionY": 0.5, "scale": 1, "blur": 0, "brightness": 1, "overlay": 0.35,
			"safeArea": "auto", "taskMode": "full", "taskOpacity": 0.82,
		},
		"surfaces":        map[string]any{"baseOpacity": 0.68, "elevatedOpacity": 0.92, "terminalOpacity": 0.82, "blur": 0},
		"interfaceImages": map[string]any{"profileAvatarSize": 24, "suggestionIconSize": 20, "projectIconSize": 16},
		"decorations":     []any{},
		"composition":     map[string]any{"layers": []any{}},
		"layout": map[string]any{
			"heroHeight": 320, "cardColumns": 4, "composerWidth": 0.7, "sidebarDensity": "comfortable", "moduleGap": 16, "modules": modules,
		},
		"rights": map[string]any{"licenseId": "LicenseRef-User-Supplied", "attribution": input.author, "localOnly": true},
	}
}

func backgroundTarget(source string) (string, error) {
	extension := strings.ToLower(filepath.Ext(source))
	switch extension {
	case ".png", ".jpg", ".jpeg", ".webp":
		return "assets/background" + extension, nil
	default:
		return "", commandError("ASSET_UNSUPPORTED", "background must be a PNG, JPEG, or WebP file")
	}
}

func normalizeDraft(value map[string]any) ([]byte, map[string]any, error) {
	contents, err := json.Marshal(value)
	if err != nil {
		return nil, nil, commandError("THEME_SCHEMA_INVALID", "theme document could not be encoded")
	}
	normalized, _, err := themerepo.NormalizeDraftDocument(contents)
	if err != nil {
		return nil, nil, err
	}
	decoded, err := decodeJSONObject(normalized, "THEME_SCHEMA_INVALID")
	if err != nil {
		return nil, nil, err
	}
	return normalized, decoded, nil
}

func createProject(input createInput) (_ createResult, returnErr error) {
	directory, err := filepath.Abs(input.directory)
	if err != nil {
		return createResult{}, commandError("CLI_WRITE", "destination path is invalid")
	}
	backgroundPath := ""
	var backgroundContents []byte
	if input.background != "" {
		backgroundPath, err = backgroundTarget(input.background)
		if err != nil {
			return createResult{}, err
		}
		backgroundContents, err = readRegularFile(input.background, maxThemeImageBytes, "CLI_READ")
		if err != nil {
			return createResult{}, err
		}
	}
	document, theme, err := normalizeDraft(defaultTheme(input, backgroundPath))
	if err != nil {
		return createResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(directory), 0o700); err != nil {
		return createResult{}, commandError("CLI_WRITE", "destination parent could not be created")
	}
	if err := os.Mkdir(directory, 0o700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return createResult{}, commandError("CLI_WRITE", "destination already exists")
		}
		return createResult{}, commandError("CLI_WRITE", "destination could not be created")
	}
	created := true
	defer func() {
		if returnErr == nil || !created {
			return
		}
		if cleanupErr := os.RemoveAll(directory); cleanupErr != nil {
			returnErr = errors.Join(returnErr, cleanupErr)
		}
	}()
	for _, name := range []string{"assets", "fonts"} {
		if err := os.Mkdir(filepath.Join(directory, name), 0o700); err != nil {
			return createResult{}, commandError("CLI_WRITE", "theme project directories could not be created")
		}
	}
	if err := writeExclusiveFile(filepath.Join(directory, "theme.json"), document); err != nil {
		return createResult{}, err
	}
	if backgroundPath != "" {
		if err := writeExclusiveFile(filepath.Join(directory, filepath.FromSlash(backgroundPath)), backgroundContents); err != nil {
			return createResult{}, err
		}
		bundle, err := themerepo.LoadDirectory(directory)
		if err != nil {
			return createResult{}, err
		}
		theme, err = decodeJSONObject(bundle.Document, "THEME_SCHEMA_INVALID")
		if err != nil {
			return createResult{}, err
		}
	}
	created = false
	return createResult{directory: directory, theme: theme, complete: backgroundPath != ""}, nil
}

func readProject(directory string) (map[string]any, string, error) {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, "", commandError("CLI_READ", "theme directory path is invalid")
	}
	contents, err := readRegularFile(filepath.Join(absolute, "theme.json"), maxThemeJSONBytes, "CLI_READ")
	if err != nil {
		return nil, "", err
	}
	value, err := decodeJSONObject(contents, "THEME_SCHEMA_INVALID")
	if err != nil {
		return nil, "", err
	}
	_, normalized, err := normalizeDraft(value)
	if err != nil {
		return nil, "", err
	}
	return normalized, absolute, nil
}

func configureProject(directory string, patch map[string]any) (map[string]any, string, error) {
	current, absolute, err := readProject(directory)
	if err != nil {
		return nil, "", err
	}
	merged, ok := mergeJSON(current, patch).(map[string]any)
	if !ok {
		return nil, "", commandError("THEME_PATCH_INVALID", "JSON Merge Patch root must be an object")
	}
	document, theme, err := normalizeDraft(merged)
	if err != nil {
		return nil, "", err
	}
	if err := atomicReplace(filepath.Join(absolute, "theme.json"), document); err != nil {
		return nil, "", err
	}
	return theme, absolute, nil
}

func readJSONPatch(path string) (map[string]any, error) {
	contents, err := readRegularFile(path, maxThemeJSONBytes, "CLI_READ")
	if err != nil {
		return nil, err
	}
	patch, err := decodeJSONObject(contents, "THEME_PATCH_INVALID")
	if err != nil {
		return nil, err
	}
	if err := rejectForbiddenPatchKeys(patch); err != nil {
		return nil, err
	}
	return patch, nil
}

func rejectForbiddenPatchKeys(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, forbidden := forbiddenPatchKeys[key]; forbidden {
				return commandError("THEME_PATCH_INVALID", "forbidden JSON Merge Patch key: "+key)
			}
			if err := rejectForbiddenPatchKeys(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := rejectForbiddenPatchKeys(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func mergeJSON(current, patch any) any {
	patchObject, isObject := patch.(map[string]any)
	if !isObject {
		return patch
	}
	result := make(map[string]any, len(patchObject))
	if currentObject, ok := current.(map[string]any); ok {
		for key, value := range currentObject {
			result[key] = value
		}
	}
	for key, value := range patchObject {
		if value == nil {
			delete(result, key)
			continue
		}
		result[key] = mergeJSON(result[key], value)
	}
	return result
}

func decodeJSONObject(contents []byte, code string) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, commandError(code, "JSON document is invalid")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, commandError(code, "JSON document has trailing content")
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, commandError(code, "JSON document root must be an object")
	}
	return object, nil
}

func writeExclusiveFile(path string, contents []byte) (returnErr error) {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return commandError("CLI_WRITE", "destination already exists or could not be created")
	}
	committed := false
	closed := false
	defer func() {
		if !closed {
			if closeErr := file.Close(); closeErr != nil {
				returnErr = errors.Join(returnErr, commandError("CLI_WRITE", "destination could not be closed"))
			}
		}
		if !committed {
			if cleanupErr := os.Remove(path); cleanupErr != nil && !errors.Is(cleanupErr, os.ErrNotExist) {
				returnErr = errors.Join(returnErr, commandError("CLI_WRITE", "partial destination could not be removed"))
			}
		}
	}()
	if _, err := file.Write(contents); err != nil {
		return commandError("CLI_WRITE", "destination could not be written")
	}
	if err := file.Sync(); err != nil {
		return commandError("CLI_WRITE", "destination could not be synchronized")
	}
	closeErr := file.Close()
	closed = true
	if closeErr != nil {
		return commandError("CLI_WRITE", "destination could not be closed")
	}
	committed = true
	return nil
}

func writeNewFile(path string, contents []byte) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", commandError("CLI_WRITE", "destination path is invalid")
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return "", commandError("CLI_WRITE", "destination parent could not be created")
	}
	if err := writeExclusiveFile(absolute, contents); err != nil {
		return "", err
	}
	return absolute, nil
}

func atomicReplace(path string, contents []byte) (returnErr error) {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".theme.json-*.tmp")
	if err != nil {
		return commandError("CLI_WRITE", "temporary theme file could not be created")
	}
	temporaryPath := temporary.Name()
	committed := false
	closed := false
	defer func() {
		if !closed {
			if closeErr := temporary.Close(); closeErr != nil {
				returnErr = errors.Join(returnErr, commandError("CLI_WRITE", "temporary theme file could not be closed"))
			}
		}
		if !committed {
			if cleanupErr := os.Remove(temporaryPath); cleanupErr != nil && !errors.Is(cleanupErr, os.ErrNotExist) {
				returnErr = errors.Join(returnErr, commandError("CLI_WRITE", "temporary theme file could not be removed"))
			}
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return commandError("CLI_WRITE", "temporary theme file permissions could not be set")
	}
	if _, err := temporary.Write(contents); err != nil {
		return commandError("CLI_WRITE", "temporary theme file could not be written")
	}
	if err := temporary.Sync(); err != nil {
		return commandError("CLI_WRITE", "temporary theme file could not be synchronized")
	}
	closeErr := temporary.Close()
	closed = true
	if closeErr != nil {
		return commandError("CLI_WRITE", "temporary theme file could not be closed")
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return commandError("CLI_WRITE", "theme.json could not be replaced")
	}
	committed = true
	return nil
}
