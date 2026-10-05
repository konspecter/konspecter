package accounts

import (
	"bytes"
	"strings"
	"testing"
)

func TestPasswordsHashAndCheck(t *testing.T) {
	hash, err := HashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Errorf("hash = %q", hash)
	}
	if !CheckPassword(hash, "correct horse") {
		t.Error("the right password was rejected")
	}
	if CheckPassword(hash, "correct horsE") {
		t.Error("a wrong password was accepted")
	}
	other, _ := HashPassword("correct horse")
	if other == hash {
		t.Error("two hashes of one password share a salt")
	}
}

func TestCheckPasswordRejectsBrokenHashes(t *testing.T) {
	for _, hash := range []string{
		"",
		"plain",
		"$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=18$m=19456,t=2,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=x,t=2,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=99999999,t=2,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=19456,t=2,p=1$!!$aGFzaA",
		"$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$",
	} {
		if CheckPassword(hash, "anything") {
			t.Errorf("CheckPassword(%q) = true", hash)
		}
	}
	if CheckPasswordOrDummy("", "anything") {
		t.Error("a missing hash was accepted")
	}
}

func TestValidatePassword(t *testing.T) {
	for _, ok := range []string{"12345678", "пароль12", strings.Repeat("x", MaxPasswordLength)} {
		if err := ValidatePassword(ok); err != nil {
			t.Errorf("ValidatePassword(%q) = %v", ok, err)
		}
	}
	for _, bad := range []string{"", "1234567", strings.Repeat("x", MaxPasswordLength+1), "abc\xffdefgh"} {
		if ValidatePassword(bad) == nil {
			t.Errorf("ValidatePassword(%q) accepted", bad)
		}
	}
}

func TestCodes(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		code, err := NewCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != CodeLength || strings.Trim(code, "0123456789") != "" {
			t.Fatalf("code = %q", code)
		}
		seen[code] = true
	}
	if len(seen) < 45 {
		t.Errorf("only %d distinct codes in 50", len(seen))
	}
	if got := NormalizeCode(" 123-456 "); got != "123456" {
		t.Errorf("NormalizeCode = %q", got)
	}
	if bytes.Equal(HashCode("a@example.com", "123456"), HashCode("b@example.com", "123456")) {
		t.Error("a code hashes the same for two addresses")
	}
}

func TestSecrets(t *testing.T) {
	secret, hash, err := NewSecret("ksr_")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "ksr_") || len(secret) != 4+43 {
		t.Errorf("secret = %q", secret)
	}
	if !bytes.Equal(hash, HashSecret(secret)) {
		t.Error("the hash does not match the secret")
	}
}
