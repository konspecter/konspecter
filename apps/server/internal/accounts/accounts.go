// Package accounts holds the rules for signing in on the site: password
// hashing, one-time email codes, password reset tokens and identities at
// other services. Storage and HTTP live elsewhere; this package only makes
// and checks secrets.
package accounts

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Errors the sign-in flows report. They are deliberately coarse: a caller
// learns that the attempt failed, not whether the account exists.
var (
	// ErrInvalidCredentials means the email or password is wrong.
	ErrInvalidCredentials = errors.New("invalid email or password")
	// ErrInvalidCode means the code is wrong, expired, used or tried too often.
	ErrInvalidCode = errors.New("invalid or expired code")
	// ErrInvalidResetToken means the reset link is unknown, expired or used.
	ErrInvalidResetToken = errors.New("invalid or expired reset link")
	// ErrRegistrationClosed means new accounts are not accepted.
	ErrRegistrationClosed = errors.New("registration is closed")
	// ErrEmailRequired means an identity is new and its provider vouched for
	// no address: its owner must prove one before it can sign in.
	ErrEmailRequired = errors.New("an email address is required")
	// ErrIdentityExpired means a pending identity is unknown or has expired.
	ErrIdentityExpired = errors.New("the pending sign-in has expired")
)

// Identity is an account at another service (an OAuth provider) signing in.
//
// It signs in to the user it is linked to. A new identity is linked by its
// address: only an address the provider vouches for (EmailVerified) may
// reach an existing account or create one; without one, the owner proves an
// address with an email code first (ErrEmailRequired).
type Identity struct {
	Provider string
	Subject  string
	// Email is the provider's address for the account, normalized; "" if none.
	Email string
	// EmailVerified says the provider vouches that the account owns Email.
	EmailVerified bool
}

// Password length limits, in characters. The upper bound only keeps hashing cheap.
const (
	MinPasswordLength = 8
	MaxPasswordLength = 256
)

// ValidatePassword checks a new password's length.
func ValidatePassword(password string) error {
	n := utf8.RuneCountInString(password)
	if !utf8.ValidString(password) || n < MinPasswordLength || n > MaxPasswordLength {
		return fmt.Errorf("a password needs %d to %d characters", MinPasswordLength, MaxPasswordLength)
	}
	return nil
}

// argon2id parameters: the OWASP minimum (19 MiB, 2 passes, 1 lane).
const (
	argonMemory  = 19 * 1024
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// HashPassword returns the password's argon2id hash in PHC string form:
// $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// CheckPassword reports whether password matches a hash from HashPassword.
// The parameters come from the hash, so stronger settings later still verify
// old hashes.
func CheckPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != fmt.Sprintf("v=%d", argon2.Version) {
		return false
	}
	var memory uint32
	var time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false
	}
	if memory == 0 || memory > 1<<20 || time == 0 || time > 16 || threads == 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// dummyHash is checked when an account has no password, so a failed sign-in
// takes as long whether or not the account exists.
var dummyHash = func() string {
	hash, err := HashPassword("konspecter-dummy-password")
	if err != nil {
		panic(err)
	}
	return hash
}()

// CheckPasswordOrDummy is CheckPassword for a hash that may be missing (no
// account, or an account without a password): it always does the work.
func CheckPasswordOrDummy(hash, password string) bool {
	if hash == "" {
		CheckPassword(dummyHash, password)
		return false
	}
	return CheckPassword(hash, password)
}

// CodeLength is the number of digits in an email code.
const CodeLength = 6

// MaxCodeAttempts is how many wrong guesses one code survives.
const MaxCodeAttempts = 5

// NewCode returns a random code of CodeLength digits.
func NewCode() (string, error) {
	limit := big.NewInt(1_000_000)
	n, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return "", fmt.Errorf("generate code: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// NormalizeCode strips the spaces and dashes people type into codes.
func NormalizeCode(code string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' {
			return -1
		}
		return r
	}, strings.TrimSpace(code))
}

// HashCode returns the stored form of a code sent to a (normalized) address.
func HashCode(email, code string) []byte {
	sum := sha256.Sum256([]byte("konspecter/email-code\x00" + email + "\x00" + code))
	return sum[:]
}

// NewSecret returns a random URL-safe secret with a prefix (reset tokens,
// session ids) and the SHA-256 hash to store for it.
func NewSecret(prefix string) (secret string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("generate secret: %w", err)
	}
	secret = prefix + base64.RawURLEncoding.EncodeToString(raw)
	return secret, HashSecret(secret), nil
}

// HashSecret returns the stored form of a secret from NewSecret.
func HashSecret(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}
