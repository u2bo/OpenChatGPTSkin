// Package workspace owns the mutable Theme Studio draft state. It deliberately
// stores the same draft.json shape and asset layout as the v0.2 Node host so a
// user can safely roll a dataRoot back while the Go cutover remains provisional.
package workspace

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	imagepipeline "github.com/u2bo/OpenChatGPTSkin/host/go/internal/image"
	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

const historyLimit = 50

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var assetKeyPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type Error struct {
	Code       string
	Message    string
	NextAction string
}

func (err Error) Error() string { return err.Message }

func ErrorCode(err error) string {
	var value Error
	if errors.As(err, &value) {
		return value.Code
	}
	return "INTERNAL"
}

type Issue struct {
	Code     string `json:"code"`
	Path     string `json:"path"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
}

// Draft is the public Studio contract. Theme deliberately remains raw JSON:
// the schema author source is TypeScript, while Go verifies and normalises it
// without inventing a second, lossy object model.
type Draft struct {
	DraftID       string            `json:"draftId"`
	Theme         json.RawMessage   `json:"theme"`
	Revision      int               `json:"revision"`
	UpdatedAt     string            `json:"updatedAt"`
	SavedRef      *themerepo.Ref    `json:"savedRef"`
	Dirty         bool              `json:"dirty"`
	UndoAvailable bool              `json:"undoAvailable"`
	RedoAvailable bool              `json:"redoAvailable"`
	Issues        []Issue           `json:"issues"`
	AssetURLs     map[string]string `json:"assetUrls"`
}

type CreateInput struct {
	Source             string
	Ref                themerepo.Ref
	ThemeID            string
	Name               string
	ConflictResolution string
}

type UploadInput struct {
	DraftID          string
	ExpectedRevision int
	Slot             string
	AssetKey         string
	FileName         string
	MIMEType         string
	Bytes            []byte
}

type ClearAssetInput struct {
	DraftID          string
	ExpectedRevision int
	Slot             string
	AssetKey         string
}

type record struct {
	SchemaVersion int               `json:"schemaVersion"`
	DraftID       string            `json:"draftId"`
	Theme         json.RawMessage   `json:"theme"`
	Revision      int               `json:"revision"`
	UpdatedAt     string            `json:"updatedAt"`
	SavedRef      *themerepo.Ref    `json:"savedRef"`
	Dirty         bool              `json:"dirty"`
	Past          []json.RawMessage `json:"past"`
	Future        []json.RawMessage `json:"future"`
}

type Workspace struct {
	repository *themerepo.Repository
	root       string
	builtinIDs []string
	mu         sync.Mutex
}

func New(repository *themerepo.Repository, root string) (*Workspace, error) {
	if repository == nil || root == "" {
		return nil, Error{Code: "STUDIO_DRAFT_INVALID", Message: "Draft storage is unavailable"}
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	builtins, err := repository.BuiltinRefs()
	if err != nil {
		return nil, err
	}
	builtinIDs := make([]string, 0, len(builtins))
	for _, builtin := range builtins {
		builtinIDs = append(builtinIDs, builtin.ID)
	}
	sort.Strings(builtinIDs)
	workspace := &Workspace{repository: repository, root: absolute, builtinIDs: builtinIDs}
	if err := os.MkdirAll(absolute, 0o700); err != nil {
		return nil, err
	}
	if err := workspace.removeDuplicateDrafts(); err != nil {
		return nil, err
	}
	return workspace, nil
}

func (workspace *Workspace) Create(input CreateInput) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	if input.Source != "builtin" && input.Source != "personal" {
		return Draft{}, Error{Code: "STUDIO_REQUEST_INVALID", Message: "Theme source is unavailable"}
	}
	bundle, err := workspace.repository.Read(input.Source, input.Ref)
	if err != nil {
		return Draft{}, err
	}
	return workspace.createFromBundleLocked(input, bundle)
}

func (workspace *Workspace) Import(contents []byte) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	ref, err := workspace.repository.ImportArchive(contents)
	if err != nil {
		return Draft{}, Error{Code: "STUDIO_IMPORT_INVALID", Message: err.Error()}
	}
	bundle, err := workspace.repository.Read("personal", ref)
	if err != nil {
		return Draft{}, Error{Code: "STUDIO_IMPORT_INVALID", Message: err.Error()}
	}
	return workspace.createFromBundleLocked(CreateInput{
		Source: "personal", Ref: ref, ThemeID: ref.ID, ConflictResolution: "overwrite-existing",
	}, bundle)
}

func (workspace *Workspace) createFromBundleLocked(input CreateInput, bundle themerepo.Bundle) (Draft, error) {
	theme, ref, err := workspace.prepareSourceTheme(bundle.Document, input)
	if err != nil {
		return Draft{}, err
	}
	group := workspace.groupKey(ref.ID)
	existing, err := workspace.findByGroup(group)
	if err != nil {
		return Draft{}, err
	}
	if existing != nil && input.ConflictResolution == "" {
		return Draft{}, Error{Code: "STUDIO_DRAFT_CONFLICT", Message: "该主题已有草稿", NextAction: "请选择加载已有草稿或覆盖现有草稿。"}
	}
	if existing != nil && input.ConflictResolution == "load-existing" {
		return workspace.view(*existing)
	}
	if input.ConflictResolution != "" && input.ConflictResolution != "overwrite-existing" && input.ConflictResolution != "load-existing" {
		return Draft{}, Error{Code: "STUDIO_REQUEST_INVALID", Message: "Draft conflict resolution is invalid"}
	}
	draftID := newUUID()
	revision := 0
	if existing != nil {
		draftID, revision = existing.DraftID, existing.Revision+1
	}
	savedRef := (*themerepo.Ref)(nil)
	if input.Source == "personal" {
		value := input.Ref
		savedRef = &value
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	next := record{SchemaVersion: 1, DraftID: draftID, Theme: theme, Revision: revision, UpdatedAt: now, SavedRef: savedRef, Dirty: savedRef == nil, Past: []json.RawMessage{}, Future: []json.RawMessage{}}
	if err := workspace.writeBundleAssets(draftID, bundle, theme); err != nil {
		return Draft{}, err
	}
	if err := workspace.writeRecord(next); err != nil {
		return Draft{}, err
	}
	return workspace.view(next)
}

func (workspace *Workspace) Open(draftID string) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(draftID)
	if err != nil {
		return Draft{}, err
	}
	return workspace.view(record)
}

func (workspace *Workspace) Latest() (*Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	records, err := workspace.listRecords()
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	sort.Slice(records, func(left, right int) bool {
		return records[left].UpdatedAt > records[right].UpdatedAt || records[left].UpdatedAt == records[right].UpdatedAt && records[left].DraftID > records[right].DraftID
	})
	view, err := workspace.view(records[0])
	return &view, err
}

func (workspace *Workspace) Update(draftID string, expectedRevision int, theme json.RawMessage) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(draftID)
	if err != nil {
		return Draft{}, err
	}
	if err := assertRevision(record, expectedRevision); err != nil {
		return Draft{}, err
	}
	normalized, ref, err := themerepo.NormalizeDraftDocument(theme)
	if err != nil {
		return Draft{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: err.Error()}
	}
	if workspace.isReservedID(ref.ID) {
		return Draft{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: "Theme ID is reserved by the built-in catalog"}
	}
	if record.Theme != nil && bytes.Equal(normalized, record.Theme) {
		return workspace.view(record)
	}
	next := mutateHistory(record, normalized)
	if err := workspace.writeRecord(next); err != nil {
		return Draft{}, err
	}
	return workspace.view(next)
}

// Upload processes an asset completely before the draft is mutated. This
// preserves the one-upload/one-revision invariant and leaves the old draft
// untouched if decoding, limits, or a filesystem write fails.
func (workspace *Workspace) Upload(input UploadInput) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(input.DraftID)
	if err != nil {
		return Draft{}, err
	}
	if err := assertRevision(record, input.ExpectedRevision); err != nil {
		return Draft{}, err
	}
	path, contents, err := normalizeAsset(input)
	if err != nil {
		return Draft{}, err
	}
	nextTheme, err := attachAsset(record.Theme, input, path)
	if err != nil {
		return Draft{}, err
	}
	normalized, _, err := themerepo.NormalizeDraftDocument(nextTheme)
	if err != nil {
		return Draft{}, Error{Code: "STUDIO_ASSET_INVALID", Message: err.Error()}
	}
	target := workspace.assetPath(input.DraftID, path)
	_, existed := os.Stat(target)
	if err := workspace.writeAsset(input.DraftID, path, contents); err != nil {
		return Draft{}, err
	}
	next := mutateHistory(record, normalized)
	if err := workspace.writeRecord(next); err != nil {
		if errors.Is(existed, os.ErrNotExist) {
			_ = os.Remove(target)
		}
		return Draft{}, err
	}
	return workspace.view(next)
}

func (workspace *Workspace) ClearAsset(input ClearAssetInput) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(input.DraftID)
	if err != nil {
		return Draft{}, err
	}
	if err := assertRevision(record, input.ExpectedRevision); err != nil {
		return Draft{}, err
	}
	nextTheme, err := detachAsset(record.Theme, input)
	if err != nil {
		return Draft{}, err
	}
	normalized, _, err := themerepo.NormalizeDraftDocument(nextTheme)
	if err != nil {
		return Draft{}, Error{Code: "STUDIO_ASSET_INVALID", Message: err.Error()}
	}
	next := mutateHistory(record, normalized)
	if err := workspace.writeRecord(next); err != nil {
		return Draft{}, err
	}
	return workspace.view(next)
}

func (workspace *Workspace) Undo(draftID string, expectedRevision int) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(draftID)
	if err != nil {
		return Draft{}, err
	}
	if err := assertRevision(record, expectedRevision); err != nil {
		return Draft{}, err
	}
	if len(record.Past) == 0 {
		return workspace.view(record)
	}
	previous := record.Past[len(record.Past)-1]
	next := record
	next.Theme = cloneJSON(previous)
	next.Past = append([]json.RawMessage(nil), record.Past[:len(record.Past)-1]...)
	next.Future = append([]json.RawMessage{cloneJSON(record.Theme)}, record.Future...)
	if len(next.Future) > historyLimit {
		next.Future = next.Future[:historyLimit]
	}
	next.Revision++
	next.UpdatedAt = now()
	next.Dirty = true
	if err := workspace.writeRecord(next); err != nil {
		return Draft{}, err
	}
	return workspace.view(next)
}

func (workspace *Workspace) Redo(draftID string, expectedRevision int) (Draft, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(draftID)
	if err != nil {
		return Draft{}, err
	}
	if err := assertRevision(record, expectedRevision); err != nil {
		return Draft{}, err
	}
	if len(record.Future) == 0 {
		return workspace.view(record)
	}
	next := record
	next.Theme = cloneJSON(record.Future[0])
	next.Past = append(next.Past, cloneJSON(record.Theme))
	if len(next.Past) > historyLimit {
		next.Past = next.Past[len(next.Past)-historyLimit:]
	}
	next.Future = append([]json.RawMessage(nil), record.Future[1:]...)
	next.Revision++
	next.UpdatedAt = now()
	next.Dirty = true
	if err := workspace.writeRecord(next); err != nil {
		return Draft{}, err
	}
	return workspace.view(next)
}

// Validate intentionally does not write. The UI calls it before an explicit
// save, and a failed validation must never create another draft revision.
func (workspace *Workspace) Validate(draftID string) (Draft, error) {
	return workspace.Open(draftID)
}

func (workspace *Workspace) Save(draftID string, expectedRevision int) (Draft, themerepo.Ref, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(draftID)
	if err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	if err := assertRevision(record, expectedRevision); err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	if !record.Dirty && record.SavedRef != nil {
		view, viewErr := workspace.view(record)
		return view, *record.SavedRef, viewErr
	}
	_, ref, err := themerepo.NormalizeDocument(record.Theme)
	if err != nil {
		return Draft{}, themerepo.Ref{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: err.Error()}
	}
	if workspace.isReservedID(ref.ID) {
		return Draft{}, themerepo.Ref{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: "Theme ID is reserved by the built-in catalog"}
	}
	version, err := workspace.nextVersion(ref.ID)
	if err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	versioned, _, err := setThemeFields(record.Theme, ref.ID, "", version)
	if err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	paths, err := themerepo.AssetPaths(versioned)
	if err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	files, err := workspace.readAssets(draftID, paths)
	if err != nil {
		return Draft{}, themerepo.Ref{}, Error{Code: "STUDIO_SAVE_FAILED", Message: err.Error()}
	}
	background, err := backgroundAsset(versioned)
	if err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	preview, err := imagepipeline.Process(files[background], imagepipeline.Options{
		Width: 640, Height: 400, Quality: 84, Fit: imagepipeline.FitCover, MaxInputBytes: 16 * 1024 * 1024,
	})
	if err != nil {
		return Draft{}, themerepo.Ref{}, Error{Code: "STUDIO_SAVE_FAILED", Message: err.Error()}
	}
	files["preview.webp"] = preview
	saved, err := workspace.repository.InstallPersonal(themerepo.Bundle{Ref: themerepo.Ref{ID: ref.ID, Version: version}, Document: versioned, Files: files})
	if err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	next := record
	next.Theme = versioned
	next.Revision++
	next.UpdatedAt = now()
	next.SavedRef = &saved
	next.Dirty = false
	if err := workspace.writeRecord(next); err != nil {
		return Draft{}, themerepo.Ref{}, err
	}
	view, err := workspace.view(next)
	return view, saved, err
}

func (workspace *Workspace) DeletePersonal(id string, version *string) error {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	return workspace.repository.DeletePersonal(id, version)
}

func (workspace *Workspace) Export(ref themerepo.Ref) ([]byte, error) {
	return workspace.repository.Export("personal", ref)
}

func (workspace *Workspace) ReadAsset(draftID, path string) (themerepo.Asset, error) {
	workspace.mu.Lock()
	defer workspace.mu.Unlock()
	record, err := workspace.readRecord(draftID)
	if err != nil {
		return themerepo.Asset{}, err
	}
	paths, err := themerepo.AssetPaths(record.Theme)
	if err != nil {
		return themerepo.Asset{}, Error{Code: "STUDIO_ASSET_INVALID", Message: err.Error()}
	}
	found := false
	for _, candidate := range paths {
		if candidate == path {
			found = true
			break
		}
	}
	if !found {
		return themerepo.Asset{}, Error{Code: "STUDIO_ASSET_INVALID", Message: "Draft asset is not declared"}
	}
	contents, err := os.ReadFile(workspace.assetPath(draftID, path))
	if err != nil {
		return themerepo.Asset{}, err
	}
	mimeType := "image/webp"
	if strings.HasSuffix(strings.ToLower(path), ".woff2") {
		mimeType = "font/woff2"
	}
	return themerepo.Asset{Bytes: contents, MIMEType: mimeType}, nil
}

func (workspace *Workspace) prepareSourceTheme(contents []byte, input CreateInput) (json.RawMessage, themerepo.Ref, error) {
	normalized, ref, err := themerepo.NormalizeDocument(contents)
	if err != nil {
		return nil, themerepo.Ref{}, err
	}
	id := input.ThemeID
	if id == "" {
		if input.Source == "personal" {
			id = ref.ID
		} else {
			id = strings.TrimSuffix(ref.ID+"-custom", "-")
		}
	}
	if workspace.isReservedID(id) {
		return nil, themerepo.Ref{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: "Theme ID is reserved by the built-in catalog"}
	}
	version := "0.0.0"
	if input.Source == "personal" {
		version = ref.Version
	}
	updated, updatedRef, err := setThemeFields(normalized, id, input.Name, version)
	if err != nil {
		return nil, themerepo.Ref{}, err
	}
	return updated, updatedRef, nil
}

func setThemeFields(document []byte, id, name, version string) (json.RawMessage, themerepo.Ref, error) {
	var object map[string]any
	decoder := json.NewDecoder(bytes.NewReader(document))
	decoder.UseNumber()
	if err := decoder.Decode(&object); err != nil {
		return nil, themerepo.Ref{}, err
	}
	if id != "" {
		object["id"] = id
	}
	if name != "" {
		object["name"] = name
	}
	if version != "" {
		object["version"] = version
	}
	encoded, err := json.Marshal(object)
	if err != nil {
		return nil, themerepo.Ref{}, err
	}
	normalized, ref, err := themerepo.NormalizeDraftDocument(encoded)
	return json.RawMessage(normalized), ref, err
}

func backgroundAsset(document []byte) (string, error) {
	value, _, err := themeObject(document)
	if err != nil {
		return "", err
	}
	assets, _ := value["assets"].(map[string]any)
	background, ok := assets["background"].(string)
	if !ok || background == "" {
		return "", Error{Code: "STUDIO_DRAFT_INVALID", Message: "Background image is required"}
	}
	return background, nil
}

func normalizeAsset(input UploadInput) (string, []byte, error) {
	if !validSlot(input.Slot) || strings.TrimSpace(input.FileName) == "" || len(input.FileName) > 160 {
		return "", nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Asset upload metadata is invalid"}
	}
	if isFontSlot(input.Slot) {
		if len(input.Bytes) == 0 || len(input.Bytes) > 5*1024*1024 || strings.ToLower(filepath.Ext(input.FileName)) != ".woff2" || !validWOFF2(input.Bytes) {
			return "", nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Font must be a valid WOFF2 file up to 5 MB"}
		}
		key, err := requiredAssetKey(input.Slot, input.AssetKey)
		if err != nil {
			return "", nil, err
		}
		return "fonts/" + key + "-" + digest(input.Bytes) + ".woff2", append([]byte(nil), input.Bytes...), nil
	}
	if len(input.Bytes) == 0 || len(input.Bytes) > 50*1024*1024 || !validImageType(input.FileName, input.MIMEType) {
		return "", nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Image must be a PNG, JPEG, or WebP file up to 50 MB"}
	}
	options := imagepipeline.Options{Quality: 80, Fit: imagepipeline.FitInside, NoUpscale: true, MaxInputBytes: 50 * 1024 * 1024}
	switch input.Slot {
	case "background":
		options.Width, options.Height = 2400, 1350
	case "profile-avatar":
		options.Width, options.Height, options.Fit, options.NoUpscale = 256, 256, imagepipeline.FitCover, false
	case "suggestion-card1", "suggestion-card2", "suggestion-card3", "suggestion-card4", "project-icon1", "project-icon2", "project-icon3", "project-icon4":
		options.Width, options.Height, options.Fit, options.NoUpscale = 192, 192, imagepipeline.FitCover, false
	default:
		options.Width, options.Height = 1400, 1400
	}
	processed, err := imagepipeline.Process(input.Bytes, options)
	if err != nil {
		return "", nil, Error{Code: "STUDIO_ASSET_INVALID", Message: err.Error()}
	}
	name := "decoration"
	switch input.Slot {
	case "background":
		name = "background"
	case "portrait":
		name = "portrait"
	case "profile-avatar":
		name = "profile-avatar"
	case "suggestion-card1", "suggestion-card2", "suggestion-card3", "suggestion-card4", "project-icon1", "project-icon2", "project-icon3", "project-icon4":
		name = input.Slot
	case "decoration", "composition-layer":
		key, keyErr := requiredAssetKey(input.Slot, input.AssetKey)
		if keyErr != nil {
			return "", nil, keyErr
		}
		name += "-" + key
	}
	return "assets/" + name + "-" + digest(processed) + ".webp", processed, nil
}

func attachAsset(document []byte, input UploadInput, assetPath string) ([]byte, error) {
	value, assets, err := themeObject(document)
	if err != nil {
		return nil, err
	}
	switch input.Slot {
	case "background", "portrait", "profile-avatar":
		field := map[string]string{"background": "background", "portrait": "portrait", "profile-avatar": "profileAvatar"}[input.Slot]
		assets[field] = assetPath
	case "suggestion-card1", "suggestion-card2", "suggestion-card3", "suggestion-card4":
		icons := objectField(assets, "suggestionIcons")
		icons[strings.TrimPrefix(input.Slot, "suggestion-")] = assetPath
	case "project-icon1", "project-icon2", "project-icon3", "project-icon4":
		index := int(input.Slot[len(input.Slot)-1] - '1')
		icons, err := stringSliceField(assets, "projectIcons")
		if err != nil {
			return nil, err
		}
		for len(icons) <= index {
			icons = append(icons, assetPath)
		}
		icons[index] = assetPath
		assets["projectIcons"] = stringsToAny(icons)
	case "decoration", "composition-layer":
		key, err := requiredAssetKey(input.Slot, input.AssetKey)
		if err != nil {
			return nil, err
		}
		decorations := objectField(assets, "decorations")
		decorations[key] = assetPath
		if input.Slot == "decoration" {
			entries, err := anySliceField(value, "decorations")
			if err != nil {
				return nil, err
			}
			entry := map[string]any{"type": "image", "enabled": true, "intensity": 0.6, "assetKey": key, "placement": "corners", "opacity": 0.75, "scale": 1}
			replaced := false
			for index, candidate := range entries {
				if item, ok := candidate.(map[string]any); ok && item["assetKey"] == key {
					entries[index], replaced = entry, true
					break
				}
			}
			if !replaced {
				if len(entries) >= 16 {
					return nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "A theme can contain at most 16 decorations"}
				}
				entries = append(entries, entry)
			}
			value["decorations"] = entries
		} else if err := upsertCompositionLayer(value, key); err != nil {
			return nil, err
		}
	case "ui-font", "code-font", "display-font":
		key, err := requiredAssetKey(input.Slot, input.AssetKey)
		if err != nil {
			return nil, err
		}
		fonts := objectField(assets, "fonts")
		fonts[key] = assetPath
		typography := objectField(value, "typography")
		field := map[string]string{"ui-font": "uiFontAssetKey", "code-font": "codeFontAssetKey", "display-font": "displayFontAssetKey"}[input.Slot]
		typography[field] = key
		family := map[string]string{"ui-font": "uiFamily", "code-font": "codeFamily", "display-font": "displayFamily"}[input.Slot]
		typography[family] = "ocs-" + key
	default:
		return nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Asset slot is unavailable"}
	}
	return json.Marshal(value)
}

func detachAsset(document []byte, input ClearAssetInput) ([]byte, error) {
	if !validSlot(input.Slot) {
		return nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Asset slot is unavailable"}
	}
	value, assets, err := themeObject(document)
	if err != nil {
		return nil, err
	}
	switch input.Slot {
	case "background", "portrait", "profile-avatar":
		delete(assets, map[string]string{"background": "background", "portrait": "portrait", "profile-avatar": "profileAvatar"}[input.Slot])
	case "suggestion-card1", "suggestion-card2", "suggestion-card3", "suggestion-card4":
		delete(objectField(assets, "suggestionIcons"), strings.TrimPrefix(input.Slot, "suggestion-"))
	case "project-icon1", "project-icon2", "project-icon3", "project-icon4":
		icons, err := stringSliceField(assets, "projectIcons")
		if err != nil {
			return nil, err
		}
		index := int(input.Slot[len(input.Slot)-1] - '1')
		if index < len(icons) {
			icons = append(icons[:index], icons[index+1:]...)
		}
		if len(icons) == 0 {
			delete(assets, "projectIcons")
		} else {
			assets["projectIcons"] = stringsToAny(icons)
		}
	case "decoration", "composition-layer":
		key, err := requiredAssetKey(input.Slot, input.AssetKey)
		if err != nil {
			return nil, err
		}
		delete(objectField(assets, "decorations"), key)
		entries, sliceErr := anySliceField(value, "decorations")
		if sliceErr != nil {
			return nil, sliceErr
		}
		value["decorations"] = filterAssetKey(entries, key)
		if composition, ok := value["composition"].(map[string]any); ok {
			if layers, ok := composition["layers"].([]any); ok {
				composition["layers"] = filterCompositionKey(layers, key)
			}
		}
	case "ui-font", "code-font", "display-font":
		key, err := requiredAssetKey(input.Slot, input.AssetKey)
		if err != nil {
			return nil, err
		}
		delete(objectField(assets, "fonts"), key)
		typography := objectField(value, "typography")
		delete(typography, map[string]string{"ui-font": "uiFontAssetKey", "code-font": "codeFontAssetKey", "display-font": "displayFontAssetKey"}[input.Slot])
	}
	return json.Marshal(value)
}

func themeObject(document []byte) (map[string]any, map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(document))
	decoder.UseNumber()
	value := map[string]any{}
	if err := decoder.Decode(&value); err != nil {
		return nil, nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Theme draft is invalid"}
	}
	assets, ok := value["assets"].(map[string]any)
	if !ok {
		return nil, nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Theme assets are invalid"}
	}
	return value, assets, nil
}

func objectField(parent map[string]any, key string) map[string]any {
	if value, ok := parent[key].(map[string]any); ok {
		return value
	}
	value := map[string]any{}
	parent[key] = value
	return value
}

func anySliceField(parent map[string]any, key string) ([]any, error) {
	if value, exists := parent[key]; exists {
		entries, ok := value.([]any)
		if !ok {
			return nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Theme asset collection is invalid"}
		}
		return append([]any(nil), entries...), nil
	}
	return []any{}, nil
}

func stringSliceField(parent map[string]any, key string) ([]string, error) {
	entries, err := anySliceField(parent, key)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		value, ok := entry.(string)
		if !ok {
			return nil, Error{Code: "STUDIO_ASSET_INVALID", Message: "Theme icon collection is invalid"}
		}
		result = append(result, value)
	}
	return result, nil
}

func upsertCompositionLayer(theme map[string]any, key string) error {
	composition := objectField(theme, "composition")
	layers, err := anySliceField(composition, "layers")
	if err != nil {
		return err
	}
	layer := map[string]any{
		"id": key, "asset": map[string]any{"kind": "decoration", "assetKey": key}, "surface": "home-hero",
		"anchor": "top-left", "positionX": 0.1, "positionY": 0.1, "width": 0.2, "opacity": 1, "rotation": 0, "required": false,
	}
	for index, candidate := range layers {
		if entry, ok := candidate.(map[string]any); ok && entry["id"] == key {
			layers[index] = layer
			composition["layers"] = layers
			return nil
		}
	}
	if len(layers) >= 24 {
		return Error{Code: "STUDIO_ASSET_INVALID", Message: "A theme can contain at most 24 composition layers"}
	}
	composition["layers"] = append(layers, layer)
	return nil
}

func filterAssetKey(entries []any, key string) []any {
	result := make([]any, 0, len(entries))
	for _, entry := range entries {
		if value, ok := entry.(map[string]any); ok && value["assetKey"] == key {
			continue
		}
		result = append(result, entry)
	}
	return result
}

func filterCompositionKey(entries []any, key string) []any {
	result := make([]any, 0, len(entries))
	for _, entry := range entries {
		value, ok := entry.(map[string]any)
		if !ok {
			result = append(result, entry)
			continue
		}
		asset, _ := value["asset"].(map[string]any)
		if asset["assetKey"] == key || value["id"] == key {
			continue
		}
		result = append(result, entry)
	}
	return result
}

func validSlot(slot string) bool {
	switch slot {
	case "background", "portrait", "decoration", "ui-font", "code-font", "display-font", "composition-layer", "profile-avatar", "suggestion-card1", "suggestion-card2", "suggestion-card3", "suggestion-card4", "project-icon1", "project-icon2", "project-icon3", "project-icon4":
		return true
	default:
		return false
	}
}

func isFontSlot(slot string) bool {
	return slot == "ui-font" || slot == "code-font" || slot == "display-font"
}

func requiredAssetKey(slot, value string) (string, error) {
	if value == "" {
		switch slot {
		case "ui-font", "code-font", "display-font":
			value = slot
		default:
			return "", Error{Code: "STUDIO_ASSET_INVALID", Message: "Asset key is required"}
		}
	}
	if len(value) > 40 || !assetKeyPattern.MatchString(value) {
		return "", Error{Code: "STUDIO_ASSET_INVALID", Message: "Asset key is invalid"}
	}
	return value, nil
}

func validImageType(fileName, mimeType string) bool {
	extension := strings.ToLower(filepath.Ext(fileName))
	switch extension {
	case ".png":
		return mimeType == "image/png"
	case ".jpg", ".jpeg":
		return mimeType == "image/jpeg"
	case ".webp":
		return mimeType == "image/webp"
	default:
		return false
	}
}

func validWOFF2(contents []byte) bool {
	if len(contents) < 48 || string(contents[:4]) != "wOF2" || int(binary.BigEndian.Uint32(contents[8:12])) != len(contents) || binary.BigEndian.Uint16(contents[12:14]) == 0 || binary.BigEndian.Uint32(contents[16:20]) == 0 {
		return false
	}
	return true
}

func digest(contents []byte) string {
	sum := sha256.Sum256(contents)
	return hex.EncodeToString(sum[:])[:12]
}

func stringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func (workspace *Workspace) view(record record) (Draft, error) {
	paths, err := themerepo.AssetPaths(record.Theme)
	if err != nil {
		return Draft{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: err.Error()}
	}
	urls := make(map[string]string, len(paths))
	for _, path := range paths {
		urls[path] = "/api/draft-asset?draftId=" + record.DraftID + "&path=" + path
	}
	return Draft{
		DraftID: record.DraftID, Theme: cloneJSON(record.Theme), Revision: record.Revision,
		UpdatedAt: record.UpdatedAt, SavedRef: cloneRef(record.SavedRef), Dirty: record.Dirty,
		UndoAvailable: len(record.Past) > 0, RedoAvailable: len(record.Future) > 0,
		Issues: validationIssues(record.Theme), AssetURLs: urls,
	}, nil
}

func validationIssues(theme json.RawMessage) []Issue {
	// A draft may be edited while incomplete, but the inspector must still
	// surface anything that would block its explicit immutable save.
	if err := themerepo.ValidateDocument(theme); err != nil {
		return []Issue{{Code: themerepo.ErrorCodeFrom(err), Path: "theme", Message: err.Error(), Severity: "error"}}
	}
	return []Issue{}
}

func (workspace *Workspace) writeBundleAssets(draftID string, bundle themerepo.Bundle, document []byte) error {
	paths, err := themerepo.AssetPaths(document)
	if err != nil {
		return err
	}
	for _, path := range paths {
		contents, exists := bundle.Files[path]
		if !exists {
			return Error{Code: "STUDIO_DRAFT_INVALID", Message: "Theme source asset is missing"}
		}
		if err := workspace.writeAsset(draftID, path, contents); err != nil {
			return err
		}
	}
	return nil
}

func (workspace *Workspace) readAssets(draftID string, paths []string) (map[string][]byte, error) {
	files := make(map[string][]byte, len(paths))
	for _, path := range paths {
		contents, err := os.ReadFile(workspace.assetPath(draftID, path))
		if err != nil {
			return nil, err
		}
		files[path] = contents
	}
	return files, nil
}

func (workspace *Workspace) writeAsset(draftID, path string, contents []byte) error {
	if !safeDraftID(draftID) {
		return Error{Code: "STUDIO_DRAFT_INVALID", Message: "Draft ID is invalid"}
	}
	target := workspace.assetPath(draftID, path)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	return atomicWrite(target, contents)
}

func (workspace *Workspace) assetPath(draftID, path string) string {
	return filepath.Join(workspace.draftDirectory(draftID), filepath.FromSlash(path))
}

func (workspace *Workspace) draftDirectory(draftID string) string {
	return filepath.Join(workspace.root, draftID)
}

func (workspace *Workspace) recordPath(draftID string) string {
	return filepath.Join(workspace.draftDirectory(draftID), "draft.json")
}

func (workspace *Workspace) writeRecord(record record) error {
	if err := validateRecord(record); err != nil {
		return err
	}
	contents, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	contents = append(contents, '\n')
	if err := os.MkdirAll(workspace.draftDirectory(record.DraftID), 0o700); err != nil {
		return err
	}
	return atomicWrite(workspace.recordPath(record.DraftID), contents)
}

func (workspace *Workspace) readRecord(draftID string) (record, error) {
	if !safeDraftID(draftID) {
		return record{}, Error{Code: "STUDIO_DRAFT_NOT_FOUND", Message: "Theme draft does not exist"}
	}
	contents, err := os.ReadFile(workspace.recordPath(draftID))
	if errors.Is(err, os.ErrNotExist) {
		return record{}, Error{Code: "STUDIO_DRAFT_NOT_FOUND", Message: "Theme draft does not exist"}
	}
	if err != nil {
		return record{}, err
	}
	var value record
	if err := strictJSON(contents, &value); err != nil || validateRecord(value) != nil {
		workspace.preserveInvalidEvidence(draftID, contents)
		if err != nil {
			return record{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: "Theme draft is invalid"}
		}
		return record{}, Error{Code: "STUDIO_DRAFT_INVALID", Message: "Theme draft is invalid"}
	}
	return value, nil
}

func (workspace *Workspace) preserveInvalidEvidence(draftID string, contents []byte) {
	directory := filepath.Join(workspace.root, "invalid-evidence")
	_ = os.MkdirAll(directory, 0o700)
	_ = atomicWrite(filepath.Join(directory, draftID+"-"+fmt.Sprint(time.Now().UTC().UnixNano())+".json"), contents)
}

func (workspace *Workspace) listRecords() ([]record, error) {
	entries, err := os.ReadDir(workspace.root)
	if errors.Is(err, os.ErrNotExist) {
		return []record{}, nil
	}
	if err != nil {
		return nil, err
	}
	records := make([]record, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !safeDraftID(entry.Name()) {
			continue
		}
		value, err := workspace.readRecord(entry.Name())
		if err != nil {
			if ErrorCode(err) == "STUDIO_DRAFT_INVALID" {
				// Preserve invalid records as evidence, but do not let a single
				// future-format/corrupt draft prevent access to every valid draft.
				continue
			}
			return nil, err
		}
		records = append(records, value)
	}
	return records, nil
}

func (workspace *Workspace) findByGroup(group string) (*record, error) {
	records, err := workspace.listRecords()
	if err != nil {
		return nil, err
	}
	var latest *record
	for index := range records {
		_, ref, err := themerepo.NormalizeDraftDocument(records[index].Theme)
		if err != nil || workspace.groupKey(ref.ID) != group {
			continue
		}
		if latest == nil || records[index].UpdatedAt > latest.UpdatedAt || records[index].UpdatedAt == latest.UpdatedAt && records[index].DraftID > latest.DraftID {
			value := records[index]
			latest = &value
		}
	}
	return latest, nil
}

func (workspace *Workspace) removeDuplicateDrafts() error {
	records, err := workspace.listRecords()
	if err != nil {
		return err
	}
	sort.Slice(records, func(left, right int) bool {
		return records[left].UpdatedAt > records[right].UpdatedAt || records[left].UpdatedAt == records[right].UpdatedAt && records[left].DraftID > records[right].DraftID
	})
	seen := map[string]bool{}
	for _, record := range records {
		_, ref, err := themerepo.NormalizeDraftDocument(record.Theme)
		if err != nil {
			return err
		}
		group := workspace.groupKey(ref.ID)
		if !seen[group] {
			seen[group] = true
			continue
		}
		// Removing a duplicate directory is safe: it was identified from a
		// fully valid record and a newer record for the same identity exists.
		if err := os.RemoveAll(workspace.draftDirectory(record.DraftID)); err != nil {
			return err
		}
	}
	return nil
}

func (workspace *Workspace) nextVersion(id string) (string, error) {
	library, err := workspace.repository.List()
	if err != nil {
		return "", err
	}
	major, minor, patch := 1, 0, -1
	for _, item := range library.Themes {
		if item.Source != "personal" || item.Ref.ID != id {
			continue
		}
		var candidateMajor, candidateMinor, candidatePatch int
		if _, err := fmt.Sscanf(item.Ref.Version, "%d.%d.%d", &candidateMajor, &candidateMinor, &candidatePatch); err != nil {
			return "", Error{Code: "STUDIO_SAVE_FAILED", Message: "Stored theme version is invalid"}
		}
		if candidateMajor > major || candidateMajor == major && candidateMinor > minor || candidateMajor == major && candidateMinor == minor && candidatePatch > patch {
			major, minor, patch = candidateMajor, candidateMinor, candidatePatch
		}
	}
	if patch < 0 {
		return "1.0.0", nil
	}
	return fmt.Sprintf("%d.%d.%d", major, minor, patch+1), nil
}

func (workspace *Workspace) groupKey(id string) string {
	for _, builtin := range workspace.builtinIDs {
		stable := builtin + "-custom"
		if id == stable || strings.HasPrefix(id, stable+"-") {
			return "builtin:" + builtin
		}
	}
	return "personal:" + id
}

func (workspace *Workspace) isReservedID(id string) bool {
	for _, builtin := range workspace.builtinIDs {
		if id == builtin {
			return true
		}
	}
	return false
}

func mutateHistory(current record, theme json.RawMessage) record {
	next := current
	next.Theme = cloneJSON(theme)
	next.Revision++
	next.UpdatedAt = now()
	next.Dirty = true
	next.Past = append(append([]json.RawMessage(nil), current.Past...), cloneJSON(current.Theme))
	if len(next.Past) > historyLimit {
		next.Past = next.Past[len(next.Past)-historyLimit:]
	}
	next.Future = []json.RawMessage{}
	return next
}

func assertRevision(record record, expected int) error {
	if record.Revision != expected {
		return Error{Code: "STUDIO_DRAFT_CONFLICT", Message: fmt.Sprintf("Draft revision changed from %d to %d", expected, record.Revision)}
	}
	return nil
}

func validateRecord(record record) error {
	if record.SchemaVersion != 1 || !safeDraftID(record.DraftID) || record.Revision < 0 || record.UpdatedAt == "" || len(record.Past) > historyLimit || len(record.Future) > historyLimit {
		return errors.New("draft record envelope is invalid")
	}
	if _, _, err := themerepo.NormalizeDraftDocument(record.Theme); err != nil {
		return err
	}
	for _, snapshot := range append(append([]json.RawMessage{}, record.Past...), record.Future...) {
		if _, _, err := themerepo.NormalizeDraftDocument(snapshot); err != nil {
			return err
		}
	}
	return nil
}

func strictJSON(contents []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("JSON has trailing content")
	}
	return nil
}

func atomicWrite(path string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".openchatgptskin-*")
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

func newUUID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	encoded := hex.EncodeToString(value)
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}

func safeDraftID(value string) bool                   { return uuidPattern.MatchString(value) }
func cloneJSON(value json.RawMessage) json.RawMessage { return append(json.RawMessage(nil), value...) }
func cloneRef(value *themerepo.Ref) *themerepo.Ref {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
