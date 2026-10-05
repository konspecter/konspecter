package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
	"konspecter/server/internal/mail"
)

// fakeAccounts mirrors the PostgreSQL account rules in memory.
type fakeAccounts struct {
	mu       sync.Mutex
	users    map[string]*fakeUser // by email
	codes    map[string]*fakeCode // newest open code by email
	resets   map[string]string    // token hash → user email
	sessions map[string]*auth.Session
	links    map[string]string            // provider + "/" + subject → user email
	pending  map[string]accounts.Identity // token hash → identity
}

type fakeUser struct {
	user         auth.User
	passwordHash string
}

type fakeCode struct {
	hash         []byte
	passwordHash string
	identity     accounts.Identity
	attempts     int
	expiresAt    time.Time
}

func newFakeAccounts() *fakeAccounts {
	return &fakeAccounts{
		users: map[string]*fakeUser{}, codes: map[string]*fakeCode{},
		resets: map[string]string{}, sessions: map[string]*auth.Session{},
		links: map[string]string{}, pending: map[string]accounts.Identity{},
	}
}

func (f *fakeAccounts) addUser(email, password string) auth.User {
	f.mu.Lock()
	defer f.mu.Unlock()
	hash := ""
	if password != "" {
		hash, _ = accounts.HashPassword(password)
	}
	u := &fakeUser{user: auth.User{ID: "user-" + email, Email: email}, passwordHash: hash}
	f.users[email] = u
	return u.user
}

func (f *fakeAccounts) StartEmailCode(_ context.Context, email string, codeHash []byte, passwordHash string, identity accounts.Identity, expiresAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.codes[email] = &fakeCode{hash: codeHash, passwordHash: passwordHash, identity: identity, expiresAt: expiresAt}
	return nil
}

func (f *fakeAccounts) VerifyEmailCode(_ context.Context, email string, codeHash []byte, createAllowed bool) (auth.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.codes[email]
	if !ok || time.Now().After(c.expiresAt) || c.attempts >= accounts.MaxCodeAttempts {
		return auth.User{}, accounts.ErrInvalidCode
	}
	if subtle.ConstantTimeCompare(c.hash, codeHash) != 1 {
		c.attempts++
		return auth.User{}, accounts.ErrInvalidCode
	}
	delete(f.codes, email)
	u, ok := f.users[email]
	if !ok {
		if !createAllowed {
			return auth.User{}, accounts.ErrRegistrationClosed
		}
		u = &fakeUser{user: auth.User{ID: "user-" + email, Email: email}}
		f.users[email] = u
	}
	if c.passwordHash != "" {
		u.passwordHash = c.passwordHash
	}
	if c.identity.Provider != "" {
		f.link(c.identity, email)
	}
	return u.user, nil
}

func (f *fakeAccounts) link(identity accounts.Identity, email string) {
	key := identity.Provider + "/" + identity.Subject
	if _, ok := f.links[key]; !ok {
		f.links[key] = email
	}
	for hash, p := range f.pending {
		if p.Provider == identity.Provider && p.Subject == identity.Subject {
			delete(f.pending, hash)
		}
	}
}

func (f *fakeAccounts) SignInWithIdentity(_ context.Context, identity accounts.Identity, createAllowed bool) (auth.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if email, ok := f.links[identity.Provider+"/"+identity.Subject]; ok {
		return f.users[email].user, nil
	}
	if !identity.EmailVerified || identity.Email == "" {
		return auth.User{}, accounts.ErrEmailRequired
	}
	u, ok := f.users[identity.Email]
	if !ok {
		if !createAllowed {
			return auth.User{}, accounts.ErrRegistrationClosed
		}
		u = &fakeUser{user: auth.User{ID: "user-" + identity.Email, Email: identity.Email}}
		f.users[identity.Email] = u
	}
	f.link(identity, identity.Email)
	return u.user, nil
}

func (f *fakeAccounts) CreatePendingIdentity(_ context.Context, tokenHash []byte, identity accounts.Identity, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pending[string(tokenHash)] = identity
	return nil
}

func (f *fakeAccounts) PendingIdentity(_ context.Context, tokenHash []byte) (accounts.Identity, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	identity, ok := f.pending[string(tokenHash)]
	if !ok {
		return accounts.Identity{}, accounts.ErrIdentityExpired
	}
	return identity, nil
}

func (f *fakeAccounts) PasswordHash(_ context.Context, email string) (auth.User, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u, ok := f.users[email]
	if !ok {
		return auth.User{}, "", auth.ErrUserNotFound
	}
	return u.user, u.passwordHash, nil
}

func (f *fakeAccounts) CreatePasswordReset(_ context.Context, userID string, tokenHash []byte, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for email, u := range f.users {
		if u.user.ID == userID {
			f.resets[string(tokenHash)] = email
		}
	}
	return nil
}

func (f *fakeAccounts) ResetPassword(_ context.Context, tokenHash []byte, passwordHash string) (auth.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	email, ok := f.resets[string(tokenHash)]
	if !ok {
		return auth.User{}, accounts.ErrInvalidResetToken
	}
	delete(f.resets, string(tokenHash))
	u := f.users[email]
	u.passwordHash = passwordHash
	for id, s := range f.sessions {
		if s.User.ID == u.user.ID {
			delete(f.sessions, id)
		}
	}
	return u.user, nil
}

func (f *fakeAccounts) CreateSession(_ context.Context, userID string, idHash []byte, _ string, expiresAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, u := range f.users {
		if u.user.ID == userID {
			f.sessions[string(idHash)] = &auth.Session{User: u.user, LastSeenAt: time.Now(), ExpiresAt: expiresAt}
		}
	}
	return nil
}

func (f *fakeAccounts) SessionByID(_ context.Context, idHash []byte) (auth.Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.sessions[string(idHash)]
	if !ok || time.Now().After(s.ExpiresAt) {
		return auth.Session{}, auth.ErrUnauthorized
	}
	return *s, nil
}

func (f *fakeAccounts) ExtendSession(_ context.Context, idHash []byte, expiresAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if s, ok := f.sessions[string(idHash)]; ok {
		s.LastSeenAt, s.ExpiresAt = time.Now(), expiresAt
	}
	return nil
}

func (f *fakeAccounts) DeleteSession(_ context.Context, idHash []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.sessions, string(idHash))
	return nil
}

// fakeMailer keeps sent messages.
type fakeMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

func (m *fakeMailer) last(t *testing.T) mail.Message {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		t.Fatal("no email was sent")
	}
	return m.sent[len(m.sent)-1]
}

const site = "https://notes.example.com"

type accountSetup struct {
	server *httptest.Server
	store  *fakeAccounts
	mailer *fakeMailer
}

func newAccountServer(t *testing.T, change func(*Accounts)) accountSetup {
	t.Helper()
	store, mailer := newFakeAccounts(), &fakeMailer{}
	config := Accounts{
		Store: store, Mailer: mailer, PublicURL: site, RegistrationOpen: true,
		SessionTTL: 24 * time.Hour, EmailCodeTTL: 10 * time.Minute, PasswordResetTTL: 30 * time.Minute,
		Rates: Rates{LoginFailuresPerIP: 100, LoginFailuresPerEmail: 100, EmailsPerAddress: 100, EmailsPerIP: 100},
	}
	if change != nil {
		change(&config)
	}
	server, _, _ := newTestServerWith(t, Options{Accounts: &config})
	return accountSetup{server: server, store: store, mailer: mailer}
}

// browser is a site visitor: it keeps cookies and sends the site's Origin.
type browser struct {
	t      *testing.T
	server *httptest.Server
	client *http.Client
	origin string
}

func newBrowser(t *testing.T, server *httptest.Server) *browser {
	jar, _ := cookiejar.New(nil)
	client := *server.Client()
	client.Jar = jar
	return &browser{t: t, server: server, client: &client, origin: site}
}

func (b *browser) post(path string, body any) response {
	b.t.Helper()
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, b.server.URL+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	if b.origin != "" {
		req.Header.Set("Origin", b.origin)
	}
	return b.do(req)
}

func (b *browser) get(path string) response {
	b.t.Helper()
	req, _ := http.NewRequest(http.MethodGet, b.server.URL+path, nil)
	return b.do(req)
}

func (b *browser) do(req *http.Request) response {
	b.t.Helper()
	res, err := b.client.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	if len(data) > 0 {
		_ = json.Unmarshal(data, &decoded)
	}
	return response{status: res.StatusCode, header: res.Header, body: decoded}
}

func (b *browser) cookie(name string) *http.Cookie {
	u, _ := url.Parse(b.server.URL)
	for _, c := range b.client.Jar.Cookies(u) {
		if c.Name == name {
			return c
		}
	}
	return nil
}

var sixDigits = regexp.MustCompile(`\b\d{6}\b`)

func codeIn(t *testing.T, m mail.Message) string {
	t.Helper()
	code := sixDigits.FindString(m.Text)
	if code == "" {
		t.Fatalf("no code in %q", m.Text)
	}
	return code
}

func TestRegisteringWithAPasswordByEmailCode(t *testing.T) {
	s := newAccountServer(t, nil)
	b := newBrowser(t, s.server)

	res := b.post("/api/auth/code", map[string]any{"email": " New@Example.com ", "password": "long enough", "locale": "ru"})
	if res.status != http.StatusAccepted || res.body["expires_in"] != float64(600) {
		t.Fatalf("send code = %d %v", res.status, res.body)
	}
	message := s.mailer.last(t)
	if message.To != "new@example.com" || !strings.Contains(message.Subject, "регистрации") {
		t.Errorf("email = %+v", message)
	}

	res = b.post("/api/auth/code/verify", map[string]any{"email": "new@example.com", "code": codeIn(t, message)})
	if res.status != http.StatusOK {
		t.Fatalf("verify = %d %v", res.status, res.body)
	}
	user, _ := res.body["user"].(map[string]any)
	if user["email"] != "new@example.com" {
		t.Errorf("user = %v", res.body)
	}
	// The session cookie: HttpOnly, Lax, and __Host- on https.
	setCookie := res.header.Get("Set-Cookie")
	for _, want := range []string{"__Host-ksp_session=kss_", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"} {
		if !strings.Contains(setCookie, want) {
			t.Errorf("Set-Cookie %q lacks %q", setCookie, want)
		}
	}

	// The password from the code request now signs in.
	other := newBrowser(t, s.server)
	if res := other.post("/api/auth/login", map[string]any{"email": "new@example.com", "password": "long enough"}); res.status != http.StatusOK {
		t.Errorf("login = %d %v", res.status, res.body)
	}
}

func TestSessionsAnswerMeAndSignOut(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	b := newBrowser(t, s.server)
	// httptest serves plain http, so the cookie jar would drop a Secure cookie:
	// read the session from the response and send it by hand.
	res := b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "secret password"})
	if res.status != http.StatusOK {
		t.Fatalf("login = %d %v", res.status, res.body)
	}
	session := sessionFrom(t, res)

	me := callWithCookie(t, s.server, http.MethodGet, "/api/me", session, "")
	if me.status != http.StatusOK || me.body["email"] != "ann@example.com" {
		t.Fatalf("me = %d %v", me.status, me.body)
	}
	if res := call(t, s.server, http.MethodGet, "/api/me", "", ""); res.status != http.StatusUnauthorized {
		t.Errorf("me without a session = %d", res.status)
	}
	// A bearer token still works for the apps.
	if res := call(t, s.server, http.MethodGet, "/api/me", adaToken, ""); res.status != http.StatusOK {
		t.Errorf("me with a token = %d", res.status)
	}

	out := callWithCookie(t, s.server, http.MethodPost, "/api/auth/logout", session, site)
	if out.status != http.StatusNoContent || !strings.Contains(out.header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout = %d %q", out.status, out.header.Get("Set-Cookie"))
	}
	if res := callWithCookie(t, s.server, http.MethodGet, "/api/me", session, ""); res.status != http.StatusUnauthorized {
		t.Errorf("me after logout = %d", res.status)
	}
}

func sessionFrom(t *testing.T, res response) *http.Cookie {
	t.Helper()
	for _, c := range (&http.Response{Header: res.header}).Cookies() {
		if c.Name == "__Host-ksp_session" {
			return c
		}
	}
	t.Fatalf("no session cookie in %v", res.header)
	return nil
}

func callWithCookie(t *testing.T, server *httptest.Server, method, path string, cookie *http.Cookie, origin string) response {
	t.Helper()
	req, _ := http.NewRequest(method, server.URL+path, nil)
	req.AddCookie(cookie)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	_ = json.Unmarshal(data, &decoded)
	return response{status: res.StatusCode, header: res.Header, body: decoded}
}

func TestAPlainHTTPSiteGetsAPlainCookie(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) { a.PublicURL = "http://localhost:5174" })
	s.store.addUser("ann@example.com", "secret password")
	b := newBrowser(t, s.server)
	b.origin = "http://localhost:5174"
	b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "secret password"})
	if c := b.cookie("ksp_session"); c == nil || !strings.HasPrefix(c.Value, "kss_") {
		t.Fatalf("cookie = %v", c)
	}
	if res := b.get("/api/me"); res.status != http.StatusOK {
		t.Errorf("me = %d", res.status)
	}
}

func TestWrongPasswordsAndUnknownAccountsLookTheSame(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	s.store.addUser("nopass@example.com", "")
	b := newBrowser(t, s.server)
	for _, body := range []map[string]any{
		{"email": "ann@example.com", "password": "wrong password"},
		{"email": "nobody@example.com", "password": "secret password"},
		{"email": "nopass@example.com", "password": ""},
		{"email": "not an email", "password": "x"},
	} {
		res := b.post("/api/auth/login", body)
		if res.status != http.StatusUnauthorized || errorCode(res) != "invalid_credentials" {
			t.Errorf("login %v = %d %v", body, res.status, res.body)
		}
	}
}

func TestCodeRequestsDoNotRevealAccounts(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "")
	b := newBrowser(t, s.server)
	known := b.post("/api/auth/code", map[string]any{"email": "ann@example.com"})
	unknown := b.post("/api/auth/code", map[string]any{"email": "bob@example.com"})
	if known.status != unknown.status || known.status != http.StatusAccepted {
		t.Errorf("known %d, unknown %d", known.status, unknown.status)
	}
	if subject := s.mailer.last(t).Subject; !strings.Contains(subject, "sign-up") {
		t.Errorf("a new address gets %q", subject)
	}
}

func TestClosedRegistration(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) { a.RegistrationOpen = false })
	s.store.addUser("ann@example.com", "")
	b := newBrowser(t, s.server)

	res := b.post("/api/auth/code", map[string]any{"email": "bob@example.com"})
	if res.status != http.StatusAccepted || sixDigits.MatchString(s.mailer.last(t).Text) {
		t.Errorf("unknown address: %d, email %q", res.status, s.mailer.last(t).Text)
	}
	// Even a guessed code makes no account.
	if res := b.post("/api/auth/code/verify", map[string]any{"email": "bob@example.com", "code": "123456"}); res.status != http.StatusBadRequest {
		t.Errorf("verify = %d", res.status)
	}
	// An existing account still signs in by code.
	b.post("/api/auth/code", map[string]any{"email": "ann@example.com"})
	res = b.post("/api/auth/code/verify", map[string]any{"email": "ann@example.com", "code": codeIn(t, s.mailer.last(t))})
	if res.status != http.StatusOK {
		t.Errorf("existing account = %d %v", res.status, res.body)
	}
}

func TestWrongCodes(t *testing.T) {
	s := newAccountServer(t, nil)
	b := newBrowser(t, s.server)
	b.post("/api/auth/code", map[string]any{"email": "ann@example.com"})
	code := codeIn(t, s.mailer.last(t))
	for _, wrong := range []string{"000000", "12", "abcdef"} {
		if wrong == code {
			continue
		}
		res := b.post("/api/auth/code/verify", map[string]any{"email": "ann@example.com", "code": wrong})
		if res.status != http.StatusBadRequest || errorCode(res) != "invalid_code" {
			t.Errorf("code %q = %d %v", wrong, res.status, res.body)
		}
	}
	// Typed with spaces or a dash, the right code still works.
	res := b.post("/api/auth/code/verify", map[string]any{"email": "ann@example.com", "code": code[:3] + " " + code[3:]})
	if res.status != http.StatusOK {
		t.Errorf("right code = %d %v", res.status, res.body)
	}
}

func TestWeakPasswordsAndBadEmails(t *testing.T) {
	s := newAccountServer(t, nil)
	b := newBrowser(t, s.server)
	if res := b.post("/api/auth/code", map[string]any{"email": "ann@example.com", "password": "short"}); errorCode(res) != "weak_password" {
		t.Errorf("short password = %d %v", res.status, res.body)
	}
	if res := b.post("/api/auth/code", map[string]any{"email": "ann"}); errorCode(res) != "invalid_email" {
		t.Errorf("bad email = %d %v", res.status, res.body)
	}
	if res := b.post("/api/auth/password/forgot", map[string]any{"email": "@"}); errorCode(res) != "invalid_email" {
		t.Errorf("forgot with a bad email = %d %v", res.status, res.body)
	}
}

func TestPasswordReset(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "old password")
	b := newBrowser(t, s.server)

	// A session from before the reset.
	before := newBrowser(t, s.server)
	session := sessionFrom(t, before.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "old password"}))

	if res := b.post("/api/auth/password/forgot", map[string]any{"email": "ann@example.com", "locale": "en"}); res.status != http.StatusAccepted {
		t.Fatalf("forgot = %d %v", res.status, res.body)
	}
	link := regexp.MustCompile(`https://notes\.example\.com/reset\?token=(\S+)`).FindStringSubmatch(s.mailer.last(t).Text)
	if link == nil {
		t.Fatalf("no link in %q", s.mailer.last(t).Text)
	}
	token, _ := url.QueryUnescape(link[1])

	if res := b.post("/api/auth/password/reset", map[string]any{"token": token, "password": "short"}); errorCode(res) != "weak_password" {
		t.Errorf("weak = %d %v", res.status, res.body)
	}
	res := b.post("/api/auth/password/reset", map[string]any{"token": token, "password": "new password"})
	if res.status != http.StatusOK || res.header.Get("Set-Cookie") == "" {
		t.Fatalf("reset = %d %v", res.status, res.body)
	}
	if res := b.post("/api/auth/password/reset", map[string]any{"token": token, "password": "another one"}); errorCode(res) != "invalid_token" {
		t.Errorf("second use = %d %v", res.status, res.body)
	}
	if res := callWithCookie(t, s.server, http.MethodGet, "/api/me", session, ""); res.status != http.StatusUnauthorized {
		t.Errorf("the old session survived: %d", res.status)
	}
	if res := b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "new password"}); res.status != http.StatusOK {
		t.Errorf("new password = %d", res.status)
	}
}

func TestForgotPasswordForAnUnknownAddress(t *testing.T) {
	s := newAccountServer(t, nil)
	b := newBrowser(t, s.server)
	if res := b.post("/api/auth/password/forgot", map[string]any{"email": "nobody@example.com"}); res.status != http.StatusAccepted {
		t.Fatalf("forgot = %d", res.status)
	}
	if text := s.mailer.last(t).Text; !strings.Contains(text, site+"/register") || strings.Contains(text, "token=") {
		t.Errorf("email = %q", text)
	}
}

func TestSiteRequestsMustComeFromTheSite(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	for _, origin := range []string{"", "https://evil.example", "http://notes.example.com"} {
		b := newBrowser(t, s.server)
		b.origin = origin
		res := b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "secret password"})
		if res.status != http.StatusForbidden || errorCode(res) != "forbidden_origin" {
			t.Errorf("origin %q = %d %v", origin, res.status, res.body)
		}
	}
}

func TestSignInIsOffWithoutAccounts(t *testing.T) {
	server, _ := newTestServer(t)
	b := newBrowser(t, server)
	if res := b.post("/api/auth/login", map[string]any{"email": "a@example.com", "password": "x"}); errorCode(res) != "not_configured" {
		t.Errorf("login = %d %v", res.status, res.body)
	}
}

func TestEmailFlowsNeedAMailer(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) { a.Mailer = nil })
	b := newBrowser(t, s.server)
	for _, path := range []string{"/api/auth/code", "/api/auth/password/forgot"} {
		if res := b.post(path, map[string]any{"email": "a@example.com"}); errorCode(res) != "mail_unavailable" {
			t.Errorf("%s = %d %v", path, res.status, res.body)
		}
	}
}

func TestSignInAttemptsAreRateLimited(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) {
		a.Rates = Rates{LoginFailuresPerIP: 100, LoginFailuresPerEmail: 2, EmailsPerAddress: 2, EmailsPerIP: 100}
	})
	s.store.addUser("ann@example.com", "secret password")
	b := newBrowser(t, s.server)
	for range 2 {
		b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "wrong password"})
	}
	res := b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "secret password"})
	if res.status != http.StatusTooManyRequests || res.header.Get("Retry-After") == "" {
		t.Errorf("login after failures = %d %v", res.status, res.body)
	}

	for range 2 {
		b.post("/api/auth/code", map[string]any{"email": "bob@example.com"})
	}
	if res := b.post("/api/auth/code", map[string]any{"email": "bob@example.com"}); res.status != http.StatusTooManyRequests {
		t.Errorf("third email = %d", res.status)
	}
}

func TestSessionsMoveTheirExpiryForward(t *testing.T) {
	s := newAccountServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	b := newBrowser(t, s.server)
	session := sessionFrom(t, b.post("/api/auth/login", map[string]any{"email": "ann@example.com", "password": "secret password"}))

	// Fresh: no new cookie.
	if res := callWithCookie(t, s.server, http.MethodGet, "/api/me", session, ""); res.header.Get("Set-Cookie") != "" {
		t.Errorf("a fresh session was refreshed")
	}
	s.store.mu.Lock()
	for _, stored := range s.store.sessions {
		stored.LastSeenAt = time.Now().Add(-2 * time.Hour)
	}
	s.store.mu.Unlock()
	if res := callWithCookie(t, s.server, http.MethodGet, "/api/me", session, ""); !strings.Contains(res.header.Get("Set-Cookie"), "__Host-ksp_session="+session.Value) {
		t.Errorf("a stale session was not refreshed: %q", res.header.Get("Set-Cookie"))
	}
}

func TestClientAddressBehindTrustedProxies(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	request := func(remote string, forwarded ...string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		for _, f := range forwarded {
			r.Header.Add("X-Forwarded-For", f)
		}
		return r
	}
	for _, c := range []struct {
		r    *http.Request
		want string
	}{
		{request("203.0.113.9:1234", "1.2.3.4"), "203.0.113.9"},                       // not a proxy: ignored
		{request("10.0.0.2:1234", "198.51.100.7"), "198.51.100.7"},                    // one proxy
		{request("10.0.0.2:1234", "6.6.6.6, 198.51.100.7, 10.0.0.3"), "198.51.100.7"}, // spoofed left part ignored
		{request("10.0.0.2:1234", "198.51.100.7", "10.0.0.5"), "198.51.100.7"},        // several headers
		{request("10.0.0.2:1234"), "10.0.0.2"},                                        // nothing forwarded
		{request("10.0.0.2:1234", "garbage"), "10.0.0.2"},                             // malformed
	} {
		if got := clientAddress(c.r, trusted); got != c.want {
			t.Errorf("clientAddress(%s, %v) = %s, want %s", c.r.RemoteAddr, c.r.Header.Values("X-Forwarded-For"), got, c.want)
		}
	}
}
