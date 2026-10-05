package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"konspecter/server/internal/notes"
)

const noteColumns = `id, content, revision, created_at, updated_at, deleted_at`

func scanNote(row pgx.Row) (notes.Note, error) {
	var n notes.Note
	err := row.Scan(&n.ID, &n.Content, &n.Revision, &n.CreatedAt, &n.UpdatedAt, &n.DeletedAt)
	return n, err
}

// ListNotes returns the user's notes that are not deleted, newest first.
func (db *DB) ListNotes(ctx context.Context, userID string) ([]notes.Note, error) {
	rows, err := db.pool.Query(ctx, `SELECT `+noteColumns+` FROM notes
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY updated_at DESC, id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (notes.Note, error) {
		return scanNote(row)
	})
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	return list, nil
}

// GetNote returns a note that is not deleted.
func (db *DB) GetNote(ctx context.Context, userID, id string) (notes.Note, error) {
	n, err := db.currentNote(ctx, db.pool, userID, id)
	if err != nil {
		return notes.Note{}, err
	}
	if n.Deleted() {
		return notes.Note{}, notes.ErrNotFound
	}
	return n, nil
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// currentNote returns the note in any state, including deleted.
func (db *DB) currentNote(ctx context.Context, q querier, userID, id string) (notes.Note, error) {
	n, err := scanNote(q.QueryRow(ctx,
		`SELECT `+noteColumns+` FROM notes WHERE user_id = $1 AND id = $2`, userID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return notes.Note{}, notes.ErrNotFound
	}
	if err != nil {
		return notes.Note{}, fmt.Errorf("get note: %w", err)
	}
	return n, nil
}

// CreateNote stores a new note at revision 1, encrypted with the key keyID.
// If the id is taken, by a live or a deleted note, it returns a
// *notes.ConflictError with that note; if keyID is not the account's
// current key, notes.ErrEncryptionRequired or notes.ErrKeyMismatch.
func (db *DB) CreateNote(ctx context.Context, userID, id, content, keyID string) (notes.Note, error) {
	var result notes.Note
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		seq, err := nextChange(ctx, tx, userID)
		if err != nil {
			return err
		}
		if err := checkKey(ctx, tx, userID, keyID); err != nil {
			return err
		}
		n, err := scanNote(tx.QueryRow(ctx, `
			INSERT INTO notes (user_id, id, content, key_id, revision, change_seq) VALUES ($1, $2, $3, $5, 1, $4)
			ON CONFLICT DO NOTHING
			RETURNING `+noteColumns, userID, id, content, seq, keyID))
		if errors.Is(err, pgx.ErrNoRows) {
			current, err := db.currentNote(ctx, tx, userID, id)
			if err != nil {
				return err
			}
			return &notes.ConflictError{Current: current}
		}
		if err != nil {
			return fmt.Errorf("create note: %w", err)
		}
		result = n
		return recordChange(ctx, tx, userID, seq, n, "create")
	})
	return result, err
}

// nextChange takes the user's next change sequence number. The row lock it
// takes is held until the transaction ends, so the user's changes commit in
// sequence order.
func nextChange(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var seq int64
	err := tx.QueryRow(ctx,
		`UPDATE users SET change_seq = change_seq + 1 WHERE id = $1 RETURNING change_seq`, userID,
	).Scan(&seq)
	if err != nil {
		return 0, fmt.Errorf("next change: %w", err)
	}
	return seq, nil
}

// checkKey makes sure keyID is the user's current content key. Called after
// nextChange, under the user's row lock, so a key reset (which takes the
// same lock) cannot slip in between the check and the write.
func checkKey(ctx context.Context, tx pgx.Tx, userID, keyID string) error {
	var current string
	err := tx.QueryRow(ctx, `SELECT key_id FROM encryption_keys WHERE user_id = $1`, userID).Scan(&current)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return notes.ErrEncryptionRequired
	case err != nil:
		return fmt.Errorf("find key: %w", err)
	case current != keyID:
		return notes.ErrKeyMismatch
	}
	return nil
}

func recordChange(ctx context.Context, tx pgx.Tx, userID string, seq int64, n notes.Note, operation string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sync_changes (user_id, seq, note_id, revision, operation)
		VALUES ($1, $2, $3, $4, $5)`, userID, seq, n.ID, n.Revision, operation)
	if err != nil {
		return fmt.Errorf("record change: %w", err)
	}
	return nil
}

// UpdateNote replaces the content if the note is still at baseRevision. A
// deleted note at baseRevision is restored: edits beat deletions. Otherwise it
// returns a *notes.ConflictError with the current version. keyID is checked
// as for CreateNote.
func (db *DB) UpdateNote(ctx context.Context, userID, id, content, keyID string, baseRevision int64) (notes.Note, error) {
	return db.change(ctx, userID, id, baseRevision, "update", keyID, `
		UPDATE notes SET content = $5, key_id = $6, revision = revision + 1, updated_at = now(), deleted_at = NULL, change_seq = $4
		WHERE user_id = $1 AND id = $2 AND revision = $3
		RETURNING `+noteColumns, content, keyID)
}

// DeleteNote marks the note deleted if it is still at baseRevision. The
// content is kept.
func (db *DB) DeleteNote(ctx context.Context, userID, id string, baseRevision int64) (notes.Note, error) {
	return db.change(ctx, userID, id, baseRevision, "delete", "", `
		UPDATE notes SET revision = revision + 1, updated_at = now(), deleted_at = now(), change_seq = $4
		WHERE user_id = $1 AND id = $2 AND revision = $3 AND deleted_at IS NULL
		RETURNING `+noteColumns)
}

// change runs a conditional UPDATE. When no row matches, it reports why: the
// note does not exist, or it changed (or, for a deletion, was already
// deleted) since baseRevision. A keyID, when given, must be the current key.
func (db *DB) change(ctx context.Context, userID, id string, baseRevision int64, operation, keyID, sql string, extra ...any) (notes.Note, error) {
	var result notes.Note
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		seq, err := nextChange(ctx, tx, userID)
		if err != nil {
			return err
		}
		if keyID != "" {
			if err := checkKey(ctx, tx, userID, keyID); err != nil {
				return err
			}
		}
		args := append([]any{userID, id, baseRevision, seq}, extra...)
		n, err := scanNote(tx.QueryRow(ctx, sql, args...))
		if err == nil {
			result = n
			return recordChange(ctx, tx, userID, seq, n, operation)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("change note: %w", err)
		}
		current, err := db.currentNote(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		return &notes.ConflictError{Current: current}
	})
	return result, err
}

// Changes returns up to limit notes changed after cursor, in change order,
// each in its current state (deleted notes included, so clients can remove
// them). The returned cursor is the position to continue from.
func (db *DB) Changes(ctx context.Context, userID string, cursor int64, limit int) ([]notes.Note, int64, error) {
	rows, err := db.pool.Query(ctx, `SELECT `+noteColumns+`, change_seq FROM notes
		WHERE user_id = $1 AND change_seq > $2
		ORDER BY change_seq LIMIT $3`, userID, cursor, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("list changes: %w", err)
	}
	defer rows.Close()
	var changed []notes.Note
	next := cursor
	for rows.Next() {
		var n notes.Note
		if err := rows.Scan(&n.ID, &n.Content, &n.Revision, &n.CreatedAt, &n.UpdatedAt, &n.DeletedAt, &next); err != nil {
			return nil, 0, fmt.Errorf("list changes: %w", err)
		}
		changed = append(changed, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list changes: %w", err)
	}
	return changed, next, nil
}
