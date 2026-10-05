package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"

	"konspecter/server/internal/oauth"
)

// fakeIdP is a sign-in provider: it trades "the-code" for a token and
// answers user info with whatever the test sets.
type fakeIdP struct {
	server *httptest.Server

	mu       sync.Mutex
	userInfo string
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	f := &fakeIdP{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.FormValue("code") != "the-code" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"the-token","token_type":"Bearer"}`))
	})
	mux.HandleFunc("GET /userinfo", func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(f.userInfo))
	})
	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeIdP) says(userInfo string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.userInfo = userInfo
}

func (f *fakeIdP) provider(t *testing.T, id string) *oauth.Provider {
	t.Helper()
	p, err := oauth.New(id, "client-1", "secret-1", plainSite+"/api/auth/"+id+"/callback")
	if err != nil {
		t.Fatal(err)
	}
	p.Config.Endpoint.AuthURL = f.server.URL + "/authorize"
	p.Config.Endpoint.TokenURL = f.server.URL + "/token"
	p.UserInfoURL = f.server.URL + "/userinfo"
	p.Client = f.server.Client()
	return p
}

// plainSite is an http site, so the test's cookie jar keeps the cookies.
const plainSite = "http://localhost:5174"

func newProviderServer(t *testing.T, change func(*Accounts)) (accountSetup, *fakeIdP) {
	t.Helper()
	idp := newFakeIdP(t)
	s := newAccountServer(t, func(a *Accounts) {
		a.PublicURL = plainSite
		a.Providers = map[string]*oauth.Provider{"google": idp.provider(t, "google"), "x": idp.provider(t, "x")}
		a.LoginProviders = map[string][]string{"en": {"google", "x"}, "ru": {}}
		if change != nil {
			change(a)
		}
	})
	return s, idp
}

// navigator is a browser that does not follow redirects, to look at each.
func newNavigator(t *testing.T, s accountSetup) *browser {
	b := newBrowser(t, s.server)
	b.origin = plainSite
	b.client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return b
}

// signInAt goes to the provider and back with the provider's code; it
// returns where the callback sends the browser.
func signInAt(t *testing.T, b *browser, provider, next, code string) *url.URL {
	t.Helper()
	start := b.get("/api/auth/" + provider + "/start?next=" + url.QueryEscape(next))
	if start.status != http.StatusFound {
		t.Fatalf("start = %d %v", start.status, start.body)
	}
	at, _ := url.Parse(start.header.Get("Location"))
	if at.Path != "/authorize" || at.Query().Get("state") == "" {
		t.Fatalf("start went to %s", at)
	}
	query := url.Values{"code": {code}, "state": {at.Query().Get("state")}}
	return followCallback(t, b, provider, query)
}

func followCallback(t *testing.T, b *browser, provider string, query url.Values) *url.URL {
	t.Helper()
	res := b.get("/api/auth/" + provider + "/callback?" + query.Encode())
	if res.status != http.StatusFound {
		t.Fatalf("callback = %d %v", res.status, res.body)
	}
	to, _ := url.Parse(res.header.Get("Location"))
	return to
}

func TestTheSiteListsTheProvidersOfItsLanguage(t *testing.T) {
	s, _ := newProviderServer(t, nil)
	b := newNavigator(t, s)
	for locale, want := range map[string][]any{"en": {"google", "x"}, "de": {"google", "x"}, "ru": {}} {
		res := b.get("/api/auth/providers?locale=" + locale)
		if res.status != http.StatusOK || !reflect.DeepEqual(res.body["providers"], want) {
			t.Errorf("%s: %d %v", locale, res.status, res.body)
		}
	}
}

func TestSigningInWithAProvider(t *testing.T) {
	s, idp := newProviderServer(t, nil)
	idp.says(`{"sub":"g-1","email":"Ann@Example.com","email_verified":true}`)
	b := newNavigator(t, s)

	if to := signInAt(t, b, "google", "/settings", "the-code"); to.String() != "/settings" {
		t.Fatalf("callback sent the browser to %s", to)
	}
	if me := b.get("/api/me"); me.status != http.StatusOK || me.body["email"] != "ann@example.com" {
		t.Fatalf("me = %d %v", me.status, me.body)
	}
	// The flow's cookie is gone; the identity signs in again from anywhere.
	if c := b.cookie(oauthCookie); c != nil {
		t.Errorf("flow cookie left: %v", c)
	}
	other := newNavigator(t, s)
	idp.says(`{"sub":"g-1"}`)
	if to := signInAt(t, other, "google", "/", "the-code"); to.String() != "/" {
		t.Errorf("second sign-in went to %s", to)
	}
	if me := other.get("/api/me"); me.body["email"] != "ann@example.com" {
		t.Errorf("second sign-in = %v", me.body)
	}
}

func TestAVerifiedAddressReachesTheExistingAccount(t *testing.T) {
	s, idp := newProviderServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	idp.says(`{"sub":"g-1","email":"ann@example.com","email_verified":true}`)
	b := newNavigator(t, s)
	signInAt(t, b, "google", "/", "the-code")
	if me := b.get("/api/me"); me.body["id"] != "user-ann@example.com" {
		t.Errorf("me = %v", me.body)
	}
}

func TestAProviderWithoutAnAddressCompletesWithAnEmailCode(t *testing.T) {
	s, idp := newProviderServer(t, nil)
	s.store.addUser("ann@example.com", "")
	idp.says(`{"data":{"id":"x-1"}}`)
	b := newNavigator(t, s)

	to := signInAt(t, b, "x", "/settings", "the-code")
	if to.Path != "/complete" || to.Query().Get("next") != "/settings" {
		t.Fatalf("callback sent the browser to %s", to)
	}
	if me := b.get("/api/me"); me.status != http.StatusUnauthorized {
		t.Fatalf("signed in before proving an address: %v", me.body)
	}
	pending := b.get("/api/auth/complete")
	if pending.status != http.StatusOK || pending.body["provider"] != "x" || pending.body["email"] != "" {
		t.Fatalf("pending = %d %v", pending.status, pending.body)
	}

	res := b.post("/api/auth/complete", map[string]any{"email": "ann@example.com", "locale": "en"})
	if res.status != http.StatusAccepted {
		t.Fatalf("complete = %d %v", res.status, res.body)
	}
	res = b.post("/api/auth/code/verify", map[string]any{"email": "ann@example.com", "code": codeIn(t, s.mailer.last(t))})
	if res.status != http.StatusOK {
		t.Fatalf("verify = %d %v", res.status, res.body)
	}
	if c := b.cookie("ksp_link"); c != nil {
		t.Errorf("link cookie left: %v", c)
	}
	if me := b.get("/api/me"); me.body["id"] != "user-ann@example.com" {
		t.Errorf("me = %v", me.body)
	}

	// From now on X signs in to that account directly.
	other := newNavigator(t, s)
	if to := signInAt(t, other, "x", "/", "the-code"); to.String() != "/" {
		t.Errorf("second sign-in went to %s", to)
	}
}

func TestAnUnverifiedAddressIsOnlyASuggestion(t *testing.T) {
	s, idp := newProviderServer(t, nil)
	s.store.addUser("ann@example.com", "secret password")
	// Someone else's address, unconfirmed at the provider.
	idp.says(`{"sub":"g-2","email":"ann@example.com","email_verified":false}`)
	b := newNavigator(t, s)
	if to := signInAt(t, b, "google", "/", "the-code"); to.Path != "/complete" {
		t.Fatalf("callback sent the browser to %s", to)
	}
	if res := b.get("/api/auth/complete"); res.body["email"] != "ann@example.com" {
		t.Errorf("pending = %v", res.body)
	}
	if me := b.get("/api/me"); me.status != http.StatusUnauthorized {
		t.Errorf("signed in to the account with the address: %v", me.body)
	}
}

func TestCompletingNeedsAPendingSignIn(t *testing.T) {
	s, _ := newProviderServer(t, nil)
	b := newNavigator(t, s)
	if res := b.get("/api/auth/complete"); res.status != http.StatusNotFound || errorCode(res) != "identity_expired" {
		t.Errorf("get = %d %v", res.status, res.body)
	}
	if res := b.post("/api/auth/complete", map[string]any{"email": "ann@example.com"}); errorCode(res) != "identity_expired" {
		t.Errorf("post = %d %v", res.status, res.body)
	}
	if len(s.mailer.sent) != 0 {
		t.Error("an email was sent")
	}
}

func TestProviderSignInFailures(t *testing.T) {
	s, idp := newProviderServer(t, func(a *Accounts) { a.RegistrationOpen = false })
	idp.says(`{"sub":"g-1","email":"new@example.com","email_verified":true}`)

	cases := map[string]struct {
		run  func(b *browser) *url.URL
		want string
	}{
		"closed registration": {
			run:  func(b *browser) *url.URL { return signInAt(t, b, "google", "/", "the-code") },
			want: "/login?error=registration_closed",
		},
		"rejected code": {
			run:  func(b *browser) *url.URL { return signInAt(t, b, "google", "/settings", "stolen") },
			want: "/login?error=oauth_failed&next=%2Fsettings",
		},
		"cancelled at the provider": {
			run: func(b *browser) *url.URL {
				start := b.get("/api/auth/google/start")
				at, _ := url.Parse(start.header.Get("Location"))
				return followCallback(t, b, "google", url.Values{"error": {"access_denied"}, "state": {at.Query().Get("state")}})
			},
			want: "/login?error=oauth_cancelled",
		},
		"another browser's state": {
			run: func(b *browser) *url.URL {
				b.get("/api/auth/google/start")
				return followCallback(t, b, "google", url.Values{"code": {"the-code"}, "state": {"forged"}})
			},
			want: "/login?error=oauth_failed",
		},
		"no flow at all": {
			run: func(b *browser) *url.URL {
				return followCallback(t, b, "google", url.Values{"code": {"the-code"}, "state": {"forged"}})
			},
			want: "/login?error=oauth_failed",
		},
		"flow of another provider": {
			run: func(b *browser) *url.URL {
				start := b.get("/api/auth/x/start")
				at, _ := url.Parse(start.header.Get("Location"))
				return followCallback(t, b, "google", url.Values{"code": {"the-code"}, "state": {at.Query().Get("state")}})
			},
			want: "/login?error=oauth_failed",
		},
		"provider that is not set up": {
			run: func(b *browser) *url.URL {
				res := b.get("/api/auth/vk/start")
				to, _ := url.Parse(res.header.Get("Location"))
				return to
			},
			want: "/login?error=provider_unavailable",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			b := newNavigator(t, s)
			if got := c.run(b); got.String() != c.want {
				t.Errorf("went to %s, want %s", got, c.want)
			}
			if me := b.get("/api/me"); me.status != http.StatusUnauthorized {
				t.Errorf("signed in: %v", me.body)
			}
		})
	}
}

func TestTheFlowCookieIsNarrow(t *testing.T) {
	s, _ := newProviderServer(t, nil)
	b := newNavigator(t, s)
	res := b.get("/api/auth/google/start?next=//evil.example")
	setCookie := res.header.Get("Set-Cookie")
	for _, want := range []string{"ksp_oauth=google.", "Path=/api/auth/", "Max-Age=600", "HttpOnly", "SameSite=Lax"} {
		if !strings.Contains(setCookie, want) {
			t.Errorf("Set-Cookie %q lacks %q", setCookie, want)
		}
	}
}

func TestReturnPath(t *testing.T) {
	for next, want := range map[string]string{
		"/settings?tab=devices": "/settings?tab=devices",
		"":                      "/",
		"settings":              "/",
		"//evil.example":        "/",
		`/\evil.example`:        "/",
		"https://evil.example":  "/",
		"/a\nb":                 "/",
	} {
		if got := returnPath(next); got != want {
			t.Errorf("returnPath(%q) = %q, want %q", next, got, want)
		}
	}
}
