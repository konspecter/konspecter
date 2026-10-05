// Package keys holds an account's content key as the server keeps it:
// wrapped, never in the clear. The owner's devices unwrap it with the
// passphrase (or, to set a new passphrase, with the recovery key) and
// encrypt every note with it; the server only stores and hands out the
// wrapped forms and checks that notes name the current key.
package keys

import (
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"konspecter/server/internal/notes"
)

// KDF is the only passphrase stretching the clients use so far.
const KDF = "pbkdf2-sha256"

// Iteration bounds for the KDF: anything outside is a broken client.
const (
	MinIterations = 1
	MaxIterations = 10_000_000
)

// Key is an account's wrapped content key. The binary values are base64url
// without padding.
type Key struct {
	ID         string
	KDF        string
	Iterations int
	// Salt is the passphrase KDF's salt.
	Salt string
	// WrappedKey is the content key encrypted with the passphrase's key.
	WrappedKey string
	// RecoveryWrappedKey is the content key encrypted with the recovery key's key.
	RecoveryWrappedKey string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// ErrNoKey means the account has not set up encryption.
var ErrNoKey = errors.New("encryption is not set up")

// ConflictError means the key changed since the client read it (or one
// exists already); Current is the key now.
type ConflictError struct {
	Current Key
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("the key changed: the current key is %s, updated %s", e.Current.ID, e.Current.UpdatedAt.Format(time.RFC3339Nano))
}

// Sizes in bytes of the decoded values: a 16-byte salt; a wrapped 32-byte
// key is a 12-byte IV, the key and a 16-byte tag.
const (
	saltBytes    = 16
	wrappedBytes = 12 + 32 + 16
)

// Validate checks a key a client sent.
func (k Key) Validate() error {
	switch {
	case !notes.ValidKeyID(k.ID):
		return errors.New(`"key_id" must be 1-64 letters, digits, '-' or '_'`)
	case k.KDF != KDF:
		return fmt.Errorf(`"kdf" must be %q`, KDF)
	case k.Iterations < MinIterations || k.Iterations > MaxIterations:
		return fmt.Errorf(`"kdf_params.iterations" must be between %d and %d`, MinIterations, MaxIterations)
	case !decodesTo(k.Salt, saltBytes):
		return fmt.Errorf(`"salt" must be %d bytes in base64url`, saltBytes)
	case !decodesTo(k.WrappedKey, wrappedBytes):
		return errors.New(`"wrapped_key" must be a wrapped 256-bit key in base64url`)
	case !decodesTo(k.RecoveryWrappedKey, wrappedBytes):
		return errors.New(`"recovery_wrapped_key" must be a wrapped 256-bit key in base64url`)
	}
	return nil
}

func decodesTo(value string, size int) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == size
}
