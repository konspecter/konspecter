package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
)

// SignInWithIdentity returns the user an identity signs in to, following the
// rules of accounts.Identity: a linked identity signs in to its user; a new
// one is linked by a verified address to the account with that address, or
// creates the account (when createAllowed). Without a verified address a new
// identity gets accounts.ErrEmailRequired.
func (db *DB) SignInWithIdentity(ctx context.Context, identity accounts.Identity, createAllowed bool) (auth.User, error) {
	var user auth.User
	var outcome error
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			UPDATE user_identities i SET email = coalesce(nullif($3, ''), i.email)
			FROM users u
			WHERE i.provider = $1 AND i.subject = $2 AND u.id = i.user_id
			RETURNING u.id::text, u.email`, identity.Provider, identity.Subject, identity.Email,
		).Scan(&user.ID, &user.Email)
		if err == nil {
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("find identity: %w", err)
		}
		if !identity.EmailVerified || identity.Email == "" {
			outcome = accounts.ErrEmailRequired
			return nil
		}
		// The provider proved the address, so it counts as verified here too.
		err = tx.QueryRow(ctx, `
			UPDATE users SET email_verified_at = coalesce(email_verified_at, now())
			WHERE email = $1 RETURNING id::text, email`, identity.Email,
		).Scan(&user.ID, &user.Email)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if !createAllowed {
				outcome = accounts.ErrRegistrationClosed
				return nil
			}
			if err := tx.QueryRow(ctx, `
				INSERT INTO users (email, email_verified_at) VALUES ($1, now())
				RETURNING id::text, email`, identity.Email,
			).Scan(&user.ID, &user.Email); err != nil {
				return fmt.Errorf("create user: %w", err)
			}
		case err != nil:
			return fmt.Errorf("find user: %w", err)
		}
		return linkIdentity(ctx, tx, user.ID, identity)
	})
	if err != nil {
		return auth.User{}, fmt.Errorf("sign in with %s: %w", identity.Provider, err)
	}
	if outcome != nil {
		return auth.User{}, outcome
	}
	return user, nil
}

// linkIdentity links an identity to a user and drops it from the pending
// ones. An identity linked meanwhile (two tabs finishing at once) stays with
// the user it went to first.
func linkIdentity(ctx context.Context, tx pgx.Tx, userID string, identity accounts.Identity) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_identities (provider, subject, user_id, email)
		VALUES ($1, $2, $3, nullif($4, ''))
		ON CONFLICT (provider, subject) DO NOTHING`,
		identity.Provider, identity.Subject, userID, identity.Email,
	); err != nil {
		return fmt.Errorf("link identity: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM pending_identities WHERE provider = $1 AND subject = $2`, identity.Provider, identity.Subject,
	); err != nil {
		return fmt.Errorf("drop pending identity: %w", err)
	}
	return nil
}

// CreatePendingIdentity keeps an identity that needs an address until
// expiresAt, under the hash of the token its browser holds.
func (db *DB) CreatePendingIdentity(ctx context.Context, tokenHash []byte, identity accounts.Identity, expiresAt time.Time) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM pending_identities WHERE expires_at <= now()`); err != nil {
			return fmt.Errorf("prune pending identities: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO pending_identities (token_hash, provider, subject, email, expires_at)
			VALUES ($1, $2, $3, nullif($4, ''), $5)`,
			tokenHash, identity.Provider, identity.Subject, identity.Email, expiresAt,
		); err != nil {
			return fmt.Errorf("store pending identity: %w", err)
		}
		return nil
	})
}

// PendingIdentity returns a live pending identity; its Email is the
// provider's unverified suggestion. accounts.ErrIdentityExpired if there is none.
func (db *DB) PendingIdentity(ctx context.Context, tokenHash []byte) (accounts.Identity, error) {
	var identity accounts.Identity
	var email *string
	err := db.pool.QueryRow(ctx, `
		SELECT provider, subject, email FROM pending_identities
		WHERE token_hash = $1 AND expires_at > now()`, tokenHash,
	).Scan(&identity.Provider, &identity.Subject, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return accounts.Identity{}, accounts.ErrIdentityExpired
	}
	if err != nil {
		return accounts.Identity{}, fmt.Errorf("find pending identity: %w", err)
	}
	if email != nil {
		identity.Email = *email
	}
	return identity, nil
}
