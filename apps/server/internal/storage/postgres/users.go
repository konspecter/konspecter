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
