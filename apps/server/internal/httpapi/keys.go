package httpapi

import (
	"errors"
	"net/http"
	"time"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/keys"
)

// The account's content key, wrapped: the apps (bearer token) fetch it to
// unlock with the passphrase; the site's Encryption section (session) sets
// it up, re-wraps it for a new passphrase, or resets it. The key never
// reaches the server unwrapped.

func (a *api) registerKeyRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/keys", a.withTokenOrSession(a.getKey))
	mux.Handle("PUT /api/keys", a.withTokenOrSession(a.putKey))
	mux.Handle("DELETE /api/keys", a.withTokenOrSession(a.deleteKey))
}

type kdfParamsJSON struct {
	Iterations int `json:"iterations"`
}

type keyJSON struct {
	KeyID              string        `json:"key_id"`
	KDF                string        `json:"kdf"`
	KDFParams          kdfParamsJSON `json:"kdf_params"`
	Salt               string        `json:"salt"`
	WrappedKey         string        `json:"wrapped_key"`
	RecoveryWrappedKey string        `json:"recovery_wrapped_key"`
	CreatedAt          time.Time     `json:"created_at"`
	UpdatedAt          time.Time     `json:"updated_at"`
}

func toKeyJSON(k keys.Key) keyJSON {
	return keyJSON{
		KeyID: k.ID, KDF: k.KDF, KDFParams: kdfParamsJSON{Iterations: k.Iterations},
		Salt: k.Salt, WrappedKey: k.WrappedKey, RecoveryWrappedKey: k.RecoveryWrappedKey,
		CreatedAt: k.CreatedAt.UTC(), UpdatedAt: k.UpdatedAt.UTC(),
	}
}

func (a *api) getKey(w http.ResponseWriter, r *http.Request, user auth.User) {
	k, err := a.notes.Key(r.Context(), user.ID)
	if errors.Is(err, keys.ErrNoKey) {
		writeError(w, http.StatusNotFound, "no_key", "encryption is not set up")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toKeyJSON(k))
}

// putKey sets up the key (without "updated_at") or re-wraps the current one
// (with the "updated_at" the client read: a concurrent change is a 409 with
// the current key, never overwritten).
func (a *api) putKey(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		KeyID              string        `json:"key_id"`
		KDF                string        `json:"kdf"`
		KDFParams          kdfParamsJSON `json:"kdf_params"`
		Salt               string        `json:"salt"`
		WrappedKey         string        `json:"wrapped_key"`
		RecoveryWrappedKey string        `json:"recovery_wrapped_key"`
		UpdatedAt          *time.Time    `json:"updated_at"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	key := keys.Key{
		ID: body.KeyID, KDF: body.KDF, Iterations: body.KDFParams.Iterations,
		Salt: body.Salt, WrappedKey: body.WrappedKey, RecoveryWrappedKey: body.RecoveryWrappedKey,
	}
	if err := key.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_key", err.Error())
		return
	}
	stored, err := a.notes.PutKey(r.Context(), user.ID, key, body.UpdatedAt)
	var conflict *keys.ConflictError
	switch {
	case errors.As(err, &conflict):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":   errorBody{Code: "key_conflict", Message: "the key changed meanwhile; read it again"},
			"current": toKeyJSON(conflict.Current),
		})
	case errors.Is(err, keys.ErrNoKey):
		writeError(w, http.StatusNotFound, "no_key", "encryption is not set up")
	case err != nil:
		a.internalError(w, r, err)
	default:
		a.hub.publish(user.ID) // Locked devices learn there is a key to unlock.
		writeJSON(w, http.StatusOK, toKeyJSON(stored))
	}
}

// deleteKey resets encryption: the key and every note on the server go.
// The devices keep their notes and upload them again under the next key.
func (a *api) deleteKey(w http.ResponseWriter, r *http.Request, user auth.User) {
	if err := a.notes.DeleteKey(r.Context(), user.ID); err != nil {
		a.internalError(w, r, err)
		return
	}
	a.hub.publish(user.ID)
	w.WriteHeader(http.StatusNoContent)
}
