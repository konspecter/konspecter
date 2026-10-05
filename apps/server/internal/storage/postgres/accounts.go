package postgres

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
)

// StartEmailCode stores a new sign-in code for a (normalized) address and
// retires the address's earlier codes. passwordHash, when not empty, is set
// as the account's password once the code is proven; identity, when it has
// a provider, is linked to the account then.
func (db *DB) StartEmailCode(ctx context.Context, email string, codeHash []byte, passwordHash string, identity accounts.Identity, expiresAt time.Time) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`UPDATE email_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL`, email,
		); err != nil {
			return fmt.Errorf("retire email codes: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM email_codes WHERE email = $1 AND created_at < now() - interval '1 day'`, email,
		); err != nil {
			return fmt.Errorf("prune email codes: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO email_codes (email, code_hash, password_hash, identity_provider, identity_subject, expires_at)
			VALUES ($1, $2, nullif($3, ''), nullif($4, ''), nullif($5, ''), $6)`,
			email, codeHash, passwordHash, identity.Provider, identity.Subject, expiresAt,
		); err != nil {
			return fmt.Errorf("store email code: %w", err)
		}
		return nil
	})
}

// VerifyEmailCode checks a code against the address's newest open code. A
// wrong guess counts against the code (it stops working after
// accounts.MaxCodeAttempts). The right code signs in: the account is created
// if there is none (and createAllowed), its address counts as verified, and
// a password given with the code request becomes its password, and an
// identity given with it is linked.
func (db *DB) VerifyEmailCode(ctx context.Context, email string, codeHash []byte, createAllowed bool) (auth.User, error) {
	var user auth.User
	var outcome error
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		var (
			id           int64
			stored       []byte
			passwordHash *string
			provider     *string
			subject      *string
			attempts     int
			expired      bool
		)
		err := tx.QueryRow(ctx, `
			SELECT id, code_hash, password_hash, identity_provider, identity_subject, attempts, expires_at <= now()
			FROM email_codes WHERE email = $1 AND consumed_at IS NULL
			ORDER BY id DESC LIMIT 1 FOR UPDATE`, email,
		).Scan(&id, &stored, &passwordHash, &provider, &subject, &attempts, &expired)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome = accounts.ErrInvalidCode
			return nil
		}
		if err != nil {
			return fmt.Errorf("find email code: %w", err)
		}
		if expired || attempts >= accounts.MaxCodeAttempts {
			outcome = accounts.ErrInvalidCode
			_, err := tx.Exec(ctx, `UPDATE email_codes SET consumed_at = now() WHERE id = $1`, id)
			return err
		}
		if subtle.ConstantTimeCompare(stored, codeHash) != 1 {
			// Kept: the failed attempt is committed, so guessing stays bounded.
			outcome = accounts.ErrInvalidCode
			_, err := tx.Exec(ctx, `
				UPDATE email_codes SET attempts = attempts + 1,
					consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() END
				WHERE id = $1`, id, accounts.MaxCodeAttempts)
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE email_codes SET consumed_at = now() WHERE id = $1`, id); err != nil {
			return fmt.Errorf("use email code: %w", err)
		}

		err = tx.QueryRow(ctx, `
			UPDATE users SET email_verified_at = coalesce(email_verified_at, now()),
				password_hash = coalesce($2, password_hash)
			WHERE email = $1 RETURNING id::text, email`, email, passwordHash,
		).Scan(&user.ID, &user.Email)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if !createAllowed {
				outcome = accounts.ErrRegistrationClosed
				return nil
			}
			if err := tx.QueryRow(ctx, `
				INSERT INTO users (email, password_hash, email_verified_at) VALUES ($1, $2, now())
				RETURNING id::text, email`, email, passwordHash,
			).Scan(&user.ID, &user.Email); err != nil {
				return fmt.Errorf("create user: %w", err)
			}
		case err != nil:
			return err
		}
		if provider == nil || subject == nil {
			return nil
		}
		return linkIdentity(ctx, tx, user.ID, accounts.Identity{Provider: *provider, Subject: *subject})
	})
	if err != nil {
		return auth.User{}, fmt.Errorf("verify email code: %w", err)
	}
	if outcome != nil {
		return auth.User{}, outcome
	}
	return user, nil
}

// PasswordHash returns the account with a (normalized) address and its
// password hash, "" when it has none. ErrUserNotFound if there is no account.
func (db *DB) PasswordHash(ctx context.Context, email string) (auth.User, string, error) {
	var user auth.User
	var hash *string
	err := db.pool.QueryRow(ctx,
		`SELECT id::text, email, password_hash FROM users WHERE email = $1`, email,
	).Scan(&user.ID, &user.Email, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, "", ErrUserNotFound
	}
	if err != nil {
		return auth.User{}, "", fmt.Errorf("find user: %w", err)
	}
	if hash == nil {
		return user, "", nil
	}
	return user, *hash, nil
}

// CreatePasswordReset stores a reset token for the user; the user's earlier
// links stop working.
func (db *DB) CreatePasswordReset(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM password_resets WHERE user_id = $1`, userID); err != nil {
			return fmt.Errorf("retire password resets: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
			tokenHash, userID, expiresAt,
		); err != nil {
			return fmt.Errorf("store password reset: %w", err)
		}
		return nil
	})
}

// ResetPassword uses a reset token: it sets the new password, marks the
// address verified (the link went to it) and ends every session of the user.
func (db *DB) ResetPassword(ctx context.Context, tokenHash []byte, passwordHash string) (auth.User, error) {
	var user auth.User
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		var userID string
		err := tx.QueryRow(ctx, `
			UPDATE password_resets SET used_at = now()
			WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
			RETURNING user_id::text`, tokenHash,
		).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return accounts.ErrInvalidResetToken
		}
		if err != nil {
			return fmt.Errorf("use password reset: %w", err)
		}
		if err := tx.QueryRow(ctx, `
			UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now())
			WHERE id = $1 RETURNING id::text, email`, userID, passwordHash,
		).Scan(&user.ID, &user.Email); err != nil {
			return fmt.Errorf("set password: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
			return fmt.Errorf("end sessions: %w", err)
		}
		return nil
	})
	if err != nil {
		return auth.User{}, err
	}
	return user, nil
}

// CreateSession stores a signed-in browser and drops the user's expired sessions.
func (db *DB) CreateSession(ctx context.Context, userID string, idHash []byte, userAgent string, expiresAt time.Time) error {
	if len(userAgent) > 512 {
		userAgent = userAgent[:512]
	}
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()`, userID); err != nil {
			return fmt.Errorf("prune sessions: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO sessions (id_hash, user_id, user_agent, expires_at) VALUES ($1, $2, $3, $4)`,
			idHash, userID, userAgent, expiresAt,
		); err != nil {
			return fmt.Errorf("create session: %w", err)
		}
		return nil
	})
}

// SessionByID returns a live (unexpired) session. auth.ErrUnauthorized if there is none.
func (db *DB) SessionByID(ctx context.Context, idHash []byte) (auth.Session, error) {
	var s auth.Session
	err := db.pool.QueryRow(ctx, `
		SELECT u.id::text, u.email, s.last_seen_at, s.expires_at
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.id_hash = $1 AND s.expires_at > now()`, idHash,
	).Scan(&s.User.ID, &s.User.Email, &s.LastSeenAt, &s.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.Session{}, auth.ErrUnauthorized
	}
	if err != nil {
		return auth.Session{}, fmt.Errorf("find session: %w", err)
	}
	return s, nil
}

// ExtendSession records the session's use and moves its expiry.
func (db *DB) ExtendSession(ctx context.Context, idHash []byte, expiresAt time.Time) error {
	if _, err := db.pool.Exec(ctx,
		`UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id_hash = $1`, idHash, expiresAt,
	); err != nil {
		return fmt.Errorf("extend session: %w", err)
	}
	return nil
}

// DeleteSession signs a browser out. Deleting an unknown session is not an error.
func (db *DB) DeleteSession(ctx context.Context, idHash []byte) error {
	if _, err := db.pool.Exec(ctx, `DELETE FROM sessions WHERE id_hash = $1`, idHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}
