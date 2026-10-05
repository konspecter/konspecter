package keys

import (
	"encoding/base64"
	"strings"
	"testing"
)

func b64(n int) string { return base64.RawURLEncoding.EncodeToString(make([]byte, n)) }

func valid() Key {
	return Key{ID: "k1", KDF: KDF, Iterations: 600_000, Salt: b64(16), WrappedKey: b64(60), RecoveryWrappedKey: b64(60)}
}

func TestValidate(t *testing.T) {
	if err := valid().Validate(); err != nil {
		t.Fatalf("valid key: %v", err)
	}
	for name, change := range map[string]func(*Key){
		"key id":       func(k *Key) { k.ID = "has.dot" },
		"long key id":  func(k *Key) { k.ID = strings.Repeat("k", 65) },
		"kdf":          func(k *Key) { k.KDF = "scrypt" },
		"iterations":   func(k *Key) { k.Iterations = 0 },
		"many":         func(k *Key) { k.Iterations = MaxIterations + 1 },
		"salt":         func(k *Key) { k.Salt = b64(8) },
		"padded salt":  func(k *Key) { k.Salt = base64.URLEncoding.EncodeToString(make([]byte, 16)) },
		"wrapped key":  func(k *Key) { k.WrappedKey = "not base64!" },
		"recovery key": func(k *Key) { k.RecoveryWrappedKey = b64(32) },
	} {
		k := valid()
		change(&k)
		if err := k.Validate(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
