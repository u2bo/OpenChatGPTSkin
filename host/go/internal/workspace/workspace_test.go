package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/u2bo/OpenChatGPTSkin/host/go/internal/themerepo"
)

func writeBuiltin(t *testing.T, root string) {
	t.Helper()
	directory := filepath.Join(root, "builtin", "mountain-mist")
	if err := os.MkdirAll(filepath.Join(directory, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	catalog := `{"schemaVersion":1,"builtins":[{"id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","kind":"theme","path":"builtin/mountain-mist","ready":true,"localOnly":false,"licenseId":"LicenseRef-Test","preview":"builtin/mountain-mist/preview.webp"}],"recipes":[]}`
	theme := `{"schemaVersion":4,"kind":"theme","appearance":"light","id":"mountain-mist","name":"Mountain Mist","version":"1.3.0","author":"OpenChatGPTSkin","assets":{"background":"assets/background.webp"},"colors":{"accent":"#113355","secondary":"#224466","text":"#ffffff","muted":"#cccccc","panel":"#112233","border":"#223344","success":"#228855","warning":"#cc8822","danger":"#bb3344","info":"#4477cc","textSecondary":"#eeeeee","link":"#aaccee","inputText":"#ffffff","placeholder":"#cccccc","codeText":"#ffffff"},"typography":{"uiFamily":"Sans","codeFamily":"Mono","scale":1,"uiSize":14,"codeSize":13,"uiWeight":400,"codeWeight":400,"lineHeight":1.5,"displayFamily":"Sans","displaySize":28,"displayWeight":400,"displayLineHeight":1.5,"displayLetterSpacing":0},"background":{"positionX":0.5,"positionY":0.5,"scale":1,"blur":0,"brightness":1,"overlay":0},"decorations":[],"layout":{},"rights":{"licenseId":"LicenseRef-Test","attribution":"OpenChatGPTSkin","localOnly":false}}`
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "theme.json"), []byte(theme), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "assets", "background.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "preview.webp"), []byte("RIFF0000WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newWorkspace(t *testing.T) (*Workspace, *themerepo.Repository, string) {
	t.Helper()
	builtinRoot := t.TempDir()
	writeBuiltin(t, builtinRoot)
	personalRoot := t.TempDir()
	repository, err := themerepo.OpenWithPersonal(builtinRoot, personalRoot)
	if err != nil {
		t.Fatal(err)
	}
	draftRoot := filepath.Join(t.TempDir(), "theme-studio-drafts")
	workspace, err := New(repository, draftRoot)
	if err != nil {
		t.Fatal(err)
	}
	return workspace, repository, draftRoot
}

func renamedTheme(t *testing.T, theme json.RawMessage, name string) json.RawMessage {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(theme, &value); err != nil {
		t.Fatal(err)
	}
	value["name"] = name
	result, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestWorkspaceCreatesOneDraftTracksRevisionAndPersistsHistory(t *testing.T) {
	workspace, _, draftRoot := newWorkspace(t)
	created, err := workspace.Create(CreateInput{Source: "builtin", Ref: themerepo.Ref{ID: "mountain-mist", Version: "1.3.0"}})
	if err != nil {
		t.Fatal(err)
	}
	if created.Theme == nil || created.Revision != 0 || !created.Dirty {
		t.Fatalf("created draft = %+v", created)
	}
	if _, err := workspace.Create(CreateInput{Source: "builtin", Ref: themerepo.Ref{ID: "mountain-mist", Version: "1.3.0"}}); ErrorCode(err) != "STUDIO_DRAFT_CONFLICT" {
		t.Fatalf("duplicate draft error = %v", err)
	}
	loaded, err := workspace.Create(CreateInput{Source: "builtin", Ref: themerepo.Ref{ID: "mountain-mist", Version: "1.3.0"}, ConflictResolution: "load-existing"})
	if err != nil || loaded.DraftID != created.DraftID {
		t.Fatalf("loaded draft=%+v error=%v", loaded, err)
	}
	updated, err := workspace.Update(created.DraftID, created.Revision, renamedTheme(t, created.Theme, "Renamed"))
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 1 || !updated.UndoAvailable || updated.RedoAvailable {
		t.Fatalf("updated draft = %+v", updated)
	}
	if _, err := workspace.Update(created.DraftID, created.Revision, created.Theme); ErrorCode(err) != "STUDIO_DRAFT_CONFLICT" {
		t.Fatalf("stale update error = %v", err)
	}
	undone, err := workspace.Undo(created.DraftID, updated.Revision)
	if err != nil || undone.Revision != 2 || undone.UndoAvailable || !undone.RedoAvailable {
		t.Fatalf("undone=%+v error=%v", undone, err)
	}
	redone, err := workspace.Redo(created.DraftID, undone.Revision)
	if err != nil || redone.Revision != 3 || !redone.UndoAvailable || redone.RedoAvailable {
		t.Fatalf("redone=%+v error=%v", redone, err)
	}
	// A new instance reads the Node-compatible draft.json shape unchanged.
	reopened, err := New(workspace.repository, draftRoot)
	if err != nil {
		t.Fatal(err)
	}
	latest, err := reopened.Latest()
	if err != nil || latest == nil || latest.DraftID != created.DraftID || latest.Revision != redone.Revision {
		t.Fatalf("latest=%+v error=%v", latest, err)
	}
}

func TestWorkspaceSaveCreatesImmutablePersonalVersionAndExports(t *testing.T) {
	workspace, repository, _ := newWorkspace(t)
	draft, err := workspace.Create(CreateInput{Source: "builtin", Ref: themerepo.Ref{ID: "mountain-mist", Version: "1.3.0"}})
	if err != nil {
		t.Fatal(err)
	}
	saved, ref, err := workspace.Save(draft.DraftID, draft.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if ref != (themerepo.Ref{ID: "mountain-mist-custom", Version: "1.0.0"}) || saved.SavedRef == nil || saved.Dirty {
		t.Fatalf("saved draft=%+v ref=%+v", saved, ref)
	}
	archive, err := workspace.Export(ref)
	if err != nil || len(archive) == 0 {
		t.Fatalf("export bytes=%d error=%v", len(archive), err)
	}
	if _, err := repository.Read("personal", ref); err != nil {
		t.Fatal(err)
	}
	idempotent, sameRef, err := workspace.Save(saved.DraftID, saved.Revision)
	if err != nil || sameRef != ref || idempotent.Revision != saved.Revision {
		t.Fatalf("idempotent save draft=%+v ref=%+v error=%v", idempotent, sameRef, err)
	}
}

func TestWorkspaceRejectsMalformedDraftAndPreservesEvidence(t *testing.T) {
	workspace, _, root := newWorkspace(t)
	draftID := "00000000-0000-4000-8000-000000000001"
	directory := filepath.Join(root, draftID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "draft.json"), []byte(`{"schemaVersion":99}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.Open(draftID); ErrorCode(err) != "STUDIO_DRAFT_INVALID" {
		t.Fatalf("malformed draft error = %v", err)
	}
	evidence, err := os.ReadDir(filepath.Join(root, "invalid-evidence"))
	if err != nil || len(evidence) != 1 {
		t.Fatalf("invalid evidence = %v error=%v", evidence, err)
	}
}
