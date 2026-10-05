// Package auth identifies users: apps by API tokens, browsers on the site by
// sessions. Both are random secrets shown once; only their SHA-256 hashes
// are stored.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
)

// User is an account that owns notes.
type User struct {
	ID    string
	Email string
}

// Device is an app signed in with an API token: the device it was issued to
// and the device's user.
type Device struct {
	ID   string
	User User
}

// ErrUnauthorized means the token or session is missing, malformed, unknown or expired.
var ErrUnauthorized = errors.New("unauthorized")

// ErrDeviceRevoked means the token's device was disconnected from its account.
var ErrDeviceRevoked = errors.New("device revoked")

// ErrUserNotFound means there is no user with that email address.
var ErrUserNotFound = errors.New("user not found")

// Session is a browser signed in to the site. Its id lives in a cookie; its
// expiry moves forward while it is used.
type Session struct {
	User User
	// CreatedAt is when the browser signed in.
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

// SessionPrefix starts every session id.
const SessionPrefix = "kss_"

const tokenPrefix = "ksp_"

// NewToken returns a new random token and the hash to store for it.
func NewToken() (token string, hash []byte, err error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", nil, fmt.Errorf("generate token: %w", err)
	}
	token = tokenPrefix + base64.RawURLEncoding.EncodeToString(secret)
	return token, HashToken(token), nil
}

// HashToken returns the stored form of a token.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// BearerToken extracts the token from an Authorization header value.
func BearerToken(header string) (string, error) {
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || !strings.HasPrefix(token, tokenPrefix) {
		return "", ErrUnauthorized
	}
	return token, nil
}

// NormalizeEmail validates an address and returns its canonical (lowercase) form.
func NormalizeEmail(email string) (string, error) {
	address, err := mail.ParseAddress(strings.TrimSpace(email))
	if err != nil || address.Name != "" {
		return "", fmt.Errorf("invalid email address %q", email)
	}
	return strings.ToLower(address.Address), nil
}
