package notes

import (
	"strings"
	"testing"
)

func TestValidateID(t *testing.T) {
	for _, id := range []string{"3f1c7a52-0d4e-4c55-9d7c-6ab1d5f0e8a1", "abc", "a_b-C9"} {
		if err := ValidateID(id); err != nil {
			t.Errorf("ValidateID(%q) = %v, want nil", id, err)
		}
	}
	for _, id := range []string{"", "has space", "slash/x", "dots..", strings.Repeat("a", 65)} {
		if err := ValidateID(id); err == nil {
			t.Errorf("ValidateID(%q) = nil, want error", id)
		}
	}
}

func TestValidateMarkdown(t *testing.T) {
	if err := ValidateMarkdown("# Title\n\nЗаметка"); err != nil {
		t.Errorf("valid Markdown rejected: %v", err)
	}
	if err := ValidateMarkdown(strings.Repeat("a", MaxMarkdownBytes+1)); err == nil {
		t.Error("oversized Markdown accepted")
	}
	if err := ValidateMarkdown("bad \xff byte"); err == nil {
		t.Error("invalid UTF-8 accepted")
	}
}

func TestConflictErrorMessage(t *testing.T) {
	err := &ConflictError{Current: Note{ID: "n1", Revision: 4}}
	if got, want := err.Error(), "note n1 changed: current revision is 4"; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}
