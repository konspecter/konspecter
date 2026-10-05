package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"

	"konspecter/server/internal/keys"
	"konspecter/server/internal/notes"
)

func TestTheKeyIsSetUpOnceAndReWrappedOptimistically(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user, err := db.CreateUser(ctx, "ann@example.com") // No key yet.
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Key(ctx, user.ID); !errors.Is(err, keys.ErrNoKey) {
		t.Fatalf("Key without one = %v", err)
	}
	if id, err := db.CurrentKeyID(ctx, user.ID); err != nil || id != "" {
		t.Errorf("CurrentKeyID = %q, %v", id, err)
	}
	if _, err := db.CreateNote(ctx, user.ID, "n1", "ksp1.k1.x", "k1"); !errors.Is(err, notes.ErrEncryptionRequired) {
		t.Errorf("a note before the key = %v", err)
	}

	first, err := db.PutKey(ctx, user.ID, testKey("k1"), nil)
	if err != nil || first.ID != "k1" || first.Iterations != 600_000 || first.CreatedAt.IsZero() {
		t.Fatalf("set up = %+v, %v", first, err)
	}
	if got, err := db.Key(ctx, user.ID); err != nil || got != first {
		t.Errorf("Key = %+v, %v", got, err)
	}
	var conflict *keys.ConflictError
	if _, err := db.PutKey(ctx, user.ID, testKey("k2"), nil); !errors.As(err, &conflict) || conflict.Current.ID != "k1" {
		t.Errorf("a second key = %v", err)
	}

	rewrapped := testKey("k1")
	rewrapped.Iterations = 700_000
	second, err := db.PutKey(ctx, user.ID, rewrapped, &first.UpdatedAt)
	if err != nil || second.Iterations != 700_000 || !second.UpdatedAt.After(first.UpdatedAt) || !second.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("re-wrap = %+v, %v", second, err)
	}
	if _, err := db.PutKey(ctx, user.ID, rewrapped, &first.UpdatedAt); !errors.As(err, &conflict) {
		t.Errorf("a stale re-wrap = %v", err)
	}
	if _, err := db.PutKey(ctx, user.ID, testKey("k2"), &second.UpdatedAt); !errors.As(err, &conflict) {
		t.Errorf("a re-wrap to another key = %v", err)
	}

	if _, err := db.CreateNote(ctx, user.ID, "n1", "ksp1.k1.x", "k1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateNote(ctx, user.ID, "n2", "ksp1.k0.x", "k0"); !errors.Is(err, notes.ErrKeyMismatch) {
		t.Errorf("a note under another key = %v", err)
	}
	if _, err := db.UpdateNote(ctx, user.ID, "n1", "ksp1.k0.x", "k0", 1); !errors.Is(err, notes.ErrKeyMismatch) {
		t.Errorf("an update under another key = %v", err)
	}
	var stored string
	if err := db.pool.QueryRow(ctx, `SELECT key_id FROM notes WHERE id = 'n1'`).Scan(&stored); err != nil || stored != "k1" {
		t.Errorf("stored key id = %q, %v", stored, err)
	}
}

func TestResettingTheKeyDeletesTheNotes(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	ann := createUser(t, db, "ann@example.com")
	bob := createUser(t, db, "bob@example.com")
	for _, id := range []string{"a", "b"} {
		if _, err := db.CreateNote(ctx, ann.ID, id, "ksp1.k1.x", testKeyID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.CreateNote(ctx, bob.ID, "a", "ksp1.k1.x", testKeyID); err != nil {
		t.Fatal(err)
	}

	if err := db.DeleteKey(ctx, ann.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.DeleteKey(ctx, ann.ID); err != nil {
		t.Errorf("resetting twice = %v", err)
	}
	if _, err := db.Key(ctx, ann.ID); !errors.Is(err, keys.ErrNoKey) {
		t.Errorf("key after reset = %v", err)
	}
	if list, _ := db.ListNotes(ctx, ann.ID); len(list) != 0 {
		t.Errorf("notes after reset = %+v", list)
	}
	if changed, _, _ := db.Changes(ctx, ann.ID, 0, 10); len(changed) != 0 {
		t.Errorf("changes after reset = %+v", changed)
	}
	if list, _ := db.ListNotes(ctx, bob.ID); len(list) != 1 {
		t.Errorf("bob's notes = %+v", list)
	}
	// A new key starts over; the change sequence keeps counting up.
	if _, err := db.PutKey(ctx, ann.ID, testKey("k2"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateNote(ctx, ann.ID, "a", "ksp1.k2.x", "k2"); err != nil {
		t.Errorf("a note under the new key = %v", err)
	}
	if _, cursor, _ := db.Changes(ctx, ann.ID, 0, 10); cursor <= 2 {
		t.Errorf("cursor = %d, want past the old changes", cursor)
	}
}

// A note write racing a reset either lands before it (and is deleted) or
// fails after it: no note survives under a key that is gone.
func TestAResetAndNoteWritesDoNotInterleave(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Go(func() {
			_, _ = db.CreateNote(ctx, user.ID, string(rune('a'+i)), "ksp1.k1.x", testKeyID)
		})
	}
	wg.Go(func() { _ = db.DeleteKey(ctx, user.ID) })
	wg.Wait()
	var left int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM notes n
		WHERE n.user_id = $1 AND NOT EXISTS (SELECT 1 FROM encryption_keys k WHERE k.user_id = n.user_id AND k.key_id = n.key_id)`,
		user.ID).Scan(&left); err != nil || left != 0 {
		t.Errorf("notes under a missing key = %d, %v", left, err)
	}
}
