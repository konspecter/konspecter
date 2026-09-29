package auth

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestNewTokenIsRandomAndHashed(t *testing.T) {
	token1, hash1, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	token2, _, _ := NewToken()
	if token1 == token2 {
		t.Error("two tokens are equal")
	}
	if !strings.HasPrefix(token1, "ksp_") || len(token1) < 40 {
		t.Errorf("unexpected token format %q", token1)
	}
	if !bytes.Equal(hash1, HashToken(token1)) {
		t.Error("returned hash does not match HashToken")
	}
	if bytes.Contains(hash1, []byte(token1)) {
		t.Error("hash contains the token")
	}
}

func TestBearerToken(t *testing.T) {
	if got, err := BearerToken("Bearer ksp_abc"); err != nil || got != "ksp_abc" {
		t.Errorf("BearerToken = %q, %v", got, err)
	}
	if got, err := BearerToken("bearer ksp_abc"); err != nil || got != "ksp_abc" {
		t.Errorf("case-insensitive scheme: %q, %v", got, err)
	}
	for _, header := range []string{"", "Bearer", "Basic ksp_abc", "Bearer other", "ksp_abc"} {
		if _, err := BearerToken(header); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("BearerToken(%q) error = %v, want ErrUnauthorized", header, err)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got, err := NormalizeEmail("  Ada@Example.COM "); err != nil || got != "ada@example.com" {
		t.Errorf("NormalizeEmail = %q, %v", got, err)
	}
	for _, email := range []string{"", "not-an-email", "Ada <ada@example.com>"} {
		if _, err := NormalizeEmail(email); err == nil {
			t.Errorf("NormalizeEmail(%q) accepted", email)
		}
	}
}
