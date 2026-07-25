package cdp

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sort"
)

const adapterAssetChunkBytes = 192 * 1024

//go:embed generated/adapter-manifest.json
var embeddedAdapterManifest []byte

type adapterArtifact struct {
	SchemaVersion   int    `json:"schemaVersion"`
	AdapterID       string `json:"adapterId"`
	ProbeExpression string `json:"probeExpression"`
	Source          string `json:"source"`
	SHA256          string `json:"sha256"`
}

func loadAdapterArtifact() (adapterArtifact, error) {
	var artifact adapterArtifact
	decoder := json.NewDecoder(bytes.NewReader(embeddedAdapterManifest))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&artifact); err != nil {
		return adapterArtifact{}, Error{Code: "ADAPTER_INCOMPATIBLE", Message: "Embedded CDP Adapter manifest is invalid"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return adapterArtifact{}, Error{Code: "ADAPTER_INCOMPATIBLE", Message: "Embedded CDP Adapter manifest has trailing data"}
	}
	digest := sha256.Sum256([]byte(artifact.AdapterID + "\n" + artifact.ProbeExpression + "\n" + artifact.Source))
	if artifact.SchemaVersion != 1 || artifact.AdapterID == "" || artifact.ProbeExpression == "" || artifact.Source == "" || len(artifact.Source) > maxMessageBytes/2 || len(artifact.SHA256) != 64 || artifact.SHA256 != hex.EncodeToString(digest[:]) {
		return adapterArtifact{}, Error{Code: "ADAPTER_INCOMPATIBLE", Message: "Embedded CDP Adapter hash is invalid"}
	}
	return artifact, nil
}

// ThemePayload is raw, already repository-validated Schema v4 data. Go only
// transfers it; compilation, injection, verification and cleanup remain in the
// reviewed TypeScript Adapter browser artifact.
type ThemePayload struct {
	Document   json.RawMessage
	Files      map[string][]byte
	TotalBytes int
}

func (connection *Connection) BootstrapAdapter(ctx context.Context) error {
	artifact, err := loadAdapterArtifact()
	if err != nil {
		return err
	}
	return connection.expectAdapterTrue(ctx, artifact.Source)
}

func (connection *Connection) ApplyTheme(ctx context.Context, payload ThemePayload) error {
	if !json.Valid(payload.Document) || len(payload.Document) == 0 || payload.TotalBytes < 1 || payload.TotalBytes > 32*1024*1024 {
		return Error{Code: "THEME_APPLY_FAILED", Message: "Theme payload is invalid"}
	}
	if err := connection.BootstrapAdapter(ctx); err != nil {
		return err
	}
	if err := connection.expectAdapterMethodTrue(ctx, "begin", json.RawMessage(payload.Document), payload.TotalBytes); err != nil {
		return err
	}
	paths := make([]string, 0, len(payload.Files))
	for path := range payload.Files {
		if !safeThemeAssetPath(path) {
			return Error{Code: "THEME_APPLY_FAILED", Message: "Theme asset path is invalid"}
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		encoded := base64.StdEncoding.EncodeToString(payload.Files[path])
		for len(encoded) > 0 {
			end := adapterAssetChunkBytes
			if end > len(encoded) {
				end = len(encoded)
			}
			if err := connection.expectAdapterMethodTrue(ctx, "append", path, encoded[:end]); err != nil {
				return err
			}
			encoded = encoded[end:]
		}
	}
	if err := connection.expectAdapterMethodTrue(ctx, "prepareApply"); err != nil {
		return err
	}
	preflight, err := connection.evaluateAdapterSource(ctx, "preflight")
	if err != nil {
		return err
	}
	if err := connection.expectAdapterMethodTrue(ctx, "validatePreflight", preflight); err != nil {
		return Error{Code: "THEME_APPLY_FAILED", Message: "Theme preflight validation failed"}
	}
	applySource, err := connection.adapterSource(ctx, "apply")
	if err != nil {
		return err
	}
	if err := connection.expectAdapterTrue(ctx, applySource); err != nil {
		return err
	}
	verification, err := connection.evaluateAdapterSource(ctx, "verify")
	if err != nil {
		return err
	}
	if err := connection.expectAdapterMethodTrue(ctx, "validateVerification", verification); err != nil {
		return Error{Code: "THEME_APPLY_FAILED", Message: "Theme verification failed"}
	}
	return nil
}

func (connection *Connection) RestoreTheme(ctx context.Context) error {
	if err := connection.BootstrapAdapter(ctx); err != nil {
		return err
	}
	removed, err := connection.evaluateAdapterSource(ctx, "remove")
	if err != nil {
		return err
	}
	official, err := connection.evaluateAdapterSource(ctx, "verifyOfficial")
	if err != nil {
		return err
	}
	if err := connection.expectAdapterMethodTrue(ctx, "validateRestore", removed, official); err != nil {
		return Error{Code: "THEME_CLEANUP_FAILED", Message: "Official appearance verification failed"}
	}
	return nil
}

func (connection *Connection) evaluateAdapterSource(ctx context.Context, name string) (json.RawMessage, error) {
	source, err := connection.adapterSource(ctx, name)
	if err != nil {
		return nil, err
	}
	return connection.Evaluate(ctx, source)
}

func (connection *Connection) adapterSource(ctx context.Context, name string) (string, error) {
	value, err := connection.Evaluate(ctx, `globalThis.__openChatGPTSkinAdapter.source(`+jsonString(name)+`)`)
	if err != nil {
		return "", err
	}
	var source string
	if json.Unmarshal(value, &source) != nil || source == "" || len(source) > maxMessageBytes/2 {
		return "", Error{Code: "ADAPTER_INCOMPATIBLE", Message: "CDP Adapter expression is invalid"}
	}
	return source, nil
}

func (connection *Connection) expectAdapterMethodTrue(ctx context.Context, method string, arguments ...any) error {
	encoded, err := json.Marshal(arguments)
	if err != nil {
		return err
	}
	return connection.expectAdapterTrue(ctx, `globalThis.__openChatGPTSkinAdapter[`+jsonString(method)+`].apply(null,`+string(encoded)+`)`)
}

func (connection *Connection) expectAdapterTrue(ctx context.Context, expression string) error {
	value, err := connection.Evaluate(ctx, expression)
	if err != nil {
		return err
	}
	var applied bool
	if err := json.Unmarshal(value, &applied); err != nil || !applied {
		return Error{Code: "THEME_APPLY_FAILED", Message: "CDP Adapter did not confirm the requested theme operation"}
	}
	return nil
}

func jsonString(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func safeThemeAssetPath(value string) bool {
	if len(value) < 1 || len(value) > 241 || value[0] == '/' || bytes.Contains([]byte(value), []byte("\\")) {
		return false
	}
	for _, part := range bytes.Split([]byte(value), []byte("/")) {
		if len(part) == 0 || bytes.Equal(part, []byte(".")) || bytes.Equal(part, []byte("..")) {
			return false
		}
	}
	return true
}
