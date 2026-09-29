// Package notes defines notes as the server stores them: a client-chosen id,
// the Markdown document, and a revision that increases with every change.
package notes

import (
	"errors"
	"fmt"
	"regexp"
	"time"
	"unicode/utf8"
)

// MaxMarkdownBytes limits the size of one document.
const MaxMarkdownBytes = 5 << 20

// Note is one Markdown document owned by a user.
type Note struct {
	ID        string
	Markdown  string
	Revision  int64
	CreatedAt time.Time
	UpdatedAt time.Time
	// DeletedAt is set once the note is deleted. Deleted notes keep their
	// Markdown so that no version is lost.
	DeletedAt *time.Time
}

// Deleted reports whether the note has been deleted.
func (n Note) Deleted() bool { return n.DeletedAt != nil }

// ErrNotFound means the user has no (undeleted) note with that id.
var ErrNotFound = errors.New("note not found")

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

// ValidateMarkdown reports whether markdown can be stored.
func ValidateMarkdown(markdown string) error {
	if len(markdown) > MaxMarkdownBytes {
		return fmt.Errorf("note is %d bytes; the limit is %d", len(markdown), MaxMarkdownBytes)
	}
	if !utf8.ValidString(markdown) {
		return errors.New("note is not valid UTF-8")
	}
	return nil
}
