package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"konspecter/server/internal/devices"
	"konspecter/server/internal/entitlements"
)

// fakeEntitlements keeps entitlements in memory as the PostgreSQL storage
// does: the highest version wins. Recipients are the fake accounts' users.
type fakeEntitlements struct {
	mu       sync.Mutex
	kept     map[string]entitlements.Entitlement
	accounts *fakeAccounts
}

func (f *fakeEntitlements) Entitlement(_ context.Context, userID string) (entitlements.Entitlement, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e, ok := f.kept[userID]
	if !ok {
		return entitlements.Entitlement{}, entitlements.ErrNone
	}
	return e, nil
}

func (f *fakeEntitlements) PutEntitlement(_ context.Context, e entitlements.Entitlement) (bool, error) {
	f.accounts.mu.Lock()
	_, err := f.accounts.byID(e.UserID)
	f.accounts.mu.Unlock()
	if err != nil {
		return false, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if old, ok := f.kept[e.UserID]; ok && old.Version >= e.Version {
		return false, nil
	}
	f.kept[e.UserID] = e
	return true, nil
}

func (f *fakeEntitlements) Recipient(_ context.Context, userID string) (string, string, error) {
	f.accounts.mu.Lock()
	defer f.accounts.mu.Unlock()
	u, err := f.accounts.byID(userID)
	if err != nil {
		return "", "", err
	}
	locale := f.accounts.locales[userID]
	if locale == "" {
		locale = "en"
	}
	return u.user.Email, locale, nil
}

// fakeService is the billing service: it answers the entitlement the test
// sets for a user (expired, with no time, if none), starts a trial when
// asked to, and records every other request with a canned answer.
type fakeService struct {
	mu           sync.Mutex
	server       *httptest.Server
	version      int64
	entitlements map[string]fakeGrant
	trial        time.Duration
	trials       int
	asked        []string
	forget       int
	requests     []*http.Request
	bodies       []string
	answer       string
	down         bool
	clock        *time.Time
}

type fakeGrant struct {
	status entitlements.Status
	until  *time.Time
}

func newFakeService(t *testing.T, clock *time.Time) *fakeService {
	f := &fakeService{entitlements: map[string]fakeGrant{}, forget: http.StatusNoContent, answer: `{"ok":true}`, clock: clock}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeService) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+billingToken {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/internal/entitlements/"):
		user := strings.TrimPrefix(r.URL.Path, "/internal/entitlements/")
		f.asked = append(f.asked, r.URL.RequestURI())
		grant, ok := f.entitlements[user]
		if !ok {
			grant = fakeGrant{status: entitlements.Expired}
		}
		if r.URL.Query().Get("start_trial") == "1" && !ok && f.trial > 0 {
			until := f.clock.Add(f.trial)
			grant = fakeGrant{status: entitlements.Trialing, until: &until}
			f.entitlements[user] = grant
			f.trials++
		}
		f.version++
		writeJSON(w, http.StatusOK, map[string]any{"user_id": user, "status": grant.status, "until": grant.until, "version": f.version})
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/internal/users/"):
		w.WriteHeader(f.forget)
	default:
		body, _ := io.ReadAll(r.Body)
		f.requests = append(f.requests, r.Clone(context.Background()))
		f.bodies = append(f.bodies, string(body))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(f.answer))
	}
}

func (f *fakeService) grant(user string, status entitlements.Status, until *time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entitlements[user] = fakeGrant{status: status, until: until}
}

func (f *fakeService) last(t *testing.T) (*http.Request, string) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.requests) == 0 {
		t.Fatal("nothing was passed on")
	}
	return f.requests[len(f.requests)-1], f.bodies[len(f.bodies)-1]
}

func (f *fakeService) askedCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.asked)
}

const billingToken = "a-token-the-server-and-the-service-share"

type billingSetup struct {
	accountSetup
	handler *Handler
	kept    *fakeEntitlements
	service *fakeService
	clock   *time.Time
}

func newBillingServer(t *testing.T) billingSetup {
	t.Helper()
	store, mailer, known := newFakeAccounts(), &fakeMailer{}, newFakeDevices()
	store.deleted = known.dropUser
	clock := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	config := Accounts{
		Store: store, Devices: known, Mailer: mailer, PublicURL: site, RegistrationOpen: true,
		SessionTTL: 24 * time.Hour, EmailCodeTTL: 10 * time.Minute, PasswordResetTTL: 30 * time.Minute, DeviceCodeTTL: 10 * time.Minute,
		Rates: Rates{LoginFailuresPerIP: 100, LoginFailuresPerEmail: 100, EmailsPerAddress: 100, EmailsPerIP: 100, DeviceRequestsPerIP: 100},
	}
	service := newFakeService(t, &clock)
	kept := &fakeEntitlements{kept: map[string]entitlements.Entitlement{}, accounts: store}
	server, _, handler := newTestServerWith(t, Options{
		Accounts: &config, Billing: &Billing{URL: service.server.URL, Token: billingToken, Store: kept},
		now: func() time.Time { return clock },
	})
	return billingSetup{
		accountSetup: accountSetup{server: server, store: store, mailer: mailer, devices: known},
		handler:      handler, kept: kept, service: service, clock: &clock,
	}
}

const annID = "user-ann@example.com"

// ann signs Ann in on the site and connects an app (token ksp_ann).
func (s billingSetup) ann(t *testing.T) *http.Cookie {
	t.Helper()
	session := signedIn(t, s.accountSetup, "ann@example.com")
	s.devices.add("ksp_ann", s.store.users["ann@example.com"].user, devices.Client{Name: "Ann's laptop", Platform: "macos"})
	return session
}

// push is the billing service telling of Ann's entitlement.
func (s billingSetup) push(t *testing.T, token string, body map[string]any) response {
	t.Helper()
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPut, s.server.URL+"/internal/entitlements/"+annID, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	return send(t, req)
}

func send(t *testing.T, req *http.Request) response {
	t.Helper()
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var decoded map[string]any
	_ = json.NewDecoder(res.Body).Decode(&decoded)
	return response{status: res.StatusCode, header: res.Header, body: decoded}
}

func syncState(t *testing.T, r response) string {
	t.Helper()
	state, _ := r.body["sync"].(map[string]any)["state"].(string)
	return state
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func TestSyncIsFreeWithoutABillingService(t *testing.T) {
	server, _ := newTestServer(t)
	if r := call(t, server, "GET", "/api/notes", adaToken, ""); r.status != http.StatusOK {
		t.Errorf("notes = %d %v", r.status, r.body)
	}
	if r := call(t, server, "GET", "/api/me", adaToken, ""); syncState(t, r) != "free" {
		t.Errorf("me = %v", r.body)
	}
	if r := call(t, server, "GET", "/api/billing/plans", "", ""); r.body["paid"] != false {
		t.Errorf("plans = %v", r.body)
	}
	if r := call(t, server, "POST", "/api/billing/webhooks/acme", "", "{}"); r.status != http.StatusNotFound || errorCode(r) != "billing_off" {
		t.Errorf("webhook = %d %v", r.status, r.body)
	}
	req, _ := http.NewRequest(http.MethodPut, server.URL+"/internal/entitlements/user-ada", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+billingToken)
	if r := send(t, req); r.status != http.StatusNotFound {
		t.Errorf("internal = %d", r.status)
	}

	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	r := siteCall(t, s.server.URL, http.MethodGet, "/api/subscription", session, nil)
	if r.status != http.StatusOK || r.body["paid"] != false || r.body["access"].(map[string]any)["state"] != "free" {
		t.Errorf("subscription = %d %v", r.status, r.body)
	}
	if r := siteCall(t, s.server.URL, http.MethodPost, "/api/subscription/cancel", session, nil); errorCode(r) != "billing_off" {
		t.Errorf("cancel = %v", r.body)
	}
}

func TestAccountsWithoutTimeCannotSync(t *testing.T) {
	s := newBillingServer(t)
	s.ann(t)
	for _, path := range []string{"/api/notes", "/api/sync", "/api/events"} {
		r := call(t, s.server, "GET", path, "ksp_ann", "")
		if r.status != http.StatusPaymentRequired || errorCode(r) != "subscription_required" {
			t.Errorf("%s = %d %v", path, r.status, r.body)
		}
	}
	if r := call(t, s.server, "POST", "/api/notes", "ksp_ann", noteBody("n1", "hi")); r.status != http.StatusPaymentRequired {
		t.Errorf("create = %d", r.status)
	}
	// Who the account is, and that it needs paying, is always there.
	r := call(t, s.server, "GET", "/api/me", "ksp_ann", "")
	if r.status != http.StatusOK || syncState(t, r) != "expired" || r.body["sync"].(map[string]any)["until"] != nil {
		t.Errorf("me = %d %v", r.status, r.body)
	}
	// Disconnecting still works.
	if r := call(t, s.server, "DELETE", "/api/tokens/current", "ksp_ann", ""); r.status != http.StatusNoContent {
		t.Errorf("revoke = %d", r.status)
	}
}

func TestTheFirstSyncStartsTheTrial(t *testing.T) {
	s := newBillingServer(t)
	s.service.trial = 14 * 24 * time.Hour
	s.ann(t)
	if r := call(t, s.server, "GET", "/api/me", "ksp_ann", ""); syncState(t, r) != "expired" {
		t.Errorf("before syncing: %v", r.body)
	}
	if r := call(t, s.server, "GET", "/api/sync", "ksp_ann", ""); r.status != http.StatusOK {
		t.Fatalf("sync = %d %v", r.status, r.body)
	}
	r := call(t, s.server, "GET", "/api/me", "ksp_ann", "")
	if syncState(t, r) != "trialing" || r.body["sync"].(map[string]any)["until"] != "2026-10-20T12:00:00Z" {
		t.Errorf("me = %v", r.body)
	}
	if s.service.trials != 1 || strings.Join(s.service.asked, " ") != "/internal/entitlements/"+annID+" /internal/entitlements/"+annID+"?start_trial=1" {
		t.Errorf("asked = %v, trials = %d", s.service.asked, s.service.trials)
	}
	// Syncing on asks nothing more.
	call(t, s.server, "GET", "/api/notes", "ksp_ann", "")
	if s.service.askedCount() != 2 {
		t.Errorf("asked again: %v", s.service.asked)
	}

	// The trial is over: the server stops sync by itself, and asks once
	// what came next.
	*s.clock = s.clock.Add(15 * 24 * time.Hour)
	s.service.grant(annID, entitlements.Expired, nil)
	if r := call(t, s.server, "GET", "/api/sync", "ksp_ann", ""); r.status != http.StatusPaymentRequired {
		t.Errorf("after the trial = %d", r.status)
	}
	if s.service.trials != 1 {
		t.Errorf("a second trial: %d", s.service.trials)
	}
}

func TestTheServerStopsSyncOnTimeAndAsksOnceAMinute(t *testing.T) {
	s := newBillingServer(t)
	s.ann(t)
	until := s.clock.Add(time.Hour)
	s.service.grant(annID, entitlements.Active, &until)
	if r := call(t, s.server, "GET", "/api/notes", "ksp_ann", ""); r.status != http.StatusOK {
		t.Fatalf("paid = %d", r.status)
	}
	// The time runs out and no word comes: sync stops, the service is asked
	// at most once a minute, and its silence keeps sync stopped.
	*s.clock = until
	s.service.down = true
	for range 3 {
		if r := call(t, s.server, "GET", "/api/notes", "ksp_ann", ""); r.status != http.StatusPaymentRequired {
			t.Errorf("after the time = %d", r.status)
		}
	}
	s.service.down = false
	renewed := until.AddDate(0, 1, 0)
	s.service.grant(annID, entitlements.Active, &renewed)
	if r := call(t, s.server, "GET", "/api/notes", "ksp_ann", ""); r.status != http.StatusPaymentRequired {
		t.Errorf("asked again within the minute = %d", r.status)
	}
	*s.clock = s.clock.Add(time.Minute)
	if r := call(t, s.server, "GET", "/api/notes", "ksp_ann", ""); r.status != http.StatusOK {
		t.Errorf("after the renewal = %d", r.status)
	}
	if n := s.service.askedCount(); n != 2 {
		t.Errorf("asked %d times: %v", n, s.service.asked)
	}
}

func TestWithoutWordFromTheBillingServiceSyncWaits(t *testing.T) {
	s := newBillingServer(t)
	s.ann(t)
	s.service.down = true
	r := call(t, s.server, "GET", "/api/notes", "ksp_ann", "")
	if r.status != http.StatusServiceUnavailable || errorCode(r) != "billing_unavailable" {
		t.Errorf("notes = %d %v", r.status, r.body)
	}
	if r := call(t, s.server, "GET", "/api/me", "ksp_ann", ""); r.status != http.StatusOK || r.body["sync"] != nil {
		t.Errorf("me = %d %v", r.status, r.body)
	}
}

func TestTheBillingServicePushesEntitlements(t *testing.T) {
	s := newBillingServer(t)
	s.ann(t)
	until := s.clock.Add(30 * 24 * time.Hour)
	for _, token := range []string{"", "wrong"} {
		if r := s.push(t, token, map[string]any{"status": "active", "until": stamp(until), "version": 5}); r.status != http.StatusUnauthorized {
			t.Errorf("with %q = %d", token, r.status)
		}
	}
	for _, bad := range []map[string]any{
		{"status": "paused", "until": stamp(until), "version": 5},
		{"status": "active", "version": 5},
		{"status": "active", "until": stamp(until)},
	} {
		if r := s.push(t, billingToken, bad); r.status != http.StatusBadRequest || errorCode(r) != "invalid_entitlement" {
			t.Errorf("%v = %d %v", bad, r.status, r.body)
		}
	}
	if r := s.push(t, billingToken, map[string]any{"status": "active", "until": stamp(until), "version": 5}); r.status != http.StatusOK || r.body["stored"] != true {
		t.Fatalf("push = %d %v", r.status, r.body)
	}
	if r := call(t, s.server, "GET", "/api/notes", "ksp_ann", ""); r.status != http.StatusOK {
		t.Errorf("after the push = %d", r.status)
	}
	if s.service.askedCount() != 0 {
		t.Errorf("asked although told: %v", s.service.asked)
	}

	// An older one changes nothing; a newer expired one ends the streams.
	if r := s.push(t, billingToken, map[string]any{"status": "expired", "until": nil, "version": 4}); r.body["stored"] != false {
		t.Errorf("older = %v", r.body)
	}
	stream := openStream(t, s.server, "ksp_ann")
	if r := s.push(t, billingToken, map[string]any{"status": "expired", "until": nil, "version": 6}); r.body["stored"] != true {
		t.Errorf("newer = %v", r.body)
	}
	if !stream.ends() {
		t.Error("the stream did not end")
	}
	if r := call(t, s.server, "GET", "/api/me", "ksp_ann", ""); syncState(t, r) != "expired" {
		t.Errorf("me = %v", r.body)
	}

	req, _ := http.NewRequest(http.MethodPut, s.server.URL+"/internal/entitlements/user-nobody", strings.NewReader(`{"status":"expired","version":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+billingToken)
	if r := send(t, req); r.status != http.StatusNotFound || errorCode(r) != "unknown_user" {
		t.Errorf("unknown user = %d %v", r.status, r.body)
	}
}

func TestBillingNoticesAreEmailedInTheAccountsLanguage(t *testing.T) {
	s := newBillingServer(t)
	s.ann(t)
	if err := s.store.SetLocale(context.Background(), annID, "ru"); err != nil {
		t.Fatal(err)
	}
	notice := func(user, body string) response {
		req, _ := http.NewRequest(http.MethodPost, s.server.URL+"/internal/users/"+user+"/notices", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+billingToken)
		return send(t, req)
	}
	r := notice(annID, `{"id":"e1","kind":"renewed","amount":"299.00","currency":"RUB","period":"1m","gateway":"acme","until":"2026-11-06T12:00:00Z"}`)
	if r.status != http.StatusOK {
		t.Fatalf("notice = %d %v", r.status, r.body)
	}
	m := s.mailer.last(t)
	if m.To != "ann@example.com" || !strings.Contains(m.Subject, "Konspecter") || !strings.Contains(m.Text, "299 ₽") || !strings.Contains(m.Text, "6 ноября 2026") {
		t.Errorf("email = %q %q", m.Subject, m.Text)
	}
	if r := notice(annID, `{"id":"e2","kind":"cancelled"}`); r.status != http.StatusBadRequest || errorCode(r) != "unknown_kind" {
		t.Errorf("unknown kind = %d %v", r.status, r.body)
	}
	if r := notice("user-nobody", `{"id":"e3","kind":"paused"}`); r.status != http.StatusNotFound || errorCode(r) != "unknown_user" {
		t.Errorf("unknown user = %d %v", r.status, r.body)
	}
}

func TestSiteRequestsArePassedOnAsTheSignedInUser(t *testing.T) {
	s := newBillingServer(t)
	session := s.ann(t)
	s.service.answer = `{"id":"sub-1","redirect_url":"https://pay.example/1"}`
	until := s.clock.AddDate(0, 1, 0)
	s.service.grant(annID, entitlements.Active, &until) // paid as the site subscribes

	req, _ := http.NewRequest(http.MethodPost, s.server.URL+"/api/subscription", strings.NewReader(`{"gateway":"acme","period":"1m","accept":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", site)
	req.Header.Set("X-Konspecter-User-Id", "user-bob") // not Ann's to say
	req.AddCookie(session)
	r := send(t, req)
	if r.status != http.StatusCreated || r.body["redirect_url"] != "https://pay.example/1" {
		t.Fatalf("subscribe = %d %v", r.status, r.body)
	}
	passed, body := s.service.last(t)
	if passed.Method != http.MethodPost || passed.URL.Path != "/api/subscription" || body != `{"gateway":"acme","period":"1m","accept":true}` {
		t.Errorf("passed on %s %s %q", passed.Method, passed.URL.Path, body)
	}
	if passed.Header.Get("X-Konspecter-User-Id") != annID || passed.Header.Get("X-Konspecter-User-Email") != "ann@example.com" ||
		passed.Header.Get("Authorization") != "Bearer "+billingToken || passed.Header.Get("Cookie") != "" {
		t.Errorf("headers = %v", passed.Header)
	}
	// The entitlement was asked again: the app may sync at once.
	if r := call(t, s.server, "GET", "/api/notes", "ksp_ann", ""); r.status != http.StatusOK {
		t.Errorf("sync after paying = %d", r.status)
	}

	// Signed-out requests are not passed on.
	if r := siteCall(t, s.server.URL, http.MethodGet, "/api/subscription", nil, nil); r.status != http.StatusUnauthorized {
		t.Errorf("signed out = %d", r.status)
	}
	s.service.down = true
	if r := siteCall(t, s.server.URL, http.MethodGet, "/api/subscription/checkouts/sub-1", session, nil); r.status != http.StatusServiceUnavailable {
		t.Errorf("service down = %d %v", r.status, r.body)
	}
}

func TestPlansAndWebhooksArePassedOnAsTheyCame(t *testing.T) {
	s := newBillingServer(t)
	r := call(t, s.server, "GET", "/api/billing/plans?locale=ru", "", "")
	passed, _ := s.service.last(t)
	if r.status != http.StatusCreated || passed.URL.RequestURI() != "/api/billing/plans?locale=ru" || passed.Header.Get("X-Konspecter-User-Id") != "" {
		t.Errorf("plans = %d, passed on %s %v", r.status, passed.URL.RequestURI(), passed.Header)
	}

	req, _ := http.NewRequest(http.MethodPost, s.server.URL+"/api/billing/webhooks/acme", strings.NewReader(`{"event":"payment.completed"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Webhook-Signature", "signed")
	req.Header.Set("X-Konspecter-User-Id", annID)
	send(t, req)
	passed, body := s.service.last(t)
	if passed.URL.Path != "/api/billing/webhooks/acme" || body != `{"event":"payment.completed"}` ||
		passed.Header.Get("Webhook-Signature") != "signed" || passed.Header.Get("X-Konspecter-User-Id") != "" {
		t.Errorf("webhook passed on as %s %q %v", passed.URL.Path, body, passed.Header)
	}
}

func TestDeletingTheAccountHasTheBillingServiceForgetItFirst(t *testing.T) {
	s := newBillingServer(t)
	session := s.ann(t)
	for status, code := range map[int]string{http.StatusBadGateway: "gateway_failed", http.StatusInternalServerError: "billing_unavailable"} {
		s.service.forget = status
		r := siteCall(t, s.server.URL, http.MethodDelete, "/api/account", session, map[string]any{"email": "ann@example.com"})
		if r.status != http.StatusBadGateway || errorCode(r) != code {
			t.Errorf("delete with the service answering %d = %d %v", status, r.status, r.body)
		}
		if _, ok := s.store.users["ann@example.com"]; !ok {
			t.Fatal("the account is gone")
		}
	}
	s.service.forget = http.StatusNoContent
	if r := siteCall(t, s.server.URL, http.MethodDelete, "/api/account", session, map[string]any{"email": "ann@example.com"}); r.status != http.StatusNoContent {
		t.Errorf("delete = %d %v", r.status, r.body)
	}
}

func TestTheAccountKeepsItsLanguage(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	b := newBrowser(t, s.server)
	req, _ := http.NewRequest(http.MethodPost, s.server.URL+"/api/auth/login",
		strings.NewReader(`{"email":"ann@example.com","password":"secret password"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", site)
	req.Header.Set("Accept-Language", "de-DE, ru;q=0.8")
	if r := b.do(req); r.status != http.StatusOK {
		t.Fatalf("login = %d", r.status)
	}
	if got := s.store.locale(annID); got != "ru" {
		t.Errorf("locale after sign-in = %q", got)
	}
	session := b.cookie("__Host-ksp_session")
	r := siteCall(t, s.server.URL, http.MethodPatch, "/api/account", session, map[string]any{"locale": "en"})
	if r.status != http.StatusOK || s.store.locale(annID) != "en" || r.body["email"] != "ann@example.com" {
		t.Errorf("set locale = %d %v, %q", r.status, r.body, s.store.locale(annID))
	}
	if r := siteCall(t, s.server.URL, http.MethodPatch, "/api/account", session, map[string]any{"locale": "de"}); r.status != http.StatusBadRequest {
		t.Errorf("unknown locale = %d", r.status)
	}
}
