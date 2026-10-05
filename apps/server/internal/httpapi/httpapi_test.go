package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/devices"
	"konspecter/server/internal/notes"
)

// fakeRepository mirrors the PostgreSQL repository's rules in memory.
type fakeRepository struct {
	mu      sync.Mutex
	notes   map[string]notes.Note // key: userID + "/" + id
	seq     map[string]int64      // key → change sequence of its last change
	order   []string              // keys by last change, oldest first
	lastSeq int64
	fail    error
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{notes: map[string]notes.Note{}, seq: map[string]int64{}}
}

// touch records a change to key (caller holds mu).
func (f *fakeRepository) touch(key string) {
	f.lastSeq++
	f.seq[key] = f.lastSeq
	for i, k := range f.order {
		if k == key {
			f.order = append(f.order[:i], f.order[i+1:]...)
			break
		}
	}
	f.order = append(f.order, key)
}

func (f *fakeRepository) ListNotes(_ context.Context, userID string) ([]notes.Note, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail != nil {
		return nil, f.fail
	}
	var out []notes.Note
	for key, n := range f.notes {
		if strings.HasPrefix(key, userID+"/") && !n.Deleted() {
			out = append(out, n)
		}
	}
	return out, nil
}

func (f *fakeRepository) GetNote(_ context.Context, userID, id string) (notes.Note, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.notes[userID+"/"+id]
	if !ok || n.Deleted() {
		return notes.Note{}, notes.ErrNotFound
	}
	return n, nil
}

func (f *fakeRepository) CreateNote(_ context.Context, userID, id, markdown string) (notes.Note, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := userID + "/" + id
	if n, ok := f.notes[key]; ok {
		return notes.Note{}, &notes.ConflictError{Current: n}
	}
	now := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
	n := notes.Note{ID: id, Markdown: markdown, Revision: 1, CreatedAt: now, UpdatedAt: now}
	f.notes[key] = n
	f.touch(key)
	return n, nil
}

// change applies a change at base. Only an update may change a deleted note
// (restoring it); a deletion of one conflicts.
func (f *fakeRepository) change(userID, id string, base int64, restores bool, apply func(*notes.Note)) (notes.Note, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := userID + "/" + id
	n, ok := f.notes[key]
	if !ok {
		return notes.Note{}, notes.ErrNotFound
	}
	if n.Revision != base || n.Deleted() && !restores {
		return notes.Note{}, &notes.ConflictError{Current: n}
	}
	apply(&n)
	n.Revision++
	f.notes[key] = n
	f.touch(key)
	return n, nil
}

func (f *fakeRepository) UpdateNote(_ context.Context, userID, id, markdown string, base int64) (notes.Note, error) {
	return f.change(userID, id, base, true, func(n *notes.Note) {
		n.Markdown = markdown
		n.DeletedAt = nil
	})
}

func (f *fakeRepository) DeleteNote(_ context.Context, userID, id string, base int64) (notes.Note, error) {
	return f.change(userID, id, base, false, func(n *notes.Note) {
		now := time.Now()
		n.DeletedAt = &now
	})
}

func (f *fakeRepository) Changes(_ context.Context, userID string, cursor int64, limit int) ([]notes.Note, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var changed []notes.Note
	next := cursor
	for _, key := range f.order {
		n := f.notes[key]
		if !strings.HasPrefix(key, userID+"/") || f.seq[key] <= cursor {
			continue
		}
		if len(changed) == limit {
			break
		}
		changed = append(changed, n)
		next = f.seq[key]
	}
	return changed, next, nil
}

// fakeDevices keeps devices in memory: the tokens apps sign in with
// (Authenticator) and the browser flow that connects them (DeviceStore).
type fakeDevices struct {
	mu             sync.Mutex
	byToken        map[string]*fakeDevice
	authorizations map[string]*fakeAuthorization // by device code hash
	next           int
}

type fakeDevice struct {
	device  auth.Device
	info    devices.Device
	revoked bool
}

type fakeAuthorization struct {
	userCodeHash string
	client       devices.Client
	status       string
	userID       string
	expiresAt    time.Time
	lastPoll     time.Time
}

func newFakeDevices() *fakeDevices {
	return &fakeDevices{byToken: map[string]*fakeDevice{}, authorizations: map[string]*fakeAuthorization{}}
}

// add connects a device for user under token.
func (f *fakeDevices) add(token string, user auth.User, client devices.Client) devices.Device {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.addLocked(token, user, client)
}

func (f *fakeDevices) addLocked(token string, user auth.User, client devices.Client) devices.Device {
	f.next++
	id := fmt.Sprintf("00000000-0000-4000-8000-%012d", f.next)
	info := devices.Device{ID: id, Name: client.Name, Platform: client.Platform, ClientVersion: client.ClientVersion, CreatedAt: time.Now()}
	f.byToken[token] = &fakeDevice{device: auth.Device{ID: id, User: user}, info: info}
	return info
}

func (f *fakeDevices) DeviceByToken(_ context.Context, token string) (auth.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d, ok := f.byToken[token]
	switch {
	case !ok:
		return auth.Device{}, auth.ErrUnauthorized
	case d.revoked:
		return auth.Device{}, auth.ErrDeviceRevoked
	}
	now := time.Now()
	d.info.LastUsedAt = &now
	return d.device, nil
}

func (f *fakeDevices) RevokeToken(_ context.Context, token string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.byToken, token)
	return nil
}

func (f *fakeDevices) RecordSync(_ context.Context, deviceID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, d := range f.byToken {
		if d.device.ID == deviceID {
			now := time.Now()
			d.info.LastSyncAt = &now
		}
	}
	return nil
}

func (f *fakeDevices) CreateDeviceAuthorization(_ context.Context, deviceCodeHash, userCodeHash []byte, client devices.Client, expiresAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.authorizations[string(deviceCodeHash)] = &fakeAuthorization{
		userCodeHash: string(userCodeHash), client: client, status: "pending", expiresAt: expiresAt,
	}
	return nil
}

func (f *fakeDevices) pending(userCodeHash []byte) *fakeAuthorization {
	for _, a := range f.authorizations {
		if a.userCodeHash == string(userCodeHash) && a.status == "pending" && time.Now().Before(a.expiresAt) {
			return a
		}
	}
	return nil
}

func (f *fakeDevices) PendingDeviceAuthorization(_ context.Context, userCodeHash []byte) (devices.Client, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a := f.pending(userCodeHash)
	if a == nil {
		return devices.Client{}, devices.ErrInvalidUserCode
	}
	return a.client, nil
}

func (f *fakeDevices) DecideDeviceAuthorization(_ context.Context, userCodeHash []byte, userID string, approve bool) (devices.Client, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a := f.pending(userCodeHash)
	if a == nil {
		return devices.Client{}, devices.ErrInvalidUserCode
	}
	a.status, a.userID = "denied", userID
	if approve {
		a.status = "approved"
	}
	return a.client, nil
}

func (f *fakeDevices) ExchangeDeviceCode(_ context.Context, deviceCodeHash, tokenHash []byte) (devices.Device, auth.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a, ok := f.authorizations[string(deviceCodeHash)]
	switch {
	case !ok || time.Now().After(a.expiresAt):
		delete(f.authorizations, string(deviceCodeHash))
		return devices.Device{}, auth.User{}, devices.ErrExpiredToken
	case a.status == "denied":
		delete(f.authorizations, string(deviceCodeHash))
		return devices.Device{}, auth.User{}, devices.ErrAccessDenied
	}
	tooSoon := time.Since(a.lastPoll) < devices.Interval-time.Second
	a.lastPoll = time.Now()
	switch {
	case tooSoon:
		return devices.Device{}, auth.User{}, devices.ErrSlowDown
	case a.status == "pending":
		return devices.Device{}, auth.User{}, devices.ErrAuthorizationPending
	}
	delete(f.authorizations, string(deviceCodeHash))
	// The token is known by its hash only; tests find it in the response.
	user := auth.User{ID: a.userID, Email: strings.TrimPrefix(a.userID, "user-")}
	return f.addLocked("hash:"+string(tokenHash), user, a.client), user, nil
}

// connectToken moves a device added by ExchangeDeviceCode to its token.
func (f *fakeDevices) connectToken(token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := "hash:" + string(auth.HashToken(token))
	if d, ok := f.byToken[key]; ok {
		delete(f.byToken, key)
		f.byToken[token] = d
	}
}

// expire makes every waiting authorization run out.
func (f *fakeDevices) expire() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.authorizations {
		a.expiresAt = time.Now().Add(-time.Second)
	}
}

// forgetPolls lets the next poll come at once.
func (f *fakeDevices) forgetPolls() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.authorizations {
		a.lastPoll = time.Time{}
	}
}

func (f *fakeDevices) ListDevices(_ context.Context, userID string) ([]devices.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var list []devices.Device
	for _, d := range f.byToken {
		if d.device.User.ID == userID && !d.revoked {
			list = append(list, d.info)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	return list, nil
}

func (f *fakeDevices) RevokeDevice(_ context.Context, userID, deviceID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, d := range f.byToken {
		if d.device.ID == deviceID && d.device.User.ID == userID && !d.revoked {
			d.revoked = true
			return nil
		}
	}
	return devices.ErrNotFound
}

// dropUser forgets the user's devices, as deleting the account does.
func (f *fakeDevices) dropUser(userID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for token, d := range f.byToken {
		if d.device.User.ID == userID {
			delete(f.byToken, token)
		}
	}
}

const (
	adaToken = "ksp_ada"
	bobToken = "ksp_bob"
)

func newTestServer(t *testing.T) (*httptest.Server, *fakeRepository) {
	t.Helper()
	server, repository, _ := newTestServerWith(t, Options{})
	return server, repository
}

// newTestServerWith starts a server with options (CORS for app.example.com is
// always added). Open event streams end before the server closes.
func newTestServerWith(t *testing.T, options Options) (*httptest.Server, *fakeRepository, *Handler) {
	t.Helper()
	handler, repository := newTestHandler(options)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	t.Cleanup(handler.CloseStreams) // Runs first: Close waits for active requests.
	return server, repository, handler
}

// newTestHandler serves ada's and bob's tokens, from the accounts' device
// store when the options have one.
func newTestHandler(options Options) (*Handler, *fakeRepository) {
	repository := newFakeRepository()
	known := newFakeDevices()
	if options.Accounts != nil {
		if d, ok := options.Accounts.Devices.(*fakeDevices); ok {
			known = d
		}
	}
	known.add(adaToken, auth.User{ID: "user-ada", Email: "ada@example.com"}, devices.Client{Name: "Ada's laptop", Platform: "macos"})
	known.add(bobToken, auth.User{ID: "user-bob", Email: "bob@example.com"}, devices.Client{Name: "Bob's phone", Platform: "android"})
	options.AllowedOrigins = append(options.AllowedOrigins, "https://app.example.com")
	return NewHandler(repository, known, slog.New(slog.DiscardHandler), options), repository
}

type response struct {
	status int
	header http.Header
	body   map[string]any
}

func call(t *testing.T, server *httptest.Server, method, path, token, body string) response {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, server.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	if len(data) > 0 {
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("response is not JSON: %q", data)
		}
	}
	return response{status: res.StatusCode, header: res.Header, body: decoded}
}

func errorCode(r response) string {
	e, _ := r.body["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

func TestHealthzNeedsNoToken(t *testing.T) {
	server, _ := newTestServer(t)
	if r := call(t, server, "GET", "/healthz", "", ""); r.status != http.StatusOK || r.body["status"] != "ok" {
		t.Errorf("healthz = %d %v", r.status, r.body)
	}
}

func TestAPIRequiresAValidToken(t *testing.T) {
	server, _ := newTestServer(t)
	for _, token := range []string{"", "ksp_unknown", "not-a-token"} {
		r := call(t, server, "GET", "/api/notes", token, "")
		if r.status != http.StatusUnauthorized || errorCode(r) != "unauthorized" {
			t.Errorf("token %q: %d %v", token, r.status, r.body)
		}
		if r.header.Get("WWW-Authenticate") == "" {
			t.Error("missing WWW-Authenticate header")
		}
	}
	if r := call(t, server, "GET", "/api/me", adaToken, ""); r.status != http.StatusOK || r.body["email"] != "ada@example.com" {
		t.Errorf("me = %d %v", r.status, r.body)
	}
}

func TestNoteCRUD(t *testing.T) {
	server, _ := newTestServer(t)

	r := call(t, server, "POST", "/api/notes", adaToken, `{"id":"n1","markdown":"# One"}`)
	if r.status != http.StatusCreated || r.body["revision"] != 1.0 || r.header.Get("Location") != "/api/notes/n1" {
		t.Fatalf("create = %d %v", r.status, r.body)
	}
	if r := call(t, server, "GET", "/api/notes/n1", adaToken, ""); r.status != http.StatusOK || r.body["markdown"] != "# One" {
		t.Errorf("get = %d %v", r.status, r.body)
	}
	r = call(t, server, "PUT", "/api/notes/n1", adaToken, `{"markdown":"# One, edited","base_revision":1}`)
	if r.status != http.StatusOK || r.body["revision"] != 2.0 {
		t.Errorf("update = %d %v", r.status, r.body)
	}
	r = call(t, server, "GET", "/api/notes", adaToken, "")
	if list, _ := r.body["notes"].([]any); r.status != http.StatusOK || len(list) != 1 {
		t.Errorf("list = %d %v", r.status, r.body)
	}
	if r := call(t, server, "DELETE", "/api/notes/n1?base_revision=2", adaToken, ""); r.status != http.StatusNoContent {
		t.Errorf("delete = %d %v", r.status, r.body)
	}
	if r := call(t, server, "GET", "/api/notes/n1", adaToken, ""); r.status != http.StatusNotFound {
		t.Errorf("get after delete = %d", r.status)
	}
}

func TestStaleChangesReturnTheCurrentVersion(t *testing.T) {
	server, _ := newTestServer(t)
	call(t, server, "POST", "/api/notes", adaToken, `{"id":"n1","markdown":"v1"}`)
	call(t, server, "PUT", "/api/notes/n1", adaToken, `{"markdown":"v2 from A","base_revision":1}`)

	r := call(t, server, "PUT", "/api/notes/n1", adaToken, `{"markdown":"v2 from B","base_revision":1}`)
	current, _ := r.body["current"].(map[string]any)
	if r.status != http.StatusConflict || errorCode(r) != "revision_conflict" || current["markdown"] != "v2 from A" || current["revision"] != 2.0 {
		t.Errorf("stale update = %d %v", r.status, r.body)
	}
	if r := call(t, server, "DELETE", "/api/notes/n1?base_revision=1", adaToken, ""); r.status != http.StatusConflict {
		t.Errorf("stale delete = %d", r.status)
	}
	r = call(t, server, "POST", "/api/notes", adaToken, `{"id":"n1","markdown":"x"}`)
	current, _ = r.body["current"].(map[string]any)
	if r.status != http.StatusConflict || errorCode(r) != "revision_conflict" || current["markdown"] != "v2 from A" {
		t.Errorf("duplicate create = %d %v", r.status, r.body)
	}
}

func TestDeletedNotes(t *testing.T) {
	server, _ := newTestServer(t)
	call(t, server, "POST", "/api/notes", adaToken, `{"id":"n1","markdown":"v1"}`)
	call(t, server, "DELETE", "/api/notes/n1?base_revision=1", adaToken, "")

	// Creating over a tombstone conflicts, with the tombstone as current.
	r := call(t, server, "POST", "/api/notes", adaToken, `{"id":"n1","markdown":"again"}`)
	current, _ := r.body["current"].(map[string]any)
	if r.status != http.StatusConflict || errorCode(r) != "revision_conflict" || current["revision"] != 2.0 || current["deleted_at"] == nil {
		t.Errorf("create over tombstone = %d %v", r.status, r.body)
	}
	// A stale base still conflicts.
	if r := call(t, server, "PUT", "/api/notes/n1", adaToken, `{"markdown":"stale","base_revision":1}`); r.status != http.StatusConflict || errorCode(r) != "revision_conflict" {
		t.Errorf("stale update of tombstone = %d %v", r.status, r.body)
	}
	// An edit at the tombstone's revision restores the note.
	r = call(t, server, "PUT", "/api/notes/n1", adaToken, `{"markdown":"restored","base_revision":2}`)
	if r.status != http.StatusOK || r.body["revision"] != 3.0 || r.body["deleted_at"] != nil || r.body["markdown"] != "restored" {
		t.Errorf("restore = %d %v", r.status, r.body)
	}
	if r := call(t, server, "GET", "/api/notes/n1", adaToken, ""); r.status != http.StatusOK || r.body["markdown"] != "restored" {
		t.Errorf("get after restore = %d %v", r.status, r.body)
	}
	if r := call(t, server, "PUT", "/api/notes/missing", adaToken, `{"markdown":"x","base_revision":1}`); r.status != http.StatusNotFound {
		t.Errorf("update of missing note = %d", r.status)
	}
}

func TestNotesAreScopedToTheUser(t *testing.T) {
	server, _ := newTestServer(t)
	call(t, server, "POST", "/api/notes", adaToken, `{"id":"n1","markdown":"Ada's"}`)

	if r := call(t, server, "GET", "/api/notes/n1", bobToken, ""); r.status != http.StatusNotFound {
		t.Errorf("Bob got Ada's note: %d %v", r.status, r.body)
	}
	if r := call(t, server, "PUT", "/api/notes/n1", bobToken, `{"markdown":"x","base_revision":1}`); r.status != http.StatusNotFound {
		t.Errorf("Bob updated Ada's note: %d", r.status)
	}
}

func TestRejectsInvalidRequests(t *testing.T) {
	server, _ := newTestServer(t)
	cases := []struct {
		name, method, path, body, code string
		status                         int
	}{
		{"unknown field", "POST", "/api/notes", `{"id":"n1","markdown":"x","extra":1}`, "invalid_json", 400},
		{"missing markdown", "POST", "/api/notes", `{"id":"n1"}`, "invalid_request", 400},
		{"bad id", "POST", "/api/notes", `{"id":"no spaces","markdown":"x"}`, "invalid_id", 400},
		{"trailing data", "POST", "/api/notes", `{"id":"n1","markdown":"x"} {}`, "invalid_json", 400},
		{"not JSON", "POST", "/api/notes", `markdown`, "invalid_json", 400},
		{"missing base revision", "PUT", "/api/notes/n1", `{"markdown":"x"}`, "invalid_request", 400},
		{"delete without revision", "DELETE", "/api/notes/n1", "", "invalid_request", 400},
		{"unknown endpoint", "GET", "/api/nothing", "", "not_found", 404},
	}
	for _, c := range cases {
		r := call(t, server, c.method, c.path, adaToken, c.body)
		if r.status != c.status || errorCode(r) != c.code {
			t.Errorf("%s: %d %v, want %d %s", c.name, r.status, r.body, c.status, c.code)
		}
	}
}

func TestRequiresJSONContentType(t *testing.T) {
	server, _ := newTestServer(t)
	req, _ := http.NewRequest("POST", server.URL+"/api/notes", strings.NewReader(`{"id":"n1","markdown":"x"}`))
	req.Header.Set("Authorization", "Bearer "+adaToken)
	req.Header.Set("Content-Type", "text/plain")
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnsupportedMediaType {
		t.Errorf("status = %d, want 415", res.StatusCode)
	}
}

func TestRejectsOversizedBodies(t *testing.T) {
	server, _ := newTestServer(t)
	body := `{"id":"n1","markdown":"` + strings.Repeat("a", maxBodyBytes) + `"}`
	if r := call(t, server, "POST", "/api/notes", adaToken, body); r.status != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", r.status)
	}
}

func TestHidesInternalErrors(t *testing.T) {
	server, repository := newTestServer(t)
	repository.fail = io.ErrUnexpectedEOF
	r := call(t, server, "GET", "/api/notes", adaToken, "")
	if r.status != http.StatusInternalServerError || errorCode(r) != "internal" {
		t.Errorf("status = %d %v", r.status, r.body)
	}
	if msg, _ := r.body["error"].(map[string]any)["message"].(string); strings.Contains(msg, "EOF") {
		t.Errorf("internal error leaked: %q", msg)
	}
}

func TestSyncReturnsChangesSinceACursor(t *testing.T) {
	server, _ := newTestServer(t)
	call(t, server, "POST", "/api/notes", adaToken, `{"id":"a","markdown":"A"}`)
	call(t, server, "POST", "/api/notes", adaToken, `{"id":"b","markdown":"B"}`)
	call(t, server, "POST", "/api/notes", bobToken, `{"id":"bob","markdown":"not Ada's"}`)

	first := call(t, server, "GET", "/api/sync?limit=1", adaToken, "")
	firstNotes, _ := first.body["notes"].([]any)
	if first.status != http.StatusOK || len(firstNotes) != 1 || first.body["more"] != true {
		t.Fatalf("first page = %d %v", first.status, first.body)
	}
	cursor := int(first.body["cursor"].(float64))

	call(t, server, "DELETE", "/api/notes/a?base_revision=1", adaToken, "")
	rest := call(t, server, "GET", "/api/sync?since="+strconv.Itoa(cursor), adaToken, "")
	restNotes, _ := rest.body["notes"].([]any)
	if len(restNotes) != 2 || rest.body["more"] != false {
		t.Fatalf("rest = %v", rest.body)
	}
	deleted := restNotes[1].(map[string]any)
	if deleted["id"] != "a" || deleted["deleted_at"] == nil {
		t.Errorf("deleted note not reported as a tombstone: %v", deleted)
	}

	for _, query := range []string{"since=-1", "since=x", "limit=0", "limit=100000"} {
		if r := call(t, server, "GET", "/api/sync?"+query, adaToken, ""); r.status != http.StatusBadRequest {
			t.Errorf("%s: status %d", query, r.status)
		}
	}
}

func TestCORSAllowsConfiguredOriginsOnly(t *testing.T) {
	server, _ := newTestServer(t)
	preflight := func(origin string) *http.Response {
		req, _ := http.NewRequest(http.MethodOptions, server.URL+"/api/notes", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", "PUT")
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res
	}

	allowed := preflight("https://app.example.com")
	if allowed.StatusCode != http.StatusNoContent || allowed.Header.Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Errorf("allowed preflight = %d %v", allowed.StatusCode, allowed.Header)
	}
	if !strings.Contains(allowed.Header.Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Error("preflight does not allow the Authorization header")
	}
	if other := preflight("https://evil.example"); other.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("unknown origin allowed: %v", other.Header)
	}
}

func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	server, _ := newTestServer(t)
	for _, path := range []string{"/healthz", "/api/notes", "/api/nothing"} {
		r := call(t, server, "GET", path, adaToken, "")
		for header, want := range map[string]string{
			"X-Content-Type-Options":  "nosniff",
			"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
			"Referrer-Policy":         "no-referrer",
			"Cache-Control":           "no-store",
		} {
			if got := r.header.Get(header); got != want {
				t.Errorf("%s %s = %q, want %q", path, header, got, want)
			}
		}
	}
}

func TestRevokingTheCurrentToken(t *testing.T) {
	server, _ := newTestServer(t)
	if r := call(t, server, "DELETE", "/api/tokens/current", bobToken, ""); r.status != http.StatusNoContent {
		t.Fatalf("revoke = %d %v", r.status, r.body)
	}
	if r := call(t, server, "GET", "/api/me", bobToken, ""); r.status != http.StatusUnauthorized {
		t.Errorf("revoked token still works: %d", r.status)
	}
	if r := call(t, server, "GET", "/api/me", adaToken, ""); r.status != http.StatusOK {
		t.Errorf("another user's token was affected: %d", r.status)
	}
}

func TestRepeatedAuthFailuresAreRateLimited(t *testing.T) {
	server, _ := newTestServer(t)
	for i := 0; i < authFailuresPerMinute; i++ {
		if r := call(t, server, "GET", "/api/me", "ksp_wrong", ""); r.status != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, r.status)
		}
	}
	r := call(t, server, "GET", "/api/me", adaToken, "")
	if r.status != http.StatusTooManyRequests || errorCode(r) != "rate_limited" || r.header.Get("Retry-After") == "" {
		t.Errorf("after %d failures: %d %v", authFailuresPerMinute, r.status, r.body)
	}
}

func TestFailureLimiterWindow(t *testing.T) {
	now := time.Date(2026, 9, 28, 10, 0, 0, 0, time.UTC)
	limiter := newWindowLimiter(2, time.Minute, func() time.Time { return now })
	limiter.record("a")
	if _, blocked := limiter.blocked("a"); blocked {
		t.Error("blocked after one failure")
	}
	limiter.record("a")
	if retry, blocked := limiter.blocked("a"); !blocked || retry != time.Minute {
		t.Errorf("blocked = %v, retry = %v", blocked, retry)
	}
	if _, blocked := limiter.blocked("b"); blocked {
		t.Error("another client was blocked")
	}
	now = now.Add(time.Minute)
	if _, blocked := limiter.blocked("a"); blocked {
		t.Error("still blocked after the window")
	}
}
