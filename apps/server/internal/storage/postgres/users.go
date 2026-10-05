package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"konspecter/server/internal/auth"
)

// ErrUserExists means the email address is already registered.
var ErrUserExists = errors.New("user already exists")

// ErrUserNotFound means there is no user with that email address.
var ErrUserNotFound = auth.ErrUserNotFound

// CreateUser registers a user by (normalized) email address.
func (db *DB) CreateUser(ctx context.Context, email string) (auth.User, error) {
	normalized, err := auth.NormalizeEmail(email)
	if err != nil {
		return auth.User{}, err
	}
	var user auth.User
	err = db.pool.QueryRow(ctx,
		`INSERT INTO users (email) VALUES ($1) RETURNING id::text, email`, normalized,
	).Scan(&user.ID, &user.Email)
	if isUniqueViolation(err) {
		return auth.User{}, ErrUserExists
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("create user: %w", err)
	}
	return user, nil
}

// UserByEmail looks a user up by email address.
func (db *DB) UserByEmail(ctx context.Context, email string) (auth.User, error) {
	normalized, err := auth.NormalizeEmail(email)
	if err != nil {
		return auth.User{}, err
	}
	var user auth.User
	err = db.pool.QueryRow(ctx,
		`SELECT id::text, email FROM users WHERE email = $1`, normalized,
	).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, ErrUserNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("find user: %w", err)
	}
	return user, nil
}

// CreateToken issues a new API token for the user. The token is returned once
// and only its hash is stored.
func (db *DB) CreateToken(ctx context.Context, userID string) (string, error) {
	token, hash, err := auth.NewToken()
	if err != nil {
		return "", err
	}
	if _, err := db.pool.Exec(ctx,
		`INSERT INTO api_tokens (token_hash, user_id) VALUES ($1, $2)`, hash, userID,
	); err != nil {
		return "", fmt.Errorf("create token: %w", err)
	}
	return token, nil
}

// RevokeToken deletes one token. Revoking an unknown token is not an error.
func (db *DB) RevokeToken(ctx context.Context, token string) error {
	if _, err := db.pool.Exec(ctx, `DELETE FROM api_tokens WHERE token_hash = $1`, auth.HashToken(token)); err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	return nil
}

// RevokeUserTokens deletes every token of a user and returns how many there were.
func (db *DB) RevokeUserTokens(ctx context.Context, userID string) (int64, error) {
	tag, err := db.pool.Exec(ctx, `DELETE FROM api_tokens WHERE user_id = $1`, userID)
	if err != nil {
		return 0, fmt.Errorf("revoke tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}

// UserByToken resolves a bearer token to its user and records its use.
func (db *DB) UserByToken(ctx context.Context, token string) (auth.User, error) {
	var user auth.User
	err := db.pool.QueryRow(ctx, `
		UPDATE api_tokens t SET last_used_at = now()
		FROM users u
		WHERE t.token_hash = $1 AND u.id = t.user_id
		RETURNING u.id::text, u.email`, auth.HashToken(token),
	).Scan(&user.ID, &user.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return auth.User{}, auth.ErrUnauthorized
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("authenticate: %w", err)
	}
	return user, nil
}
