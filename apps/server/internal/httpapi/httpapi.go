// Package httpapi is the HTTP/JSON API. It authenticates the apps with bearer
// tokens and the account site with session cookies, scopes every note
// operation to the authenticated user and streams change events
// (Server-Sent Events) to the user's clients.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/keys"
	"konspecter/server/internal/notes"
)

// NoteRepository is the storage the API needs for notes and the content key
// they are encrypted with.
type NoteRepository interface {
	ListNotes(ctx context.Context, userID string) ([]notes.Note, error)
	GetNote(ctx context.Context, userID, id string) (notes.Note, error)
	CreateNote(ctx context.Context, userID, id, content, keyID string) (notes.Note, error)
	UpdateNote(ctx context.Context, userID, id, content, keyID string, baseRevision int64) (notes.Note, error)
	DeleteNote(ctx context.Context, userID, id string, baseRevision int64) (notes.Note, error)
	Changes(ctx context.Context, userID string, cursor int64, limit int) ([]notes.Note, int64, error)
	Key(ctx context.Context, userID string) (keys.Key, error)
	CurrentKeyID(ctx context.Context, userID string) (string, error)
	PutKey(ctx context.Context, userID string, key keys.Key, base *time.Time) (keys.Key, error)
	DeleteKey(ctx context.Context, userID string) error
}

// Authenticator resolves bearer tokens to the devices (apps) they were
// issued to, and keeps track of those devices.
type Authenticator interface {
	DeviceByToken(ctx context.Context, token string) (auth.Device, error)
	RevokeToken(ctx context.Context, token string) error
	RecordSync(ctx context.Context, deviceID string) error
}

// maxBodyBytes leaves room for the JSON around the largest envelope
// (base64url needs no escaping).
const maxBodyBytes = notes.MaxContentBytes + 4096

// Sync pages hold at most this many notes.
const (
	defaultSyncLimit = 100
	maxSyncLimit     = 500
)

type api struct {
	notes     NoteRepository
	auth      Authenticator
	logger    *slog.Logger
	limiter   *windowLimiter
	trusted   []netip.Prefix
	accounts  *accountAPI
	hub       *hub
	heartbeat time.Duration
}

// Options configures the handler.
type Options struct {
	// AllowedOrigins may call the API from a browser (CORS), e.g.
	// "https://notes.example.com". Empty means same-origin only.
	AllowedOrigins []string
	// TrustedProxies may report the client's address in X-Forwarded-For
	// (the reverse proxy, the site's server).
	TrustedProxies []netip.Prefix
	// Accounts turns on sign-in for the account site; nil leaves it off.
	Accounts *Accounts
	// heartbeat overrides defaultHeartbeat (tests).
	heartbeat time.Duration
}

// Handler is the API's HTTP handler.
type Handler struct {
	http.Handler
	hub *hub
}

// CloseStreams ends every open event stream and refuses new ones. Call it
// when the server shuts down (http.Server.RegisterOnShutdown): Shutdown waits
// for active handlers, and a stream would otherwise never finish.
func (h *Handler) CloseStreams() { h.hub.close() }

// NewHandler returns the API's HTTP handler.
func NewHandler(repository NoteRepository, authenticator Authenticator, logger *slog.Logger, options Options) *Handler {
	a := &api{
		notes: repository, auth: authenticator, logger: logger,
		limiter:   newWindowLimiter(authFailuresPerMinute, time.Minute, time.Now),
		trusted:   options.TrustedProxies,
		hub:       newHub(),
		heartbeat: defaultHeartbeat,
	}
	if options.heartbeat > 0 {
		a.heartbeat = options.heartbeat
	}
	if options.Accounts != nil {
		a.accounts = newAccountAPI(*options.Accounts, time.Now)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.Handle("GET /api/me", a.withTokenOrSession(a.me))
	a.registerAccountRoutes(mux)
	mux.Handle("GET /api/notes", a.authenticated(a.listNotes))
	mux.Handle("POST /api/notes", a.authenticated(a.createNote))
	mux.Handle("GET /api/notes/{id}", a.authenticated(a.getNote))
	mux.Handle("PUT /api/notes/{id}", a.authenticated(a.updateNote))
	mux.Handle("DELETE /api/notes/{id}", a.authenticated(a.deleteNote))
	mux.Handle("GET /api/sync", a.withDevice(a.changes))
	mux.Handle("GET /api/events", a.withDevice(a.events))
	a.registerKeyRoutes(mux)
	mux.Handle("DELETE /api/tokens/current", a.authenticated(a.revokeCurrentToken))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "no such endpoint")
	})
	return &Handler{Handler: a.logRequests(securityHeaders(cors(options.AllowedOrigins, mux))), hub: a.hub}
}

// securityHeaders marks every response as data that must not be sniffed,
// framed, cached or leak the referrer. The API serves JSON only.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// revokeCurrentToken signs this token out: it stops working immediately.
func (a *api) revokeCurrentToken(w http.ResponseWriter, r *http.Request, _ auth.User) {
	token, _ := auth.BearerToken(r.Header.Get("Authorization"))
	if err := a.auth.RevokeToken(r.Context(), token); err != nil {
		a.internalError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// cors lets the listed origins call the API from a browser. Credentials are
// bearer tokens in a header, never cookies, so no credentialed CORS is needed.
func cors(allowed []string, next http.Handler) http.Handler {
	origins := make(map[string]bool, len(allowed))
	for _, origin := range allowed {
		origins[origin] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && origins[origin] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// changes returns notes changed since a cursor, deleted ones included, for
// incremental sync. Clients repeat with the returned cursor while more is true.
func (a *api) changes(w http.ResponseWriter, r *http.Request, device auth.Device) {
	user := device.User
	query := r.URL.Query()
	cursor, err := parseOptionalInt(query.Get("since"), 0)
	if err != nil || cursor < 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", `"since" must be a non-negative integer`)
		return
	}
	limit, err := parseOptionalInt(query.Get("limit"), defaultSyncLimit)
	if err != nil || limit < 1 || limit > maxSyncLimit {
		writeError(w, http.StatusBadRequest, "invalid_request", fmt.Sprintf(`"limit" must be between 1 and %d`, maxSyncLimit))
		return
	}
	changed, next, err := a.notes.Changes(r.Context(), user.ID, cursor, int(limit))
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	// For "last synced" on the site; sync itself does not depend on it.
	if err := a.auth.RecordSync(r.Context(), device.ID); err != nil {
		a.logger.WarnContext(r.Context(), "recording a sync failed", "error", err)
	}
	// The key the notes are encrypted with: a client holding another one
	// (the key was reset, or set up anew) must unlock the current one.
	keyID, err := a.notes.CurrentKeyID(r.Context(), user.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	out := make([]noteJSON, 0, len(changed))
	for _, n := range changed {
		out = append(out, toJSON(n))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"notes":  out,
		"cursor": next,
		"more":   len(changed) == int(limit),
		"key_id": nullable(keyID),
	})
}

func parseOptionalInt(value string, fallback int64) (int64, error) {
	if value == "" {
		return fallback, nil
	}
	return strconv.ParseInt(value, 10, 64)
}

type userHandler func(w http.ResponseWriter, r *http.Request, user auth.User)

// deviceHandler serves a request of an app, signed in as a device.
type deviceHandler func(w http.ResponseWriter, r *http.Request, device auth.Device)

// authenticated runs next for the user of the request's bearer token.
func (a *api) authenticated(next userHandler) http.Handler {
	return a.withDevice(func(w http.ResponseWriter, r *http.Request, device auth.Device) {
		next(w, r, device.User)
	})
}

// withDevice runs next for the device of the request's bearer token. A
// disconnected device hears so (401 device_revoked): its app then stops
// syncing and keeps its notes.
func (a *api) withDevice(next deviceHandler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client := clientAddress(r, a.trusted)
		if retry, blocked := a.limiter.blocked(client); blocked {
			w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
			writeError(w, http.StatusTooManyRequests, "rate_limited", "too many failed sign-in attempts; try again later")
			return
		}
		token, err := auth.BearerToken(r.Header.Get("Authorization"))
		if err == nil {
			var device auth.Device
			device, err = a.auth.DeviceByToken(r.Context(), token)
			if err == nil {
				next(w, r, device)
				return
			}
		}
		switch {
		case errors.Is(err, auth.ErrDeviceRevoked):
			a.limiter.record(client)
			w.Header().Set("WWW-Authenticate", `Bearer realm="konspecter", error="invalid_token"`)
			writeError(w, http.StatusUnauthorized, "device_revoked", "this device was disconnected from its account")
		case errors.Is(err, auth.ErrUnauthorized):
			a.limiter.record(client)
			w.Header().Set("WWW-Authenticate", `Bearer realm="konspecter"`)
			writeError(w, http.StatusUnauthorized, "unauthorized", "a valid bearer token is required")
		default:
			a.internalError(w, r, err)
		}
	})
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// noteJSON is the wire format of a note.
type noteJSON struct {
	ID string `json:"id"`
	// Content is the encrypted envelope.
	Content   string     `json:"content"`
	Revision  int64      `json:"revision"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}

func toJSON(n notes.Note) noteJSON {
	return noteJSON{
		ID: n.ID, Content: n.Content, Revision: n.Revision,
		CreatedAt: n.CreatedAt.UTC(), UpdatedAt: n.UpdatedAt.UTC(), DeletedAt: utc(n.DeletedAt),
	}
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func (a *api) me(w http.ResponseWriter, _ *http.Request, user auth.User) {
	writeJSON(w, http.StatusOK, map[string]string{"id": user.ID, "email": user.Email})
}

func (a *api) listNotes(w http.ResponseWriter, r *http.Request, user auth.User) {
	list, err := a.notes.ListNotes(r.Context(), user.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	out := make([]noteJSON, 0, len(list))
	for _, n := range list {
		out = append(out, toJSON(n))
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": out})
}

func (a *api) getNote(w http.ResponseWriter, r *http.Request, user auth.User) {
	id := r.PathValue("id")
	n, err := a.notes.GetNote(r.Context(), user.ID, id)
	if err != nil {
		a.noteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toJSON(n))
}

func (a *api) createNote(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		ID      string  `json:"id"`
		Content *string `json:"content"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Content == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", `"content" is required`)
		return
	}
	keyID, ok := validNote(w, body.ID, *body.Content)
	if !ok {
		return
	}
	n, err := a.notes.CreateNote(r.Context(), user.ID, body.ID, *body.Content, keyID)
	if err != nil {
		a.noteError(w, r, err)
		return
	}
	a.hub.publish(user.ID)
	w.Header().Set("Location", "/api/notes/"+n.ID)
	writeJSON(w, http.StatusCreated, toJSON(n))
}

func (a *api) updateNote(w http.ResponseWriter, r *http.Request, user auth.User) {
	id := r.PathValue("id")
	var body struct {
		Content      *string `json:"content"`
		BaseRevision *int64  `json:"base_revision"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Content == nil || body.BaseRevision == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", `"content" and "base_revision" are required`)
		return
	}
	keyID, ok := validNote(w, id, *body.Content)
	if !ok {
		return
	}
	n, err := a.notes.UpdateNote(r.Context(), user.ID, id, *body.Content, keyID, *body.BaseRevision)
	if err != nil {
		a.noteError(w, r, err)
		return
	}
	a.hub.publish(user.ID)
	writeJSON(w, http.StatusOK, toJSON(n))
}

func (a *api) deleteNote(w http.ResponseWriter, r *http.Request, user auth.User) {
	id := r.PathValue("id")
	base, err := strconv.ParseInt(r.URL.Query().Get("base_revision"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", `query parameter "base_revision" is required`)
		return
	}
	if _, err := a.notes.DeleteNote(r.Context(), user.ID, id, base); err != nil {
		a.noteError(w, r, err)
		return
	}
	a.hub.publish(user.ID)
	w.WriteHeader(http.StatusNoContent)
}

// validNote checks a note's id and envelope and returns the key id the
// envelope names. The server takes only encrypted notes.
func validNote(w http.ResponseWriter, id, content string) (string, bool) {
	if err := notes.ValidateID(id); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", err.Error())
		return "", false
	}
	keyID, err := notes.ParseEnvelope(content)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_content", err.Error())
		return "", false
	}
	return keyID, true
}

// decode reads a JSON request body strictly: JSON content type, size limit,
// no unknown fields and nothing after the object.
func (a *api) decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if mediaType := r.Header.Get("Content-Type"); mediaType != "application/json" && mediaType != "application/json; charset=utf-8" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "send application/json")
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "request body is too large")
			return false
		}
		writeError(w, http.StatusBadRequest, "invalid_json", fmt.Sprintf("invalid JSON: %v", err))
		return false
	}
	if decoder.More() {
		writeError(w, http.StatusBadRequest, "invalid_json", "unexpected data after the JSON object")
		return false
	}
	return true
}

func (a *api) noteError(w http.ResponseWriter, r *http.Request, err error) {
	var conflict *notes.ConflictError
	switch {
	case errors.Is(err, notes.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "note not found")
	case errors.Is(err, notes.ErrEncryptionRequired):
		writeError(w, http.StatusConflict, "encryption_required", "set up encryption before syncing notes")
	case errors.Is(err, notes.ErrKeyMismatch):
		writeError(w, http.StatusConflict, "key_mismatch", "the note is encrypted with a key that is no longer the account's")
	case errors.As(err, &conflict):
		// The client's copy is stale (or the id to create is taken); send the
		// current version so nothing is overwritten and the client can reconcile.
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":   errorBody{Code: "revision_conflict", Message: conflict.Error()},
			"current": toJSON(conflict.Current),
		})
	default:
		a.internalError(w, r, err)
	}
}

func (a *api) internalError(w http.ResponseWriter, r *http.Request, err error) {
	a.logger.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "error", err)
	writeError(w, http.StatusInternalServerError, "internal", "internal server error")
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]errorBody{"error": {Code: code, Message: message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

// Unwrap lets http.ResponseController reach the connection (flushing and
// deadlines for event streams).
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (a *api) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		a.logger.InfoContext(r.Context(), "request",
			"method", r.Method, "path", r.URL.Path, "status", recorder.status,
			"duration", time.Since(start).Round(time.Microsecond))
	})
}
