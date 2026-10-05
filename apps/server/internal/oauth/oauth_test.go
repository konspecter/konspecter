package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// fakeProvider is a provider's token and user info endpoints. It answers
// the user info request with userInfo and records the token request.
type fakeProvider struct {
	server   *httptest.Server
	userInfo string

	mu           sync.Mutex
	tokenForm    url.Values
	tokenBasic   string
	authHeader   string
	userInfoForm url.Values
}

func newFakeProvider(t *testing.T, userInfo string) *fakeProvider {
	t.Helper()
	f := &fakeProvider{userInfo: userInfo}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		f.tokenForm = r.PostForm
		if user, _, ok := r.BasicAuth(); ok {
			f.tokenBasic = user
		}
		f.mu.Unlock()
		if r.PostForm.Get("code") != "the-code" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"the-token","token_type":"Bearer","expires_in":3600}`))
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		f.authHeader = r.Header.Get("Authorization")
		f.userInfoForm = r.PostForm
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(f.userInfo))
	})
	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

// provider returns the real provider id, pointed at the fake.
func (f *fakeProvider) provider(t *testing.T, id string) *Provider {
	t.Helper()
	p, err := New(id, "client-1", "secret-1", "https://notes.example.com/api/auth/"+id+"/callback")
	if err != nil {
		t.Fatal(err)
	}
	p.Config.Endpoint.AuthURL = f.server.URL + "/authorize"
	p.Config.Endpoint.TokenURL = f.server.URL + "/token"
	p.UserInfoURL = f.server.URL + "/userinfo"
	p.Client = f.server.Client()
	return p
}

func callback(code string, extra ...string) url.Values {
	values := url.Values{"code": {code}, "state": {"state-1"}}
	for i := 0; i+1 < len(extra); i += 2 {
		values.Set(extra[i], extra[i+1])
	}
	return values
}

func TestAuthCodeURLCarriesStateAndChallenge(t *testing.T) {
	p, err := New("google", "client-1", "secret-1", "https://notes.example.com/api/auth/google/callback")
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewSecret()
	u, err := url.Parse(p.AuthCodeURL("state-1", verifier))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	sum := sha256.Sum256([]byte(verifier))
	want := map[string]string{
		"client_id":             "client-1",
		"redirect_uri":          "https://notes.example.com/api/auth/google/callback",
		"response_type":         "code",
		"scope":                 "openid email",
		"state":                 "state-1",
		"code_challenge":        base64.RawURLEncoding.EncodeToString(sum[:]),
		"code_challenge_method": "S256",
	}
	for key, value := range want {
		if q.Get(key) != value {
			t.Errorf("%s = %q, want %q", key, q.Get(key), value)
		}
	}
	if u.Host != "accounts.google.com" {
		t.Errorf("host = %q", u.Host)
	}

	linkedin, _ := New("linkedin", "c", "s", "https://notes.example.com/cb")
	if strings.Contains(linkedin.AuthCodeURL("s", verifier), "code_challenge") {
		t.Error("LinkedIn got a PKCE challenge")
	}
}

func TestUnknownProvider(t *testing.T) {
	if _, err := New("myspace", "c", "s", "https://x"); err == nil {
		t.Error("New(myspace) succeeded")
	}
	for _, id := range IDs {
		if _, err := New(id, "c", "s", "https://x"); err != nil {
			t.Errorf("New(%s) = %v", id, err)
		}
	}
}

func TestGoogleProfile(t *testing.T) {
	f := newFakeProvider(t, `{"sub":"g-1","email":"Ann@Example.com","email_verified":true}`)
	p := f.provider(t, "google")
	profile, err := p.Profile(context.Background(), callback("the-code"), "verifier-1")
	if err != nil {
		t.Fatal(err)
	}
	if profile != (Profile{Subject: "g-1", Email: "Ann@Example.com", EmailVerified: true}) {
		t.Errorf("profile = %+v", profile)
	}
	if f.tokenForm.Get("code_verifier") != "verifier-1" || f.tokenForm.Get("client_secret") != "secret-1" {
		t.Errorf("token request = %v", f.tokenForm)
	}
	if f.authHeader != "Bearer the-token" {
		t.Errorf("Authorization = %q", f.authHeader)
	}
}

func TestUnverifiedOpenIDEmail(t *testing.T) {
	f := newFakeProvider(t, `{"sub":"l-1","email":"ann@example.com","email_verified":"false"}`)
	profile, err := f.provider(t, "linkedin").Profile(context.Background(), callback("the-code"), "")
	if err != nil {
		t.Fatal(err)
	}
	if profile.EmailVerified {
		t.Errorf("profile = %+v", profile)
	}
	if f.tokenForm.Has("code_verifier") {
		t.Error("LinkedIn got a PKCE verifier")
	}
}

func TestXProfileHasNoEmail(t *testing.T) {
	f := newFakeProvider(t, `{"data":{"id":"123","name":"Ann","username":"ann"}}`)
	profile, err := f.provider(t, "x").Profile(context.Background(), callback("the-code"), "v")
	if err != nil {
		t.Fatal(err)
	}
	if profile != (Profile{Subject: "123"}) {
		t.Errorf("profile = %+v", profile)
	}
	// X takes the client's credentials in the Authorization header.
	if f.tokenBasic != "client-1" || f.tokenForm.Has("client_secret") {
		t.Errorf("token request: basic %q, form %v", f.tokenBasic, f.tokenForm)
	}
}

func TestYandexProfile(t *testing.T) {
	f := newFakeProvider(t, `{"id":"1000","login":"ann","default_email":"ann@yandex.ru"}`)
	profile, err := f.provider(t, "yandex").Profile(context.Background(), callback("the-code"), "v")
	if err != nil {
		t.Fatal(err)
	}
	if profile != (Profile{Subject: "1000", Email: "ann@yandex.ru", EmailVerified: true}) {
		t.Errorf("profile = %+v", profile)
	}
	if f.authHeader != "OAuth the-token" {
		t.Errorf("Authorization = %q", f.authHeader)
	}
}

func TestVKProfile(t *testing.T) {
	f := newFakeProvider(t, `{"user":{"user_id":42,"first_name":"Ann","email":"ann@vk.com"}}`)
	profile, err := f.provider(t, "vk").Profile(context.Background(), callback("the-code", "device_id", "device-1"), "v")
	if err != nil {
		t.Fatal(err)
	}
	// VK does not vouch for the address.
	if profile != (Profile{Subject: "42", Email: "ann@vk.com"}) {
		t.Errorf("profile = %+v", profile)
	}
	if f.tokenForm.Get("device_id") != "device-1" || f.tokenForm.Get("state") != "state-1" {
		t.Errorf("token request = %v", f.tokenForm)
	}
	if f.userInfoForm.Get("access_token") != "the-token" || f.userInfoForm.Get("client_id") != "client-1" {
		t.Errorf("user info request = %v", f.userInfoForm)
	}
}

func TestProfileFailures(t *testing.T) {
	cases := map[string]struct {
		userInfo string
		code     string
	}{
		"no code":         {`{"sub":"g-1"}`, ""},
		"rejected code":   {`{"sub":"g-1"}`, "stolen"},
		"no account id":   {`{"email":"ann@example.com","email_verified":true}`, "the-code"},
		"broken response": {`{`, "the-code"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFakeProvider(t, c.userInfo)
			if _, err := f.provider(t, "google").Profile(context.Background(), callback(c.code), "v"); err == nil {
				t.Error("Profile() succeeded")
			}
		})
	}
	f := newFakeProvider(t, `{"error":"invalid_token"}`)
	if _, err := f.provider(t, "vk").Profile(context.Background(), callback("the-code"), "v"); err == nil {
		t.Error("VK error accepted")
	}
}
