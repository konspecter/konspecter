// Package auth identifies users by API tokens. Tokens are random secrets
// shown once; only their SHA-256 hashes are stored.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strings"
)

// User is an account that owns notes.
type User struct {
	ID    string
	Email string
}

// ErrUnauthorized means the token is missing, malformed or unknown.
var ErrUnauthorized = errors.New("unauthorized")

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
