package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"konspecter/server/internal/keys"
)

const keyColumns = `key_id, kdf, (kdf_params->>'iterations')::int, salt, wrapped_key, recovery_wrapped_key, created_at, updated_at`

func scanKey(row pgx.Row) (keys.Key, error) {
	var k keys.Key
	err := row.Scan(&k.ID, &k.KDF, &k.Iterations, &k.Salt, &k.WrappedKey, &k.RecoveryWrappedKey, &k.CreatedAt, &k.UpdatedAt)
	return k, err
}

// Key returns the user's wrapped content key; keys.ErrNoKey if there is none.
func (db *DB) Key(ctx context.Context, userID string) (keys.Key, error) {
	k, err := scanKey(db.pool.QueryRow(ctx, `SELECT `+keyColumns+` FROM encryption_keys WHERE user_id = $1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return keys.Key{}, keys.ErrNoKey
	}
	if err != nil {
		return keys.Key{}, fmt.Errorf("find key: %w", err)
	}
	return k, nil
}

// CurrentKeyID returns the id of the user's content key, "" if there is none.
func (db *DB) CurrentKeyID(ctx context.Context, userID string) (string, error) {
	var id string
	err := db.pool.QueryRow(ctx, `SELECT key_id FROM encryption_keys WHERE user_id = $1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find key: %w", err)
	}
	return id, nil
}

// PutKey stores the user's wrapped content key, optimistically:
//
//   - with base nil it sets up the first key; if one exists, it returns a
//     *keys.ConflictError with it;
//   - otherwise it re-wraps the current key (a new passphrase): key.ID must
//     be the current key's and base its UpdatedAt, or it returns a
//     *keys.ConflictError; keys.ErrNoKey if there is no key to re-wrap.
//
// A different key id never replaces a key: notes are encrypted with it, so
// that takes a reset (DeleteKey) first.
func (db *DB) PutKey(ctx context.Context, userID string, key keys.Key, base *time.Time) (keys.Key, error) {
	var stored keys.Key
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, userID); err != nil {
			return err
		}
		current, err := scanKey(tx.QueryRow(ctx, `SELECT `+keyColumns+` FROM encryption_keys WHERE user_id = $1`, userID))
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("find key: %w", err)
		}
		switch {
		case base == nil && exists:
			return &keys.ConflictError{Current: current}
		case base == nil:
			stored, err = scanKey(tx.QueryRow(ctx, `
				INSERT INTO encryption_keys (user_id, key_id, kdf, kdf_params, salt, wrapped_key, recovery_wrapped_key)
				VALUES ($1, $2, $3, jsonb_build_object('iterations', $4::int), $5, $6, $7)
				RETURNING `+keyColumns,
				userID, key.ID, key.KDF, key.Iterations, key.Salt, key.WrappedKey, key.RecoveryWrappedKey))
			return err
		case !exists:
			return keys.ErrNoKey
		case current.ID != key.ID || !current.UpdatedAt.Equal(*base):
			return &keys.ConflictError{Current: current}
		}
		stored, err = scanKey(tx.QueryRow(ctx, `
			UPDATE encryption_keys SET kdf = $2, kdf_params = jsonb_build_object('iterations', $3::int),
				salt = $4, wrapped_key = $5, recovery_wrapped_key = $6, updated_at = now()
			WHERE user_id = $1
			RETURNING `+keyColumns,
			userID, key.KDF, key.Iterations, key.Salt, key.WrappedKey, key.RecoveryWrappedKey))
		return err
	})
	if err != nil {
		var conflict *keys.ConflictError
		if errors.As(err, &conflict) || errors.Is(err, keys.ErrNoKey) {
			return keys.Key{}, err
		}
		return keys.Key{}, fmt.Errorf("store key: %w", err)
	}
	return stored, nil
}

// DeleteKey resets encryption: it deletes the user's key and every note
// (encrypted with it, unreadable without it) with their change log.
// Deleting when there is no key is not an error.
func (db *DB) DeleteKey(ctx context.Context, userID string) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, userID); err != nil {
			return err
		}
		for _, table := range []string{"encryption_keys", "notes", "sync_changes"} {
			if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE user_id = $1`, userID); err != nil {
				return fmt.Errorf("reset encryption: %w", err)
			}
		}
		return nil
	})
}

// lockUser takes the user's row lock, which note writes take too
// (nextChange): key changes and note writes do not interleave.
func lockUser(ctx context.Context, tx pgx.Tx, userID string) error {
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return fmt.Errorf("lock user: %w", err)
	}
	return nil
}
