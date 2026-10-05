package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/notes"
)

// openTestDB connects to KONSPECTER_TEST_DATABASE_URL and gives the test its
// own freshly migrated schema, dropped afterwards. Without the variable the
// test is skipped.
func openTestDB(t *testing.T) *DB {
	t.Helper()
	url := os.Getenv("KONSPECTER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("KONSPECTER_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()

	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	schema := "test_" + hex.EncodeToString(suffix)

	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		_ = admin.Close(context.Background())
	})

	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := OpenConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func createUser(t *testing.T, db *DB, email string) auth.User {
	t.Helper()
	user, err := db.CreateUser(context.Background(), email)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func TestMigrateIsIdempotent(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	names, err := db.migrationNames(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"001_initial.sql", "002_sync.sql", "003_accounts.sql", "004_identities.sql"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Errorf("applied migrations = %v, want %v", names, want)
	}
}

func TestMigrateConcurrently(t *testing.T) {
	db := openTestDB(t)
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Go(func() { errs <- db.Migrate(context.Background()) })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent Migrate: %v", err)
		}
	}
}

func TestUsersAndTokens(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	user := createUser(t, db, "Ada@Example.com")
	if user.Email != "ada@example.com" || user.ID == "" {
		t.Errorf("created user = %+v", user)
	}
	if _, err := db.CreateUser(ctx, "ada@example.com"); !errors.Is(err, ErrUserExists) {
		t.Errorf("duplicate user error = %v", err)
	}
	if found, err := db.UserByEmail(ctx, "ADA@example.com"); err != nil || found != user {
		t.Errorf("UserByEmail = %+v, %v", found, err)
	}
	if _, err := db.UserByEmail(ctx, "nobody@example.com"); !errors.Is(err, ErrUserNotFound) {
		t.Errorf("missing user error = %v", err)
	}

	token, err := db.CreateToken(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := db.UserByToken(ctx, token); err != nil || got != user {
		t.Errorf("UserByToken = %+v, %v", got, err)
	}
	if _, err := db.UserByToken(ctx, "ksp_unknown"); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("unknown token error = %v", err)
	}
	var stored int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM api_tokens WHERE token_hash = $1`, []byte(token)).Scan(&stored); err != nil || stored != 0 {
		t.Errorf("plaintext token stored (count %d, %v)", stored, err)
	}
}

func TestNoteLifecycle(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")

	created, err := db.CreateNote(ctx, user.ID, "n1", "# One")
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 || created.Markdown != "# One" || created.Deleted() {
		t.Errorf("created = %+v", created)
	}
	var conflict *notes.ConflictError
	if _, err := db.CreateNote(ctx, user.ID, "n1", "again"); !errors.As(err, &conflict) || conflict.Current.Markdown != "# One" || conflict.Current.Revision != 1 {
		t.Errorf("duplicate create error = %v, want ConflictError with the current note", err)
	}

	updated, err := db.UpdateNote(ctx, user.ID, "n1", "# One, edited", 1)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.Markdown != "# One, edited" || !updated.UpdatedAt.After(created.UpdatedAt) && !updated.UpdatedAt.Equal(created.UpdatedAt) {
		t.Errorf("updated = %+v", updated)
	}

	got, err := db.GetNote(ctx, user.ID, "n1")
	if err != nil || got.Revision != 2 {
		t.Errorf("GetNote = %+v, %v", got, err)
	}
	list, err := db.ListNotes(ctx, user.ID)
	if err != nil || len(list) != 1 || list[0].ID != "n1" {
		t.Errorf("ListNotes = %+v, %v", list, err)
	}

	deleted, err := db.DeleteNote(ctx, user.ID, "n1", 2)
	if err != nil {
		t.Fatal(err)
	}
	if !deleted.Deleted() || deleted.Revision != 3 || deleted.Markdown != "# One, edited" {
		t.Errorf("deleted = %+v (the Markdown must be kept)", deleted)
	}
	if _, err := db.GetNote(ctx, user.ID, "n1"); !errors.Is(err, notes.ErrNotFound) {
		t.Errorf("GetNote after delete error = %v", err)
	}
	if list, _ := db.ListNotes(ctx, user.ID); len(list) != 0 {
		t.Errorf("deleted note listed: %+v", list)
	}
}

func TestStaleRevisionsConflict(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	if _, err := db.CreateNote(ctx, user.ID, "n1", "v1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.UpdateNote(ctx, user.ID, "n1", "v2 from device A", 1); err != nil {
		t.Fatal(err)
	}

	_, err := db.UpdateNote(ctx, user.ID, "n1", "v2 from device B", 1)
	var conflict *notes.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("stale update error = %v, want ConflictError", err)
	}
	if conflict.Current.Revision != 2 || conflict.Current.Markdown != "v2 from device A" {
		t.Errorf("conflict current = %+v", conflict.Current)
	}
	if _, err := db.DeleteNote(ctx, user.ID, "n1", 1); !errors.As(err, &conflict) {
		t.Errorf("stale delete error = %v", err)
	}

	if _, err := db.DeleteNote(ctx, user.ID, "n1", 2); err != nil {
		t.Fatal(err)
	}
	_, err = db.UpdateNote(ctx, user.ID, "n1", "stale edit after delete", 2)
	if !errors.As(err, &conflict) || !conflict.Current.Deleted() || conflict.Current.Revision != 3 {
		t.Errorf("stale update of deleted note error = %v, want conflict with deleted current", err)
	}
	if _, err := db.DeleteNote(ctx, user.ID, "n1", 3); !errors.As(err, &conflict) || !conflict.Current.Deleted() {
		t.Errorf("delete of deleted note error = %v, want conflict", err)
	}
	if _, err := db.UpdateNote(ctx, user.ID, "missing", "x", 1); !errors.Is(err, notes.ErrNotFound) {
		t.Errorf("update of missing note error = %v", err)
	}
}

func TestDeletedNotes(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	if _, err := db.CreateNote(ctx, user.ID, "n1", "v1"); err != nil {
		t.Fatal(err)
	}
	deleted, err := db.DeleteNote(ctx, user.ID, "n1", 1)
	if err != nil {
		t.Fatal(err)
	}

	// Creating over a tombstone conflicts, with the tombstone as current.
	_, err = db.CreateNote(ctx, user.ID, "n1", "again")
	var conflict *notes.ConflictError
	if !errors.As(err, &conflict) || !conflict.Current.Deleted() || conflict.Current.Revision != 2 || conflict.Current.Markdown != "v1" {
		t.Fatalf("create over tombstone error = %v, want ConflictError with the tombstone", err)
	}

	// An edit at the tombstone's revision restores the note (edits beat deletions).
	restored, err := db.UpdateNote(ctx, user.ID, "n1", "v2, restored", 2)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Deleted() || restored.Revision != 3 || restored.Markdown != "v2, restored" || restored.UpdatedAt.Before(deleted.UpdatedAt) {
		t.Errorf("restored = %+v", restored)
	}
	if got, err := db.GetNote(ctx, user.ID, "n1"); err != nil || got.Markdown != "v2, restored" {
		t.Errorf("GetNote after restore = %+v, %v", got, err)
	}
	if list, _ := db.ListNotes(ctx, user.ID); len(list) != 1 {
		t.Errorf("restored note not listed: %+v", list)
	}

	// The failed create took no sequence number; each change is in the log.
	changed, cursor, err := db.Changes(ctx, user.ID, 2, 10)
	if err != nil || len(changed) != 1 || changed[0].Deleted() || cursor != 3 {
		t.Errorf("Changes after restore = %+v, %d, %v", changed, cursor, err)
	}
	rows, err := db.pool.Query(ctx, `SELECT operation FROM sync_changes WHERE user_id = $1 ORDER BY seq`, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	operations, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || strings.Join(operations, ",") != "create,delete,update" {
		t.Errorf("sync_changes = %v, %v", operations, err)
	}
}

func TestConcurrentUpdatesOnlyOneWins(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	if _, err := db.CreateNote(ctx, user.ID, "n1", "v1"); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := range 8 {
		wg.Go(func() {
			_, err := db.UpdateNote(ctx, user.ID, "n1", "writer "+string(rune('a'+i)), 1)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		var conflict *notes.ConflictError
		switch {
		case err == nil:
			wins++
		case errors.As(err, &conflict):
			conflicts++
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if wins != 1 || conflicts != 7 {
		t.Errorf("wins = %d, conflicts = %d; want 1 and 7", wins, conflicts)
	}
}

func TestUsersCannotSeeEachOthersNotes(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	ada := createUser(t, db, "ada@example.com")
	bob := createUser(t, db, "bob@example.com")
	if _, err := db.CreateNote(ctx, ada.ID, "shared-id", "Ada's"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.GetNote(ctx, bob.ID, "shared-id"); !errors.Is(err, notes.ErrNotFound) {
		t.Errorf("Bob read Ada's note: %v", err)
	}
	if _, err := db.CreateNote(ctx, bob.ID, "shared-id", "Bob's"); err != nil {
		t.Errorf("same id for another user: %v", err)
	}
	if _, err := db.UpdateNote(ctx, bob.ID, "shared-id", "overwrite", 1); err != nil {
		t.Fatal(err)
	}
	if got, _ := db.GetNote(ctx, ada.ID, "shared-id"); got.Markdown != "Ada's" {
		t.Errorf("Ada's note changed to %q", got.Markdown)
	}
}

func TestChangesAreIncrementalAndOrdered(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	other := createUser(t, db, "bob@example.com")

	if _, err := db.CreateNote(ctx, user.ID, "a", "A"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateNote(ctx, user.ID, "b", "B"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateNote(ctx, other.ID, "x", "not Ada's"); err != nil {
		t.Fatal(err)
	}

	all, cursor, err := db.Changes(ctx, user.ID, 0, 10)
	if err != nil || len(all) != 2 || all[0].ID != "a" || all[1].ID != "b" || cursor != 2 {
		t.Fatalf("Changes = %+v, %d, %v", all, cursor, err)
	}

	if _, err := db.UpdateNote(ctx, user.ID, "a", "A2", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := db.DeleteNote(ctx, user.ID, "b", 1); err != nil {
		t.Fatal(err)
	}
	// A failed (conflicting) change must not consume a sequence number.
	if _, err := db.UpdateNote(ctx, user.ID, "a", "stale", 1); err == nil {
		t.Fatal("stale update succeeded")
	}

	since, next, err := db.Changes(ctx, user.ID, cursor, 10)
	if err != nil || len(since) != 2 || next != 4 {
		t.Fatalf("Changes since %d = %+v, %d, %v", cursor, since, next, err)
	}
	if since[0].ID != "a" || since[0].Markdown != "A2" || since[1].ID != "b" || !since[1].Deleted() {
		t.Errorf("changes = %+v", since)
	}
	if empty, same, _ := db.Changes(ctx, user.ID, next, 10); len(empty) != 0 || same != next {
		t.Errorf("no new changes: %+v, %d", empty, same)
	}

	page, pageCursor, _ := db.Changes(ctx, user.ID, 0, 1)
	if len(page) != 1 || pageCursor != 3 {
		t.Errorf("limited page = %+v, cursor %d", page, pageCursor)
	}

	var logged int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM sync_changes WHERE user_id = $1`, user.ID).Scan(&logged); err != nil || logged != 4 {
		t.Errorf("sync_changes rows = %d, %v; want 4", logged, err)
	}
}

func TestRevokingTokens(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	first, _ := db.CreateToken(ctx, user.ID)
	second, _ := db.CreateToken(ctx, user.ID)

	if err := db.RevokeToken(ctx, first); err != nil {
		t.Fatal(err)
	}
	if _, err := db.UserByToken(ctx, first); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("revoked token still works: %v", err)
	}
	if _, err := db.UserByToken(ctx, second); err != nil {
		t.Errorf("other token revoked too: %v", err)
	}
	if count, err := db.RevokeUserTokens(ctx, user.ID); err != nil || count != 1 {
		t.Errorf("RevokeUserTokens = %d, %v", count, err)
	}
	if _, err := db.UserByToken(ctx, second); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("token survived RevokeUserTokens: %v", err)
	}
}
