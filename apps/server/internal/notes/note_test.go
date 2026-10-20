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

func TestParseEnvelope(t *testing.T) {
	payload := strings.Repeat("A", 40)
	keyID, err := ParseEnvelope("ksp1.k-1_x." + payload)
	if err != nil || keyID != "k-1_x" {
		t.Errorf("ParseEnvelope = %q, %v", keyID, err)
	}
	for _, bad := range []string{
		"# Plain Markdown",
		"ksp1." + payload,
		"ksp2.key." + payload,
		"ksp1..key" + payload,
		"ksp1.key." + strings.Repeat("A", 20),             // shorter than an IV and a tag
		"ksp1.key." + payload + "+",                       // not base64url
		"ksp1.key." + strings.Repeat("A", 41),             // impossible base64 length
		"ksp1.ke.y." + payload,                            // a dot in the payload
		"ksp1." + strings.Repeat("k", 65) + "." + payload, // key id too long
		"ksp1.key." + strings.Repeat("A", MaxContentBytes),
	} {
		if _, err := ParseEnvelope(bad); err == nil {
			t.Errorf("ParseEnvelope(%.40q…) accepted", bad)
		}
	}
}

func TestConflictErrorMessage(t *testing.T) {
	err := &ConflictError{Current: Note{ID: "n1", Revision: 4}}
	if got, want := err.Error(), "note n1 changed: current revision is 4"; got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

func TestStorageAllowsOnlyWhatFits(t *testing.T) {
	cases := []struct {
		name          string
		storage       Storage
		before, after int64
		want          bool
	}{
		{"a new note that fits", Storage{Used: 60, Quota: 100}, 0, 40, true},
		{"a new note one byte too big", Storage{Used: 60, Quota: 100}, 0, 41, false},
		{"an edit that grows within the quota", Storage{Used: 90, Quota: 100}, 30, 40, true},
		{"an edit that grows past the quota", Storage{Used: 90, Quota: 100}, 30, 41, false},
		{"an edit that shrinks over a lowered quota", Storage{Used: 500, Quota: 100}, 300, 200, true},
		{"an edit of the same size over the quota", Storage{Used: 500, Quota: 100}, 300, 300, true},
		{"a new note over the quota", Storage{Used: 500, Quota: 100}, 0, 1, false},
	}
	for _, c := range cases {
		if got := c.storage.Allows(c.before, c.after); got != c.want {
			t.Errorf("%s: Allows(%d, %d) = %v; want %v", c.name, c.before, c.after, got, c.want)
		}
	}
}
