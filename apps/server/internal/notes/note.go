// Package notes defines notes as the server stores them: a client-chosen id,
// the encrypted document, and a revision that increases with every change.
//
// The server never sees a note's text. Clients encrypt each note with the
// account's content key (see package keys) and send the envelope
// "ksp1.<key id>.<base64url(iv ‖ ciphertext ‖ tag)>"; the server checks only
// its shape and that it names the account's current key.
package notes

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// MaxContentBytes limits one envelope: 5 MiB of text, encrypted and in
// base64url, fits with room to spare.
const MaxContentBytes = 7 << 20

// Note is one encrypted document owned by a user.
type Note struct {
	ID string
	// Content is the envelope; the server cannot read it.
	Content   string
	Revision  int64
	CreatedAt time.Time
	UpdatedAt time.Time
	// DeletedAt is set once the note is deleted. Deleted notes keep their
	// content so that no version is lost.
	DeletedAt *time.Time
}

// Deleted reports whether the note has been deleted.
func (n Note) Deleted() bool { return n.DeletedAt != nil }

// ErrNotFound means the user has no (undeleted) note with that id.
var ErrNotFound = errors.New("note not found")

// ErrEncryptionRequired means the account has no content key yet: notes can
// be stored only once its owner has set up encryption.
var ErrEncryptionRequired = errors.New("encryption is not set up")

// ErrKeyMismatch means the note is encrypted with a key that is not the
// account's current one (the key was reset since).
var ErrKeyMismatch = errors.New("the note is encrypted with another key")

// ConflictError is returned when a change was based on an old revision, or
// when a note to create already exists (possibly deleted). It carries the
// current version so the client can resolve the conflict.
type ConflictError struct {
	Current Note
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("note %s changed: current revision is %d", e.Current.ID, e.Current.Revision)
}

// Clients create ids (they may be offline); UUIDs are expected, but any short
// token of letters, digits, '-' and '_' is accepted.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidateID reports whether id is an acceptable note id.
func ValidateID(id string) error {
	if !idPattern.MatchString(id) {
		return fmt.Errorf("invalid note id %q: use 1-64 letters, digits, '-' or '_'", id)
	}
	return nil
}

// minPayload is the shortest base64url payload: a 12-byte IV and a 16-byte tag.
const minPayload = 38

// ParseEnvelope checks an envelope's shape and size and returns the key id
// it names. It does not decrypt (it cannot).
func ParseEnvelope(content string) (keyID string, err error) {
	if len(content) > MaxContentBytes {
		return "", fmt.Errorf("note is %d bytes; the limit is %d", len(content), MaxContentBytes)
	}
	version, rest, _ := strings.Cut(content, ".")
	keyID, payload, ok := strings.Cut(rest, ".")
	if version != "ksp1" || !ok || !ValidKeyID(keyID) {
		return "", errors.New(`note is not encrypted: want "ksp1.<key id>.<base64url>"`)
	}
	if len(payload) < minPayload || len(payload)%4 == 1 || strings.ContainsFunc(payload, notBase64URL) {
		return "", errors.New("the encrypted note is malformed")
	}
	return keyID, nil
}

var keyIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidKeyID reports whether id can name a content key.
func ValidKeyID(id string) bool { return keyIDPattern.MatchString(id) }

func notBase64URL(r rune) bool {
	return !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_')
}
