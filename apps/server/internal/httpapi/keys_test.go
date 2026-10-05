package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
)

func b64(n int) string { return base64.RawURLEncoding.EncodeToString(make([]byte, n)) }

// keyBody is a key as a client sends it; updatedAt is "" to set one up.
func keyBody(keyID, updatedAt string) string {
	body := map[string]any{
		"key_id": keyID, "kdf": "pbkdf2-sha256", "kdf_params": map[string]any{"iterations": 600000},
		"salt": b64(16), "wrapped_key": b64(60), "recovery_wrapped_key": b64(60),
	}
	if updatedAt != "" {
		body["updated_at"] = updatedAt
	}
	data, _ := json.Marshal(body)
	return string(data)
}

func TestSettingUpReWrappingAndResettingTheKey(t *testing.T) {
	server, repository := newTestServer(t)
	repository.mu.Lock()
	delete(repository.keys, "user-ada")
	repository.mu.Unlock()

	if r := call(t, server, "GET", "/api/keys", adaToken, ""); r.status != http.StatusNotFound || errorCode(r) != "no_key" {
		t.Fatalf("no key = %d %v", r.status, r.body)
	}
	r := call(t, server, "PUT", "/api/keys", adaToken, keyBody("ada-key", ""))
	if r.status != http.StatusOK || r.body["key_id"] != "ada-key" || r.body["kdf"] != "pbkdf2-sha256" {
		t.Fatalf("set up = %d %v", r.status, r.body)
	}
	first, _ := r.body["updated_at"].(string)
	if params, _ := r.body["kdf_params"].(map[string]any); params["iterations"] != 600000.0 {
		t.Errorf("kdf_params = %v", r.body["kdf_params"])
	}

	// Setting up again, or another key, never replaces the key.
	for _, body := range []string{keyBody("ada-key", ""), keyBody("new-key", "")} {
		r := call(t, server, "PUT", "/api/keys", adaToken, body)
		current, _ := r.body["current"].(map[string]any)
		if r.status != http.StatusConflict || errorCode(r) != "key_conflict" || current["key_id"] != "ada-key" {
			t.Errorf("second set-up = %d %v", r.status, r.body)
		}
	}
	// A re-wrap must be based on the key as it is now.
	r = call(t, server, "PUT", "/api/keys", adaToken, keyBody("ada-key", first))
	if r.status != http.StatusOK {
		t.Fatalf("re-wrap = %d %v", r.status, r.body)
	}
	if r := call(t, server, "PUT", "/api/keys", adaToken, keyBody("ada-key", first)); errorCode(r) != "key_conflict" {
		t.Errorf("a stale re-wrap = %v", r.body)
	}
	if r := call(t, server, "PUT", "/api/keys", adaToken, keyBody("other", r.body["updated_at"].(string))); errorCode(r) != "key_conflict" {
		t.Errorf("a re-wrap to another key id = %v", r.body)
	}

	if r := call(t, server, "POST", "/api/notes", adaToken, fmtNote("n1", "ada-key")); r.status != http.StatusCreated {
		t.Fatalf("a note under the key = %d %v", r.status, r.body)
	}
	if r := call(t, server, "DELETE", "/api/keys", adaToken, ""); r.status != http.StatusNoContent {
		t.Fatalf("reset = %d", r.status)
	}
	if r := call(t, server, "GET", "/api/notes/n1", adaToken, ""); r.status != http.StatusNotFound {
		t.Errorf("a note after the reset = %d", r.status)
	}
	if r := call(t, server, "POST", "/api/notes", adaToken, fmtNote("n2", "ada-key")); errorCode(r) != "encryption_required" {
		t.Errorf("a note after the reset = %v", r.body)
	}
	if r := call(t, server, "PUT", "/api/keys", adaToken, keyBody("ada-key", first)); r.status != http.StatusNotFound {
		t.Errorf("re-wrapping a reset key = %d", r.status)
	}
}

func fmtNote(id, keyID string) string {
	data, _ := json.Marshal(map[string]string{"id": id, "content": sealedWith(keyID, "secret")})
	return string(data)
}

func TestKeysAreValidated(t *testing.T) {
	server, repository := newTestServer(t)
	repository.mu.Lock()
	delete(repository.keys, "user-ada")
	repository.mu.Unlock()
	for _, body := range []string{
		`{"key_id":"k","kdf":"scrypt","kdf_params":{"iterations":1},"salt":"","wrapped_key":"","recovery_wrapped_key":""}`,
		keyBody("has.dot", ""),
	} {
		if r := call(t, server, "PUT", "/api/keys", adaToken, body); r.status != http.StatusBadRequest || errorCode(r) != "invalid_key" {
			t.Errorf("%s = %d %v", body, r.status, r.body)
		}
	}
}

func TestTheSiteManagesTheKeyWithASession(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	var body map[string]any
	_ = json.Unmarshal([]byte(keyBody("ann-key", "")), &body)
	if r := siteCall(t, s.server.URL, http.MethodPut, "/api/keys", session, body); r.status != http.StatusOK {
		t.Fatalf("set up from the site = %d %v", r.status, r.body)
	}
	if r := siteCall(t, s.server.URL, http.MethodGet, "/api/keys", session, nil); r.body["key_id"] != "ann-key" {
		t.Errorf("read from the site = %v", r.body)
	}
	// From another origin, a session is not enough.
	if r := callWithCookie(t, s.server, http.MethodDelete, "/api/keys", session, "https://evil.example"); r.status != http.StatusForbidden {
		t.Errorf("reset from another site = %d", r.status)
	}
}

func TestKeyChangesWakeTheDevices(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{})
	stream := openStream(t, server, adaToken)
	stream.nextEvent(t)
	call(t, server, "DELETE", "/api/keys", adaToken, "")
	if frame := stream.nextEvent(t); frame != changesEvent {
		t.Errorf("after a reset: %q", frame)
	}
}
