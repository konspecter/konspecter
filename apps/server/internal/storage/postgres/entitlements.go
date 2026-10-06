package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"konspecter/server/internal/entitlements"
)

// Entitlements: each account's latest word from the billing service, and
// what the server needs to email the account for it.

// Entitlement returns the user's entitlement, or entitlements.ErrNone.
func (db *DB) Entitlement(ctx context.Context, userID string) (entitlements.Entitlement, error) {
	if !validUUID(userID) {
		return entitlements.Entitlement{}, entitlements.ErrNone
	}
	e := entitlements.Entitlement{UserID: userID}
	err := db.pool.QueryRow(ctx, `SELECT status, until, version FROM entitlements WHERE user_id = $1`, userID).
		Scan(&e.Status, &e.Until, &e.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return entitlements.Entitlement{}, entitlements.ErrNone
	}
	if err != nil {
		return entitlements.Entitlement{}, fmt.Errorf("read entitlement: %w", err)
	}
	return e, nil
}

// PutEntitlement keeps an entitlement unless the user has a later version.
// It reports whether it did; ErrUserNotFound means there is no such user.
func (db *DB) PutEntitlement(ctx context.Context, e entitlements.Entitlement) (bool, error) {
	if !validUUID(e.UserID) {
		return false, ErrUserNotFound
	}
	tag, err := db.pool.Exec(ctx, `INSERT INTO entitlements AS e (user_id, status, until, version) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, until = excluded.until,
			version = excluded.version, updated_at = now()
		WHERE e.version < excluded.version`, e.UserID, e.Status, e.Until, e.Version)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" { // foreign_key_violation
		return false, ErrUserNotFound
	}
	if err != nil {
		return false, fmt.Errorf("put entitlement: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SetLocale keeps the language of the user's emails.
func (db *DB) SetLocale(ctx context.Context, userID, locale string) error {
	if _, err := db.pool.Exec(ctx, `UPDATE users SET locale = $2 WHERE id = $1 AND locale <> $2`, userID, locale); err != nil {
		return fmt.Errorf("set locale: %w", err)
	}
	return nil
}

// Recipient returns where, and in which language, to email the user.
func (db *DB) Recipient(ctx context.Context, userID string) (email, locale string, err error) {
	if !validUUID(userID) {
		return "", "", ErrUserNotFound
	}
	err = db.pool.QueryRow(ctx, `SELECT email, locale FROM users WHERE id = $1`, userID).Scan(&email, &locale)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrUserNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("read recipient: %w", err)
	}
	return email, locale, nil
}

// validUUID reports whether id can be compared with a uuid column (a bad
// one would be an error, not "not found").
func validUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i, r := range id {
		switch {
		case i == 8 || i == 13 || i == 18 || i == 23:
			if r != '-' {
				return false
			}
		case (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F'):
			return false
		}
	}
	return true
}
