package httpapi

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
	"konspecter/server/internal/oauth"
)

// Sign-in with other services. The browser leaves the site for the provider
// at /api/auth/{provider}/start and comes back to /callback, both plain
// navigations, so they answer with redirects to the site's pages rather than
// JSON: to the page the visitor started from, to /complete when the provider
// vouched for no email address, or to /login?error=<code> when it failed.

const (
	// oauthCookie holds the provider, state, PKCE verifier and return path
	// between start and callback.
	oauthCookie     = "ksp_oauth"
	oauthCookiePath = "/api/auth/"
	oauthCookieTTL  = 10 * time.Minute
	// pendingIdentityTTL is how long a visitor has to prove an address.
	pendingIdentityTTL = 30 * time.Minute
	linkPrefix         = "ksl_"
)

func (a *api) registerProviderRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/auth/providers", a.siteRequest(a.loginProviders))
	mux.Handle("GET /api/auth/{provider}/start", a.siteRequest(a.startProvider))
	mux.Handle("GET /api/auth/{provider}/callback", a.siteRequest(a.providerCallback))
	mux.Handle("GET /api/auth/complete", a.siteRequest(a.pendingIdentity))
	mux.Handle("POST /api/auth/complete", a.siteRequest(a.completeIdentity))
}

// loginProviders lists the providers the site offers in a language.
func (a *api) loginProviders(w http.ResponseWriter, r *http.Request) {
	locale := r.URL.Query().Get("locale")
	if locale != "ru" {
		locale = "en"
	}
	ids := a.accounts.LoginProviders[locale]
	if ids == nil {
		ids = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": ids})
}

// startProvider sends the browser to the provider to sign in.
func (a *api) startProvider(w http.ResponseWriter, r *http.Request) {
	provider := a.accounts.Providers[r.PathValue("provider")]
	if provider == nil {
		redirectToLogin(w, r, "provider_unavailable", "/")
		return
	}
	state, verifier := oauth.NewSecret(), oauth.NewSecret()
	next := returnPath(r.URL.Query().Get("next"))
	http.SetCookie(w, &http.Cookie{
		Name:  oauthCookie,
		Value: strings.Join([]string{provider.ID, state, verifier, base64.RawURLEncoding.EncodeToString([]byte(next))}, "."),
		Path:  oauthCookiePath, MaxAge: int(oauthCookieTTL.Seconds()),
		HttpOnly: true, Secure: a.accounts.secure, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, provider.AuthCodeURL(state, verifier), http.StatusFound)
}

// providerCallback finishes the provider's sign-in: it checks the state,
// reads who signed in and signs that account in on the site.
func (a *api) providerCallback(w http.ResponseWriter, r *http.Request) {
	a.clearCookie(w, oauthCookie, oauthCookiePath)
	provider := a.accounts.Providers[r.PathValue("provider")]
	flow, ok := readOAuthCookie(r)
	if provider == nil {
		redirectToLogin(w, r, "provider_unavailable", flow.next)
		return
	}
	client := clientAddress(r, a.trusted)
	if _, blocked := a.accounts.loginIP.blocked(client); blocked {
		redirectToLogin(w, r, "rate_limited", flow.next)
		return
	}
	query := r.URL.Query()
	if !ok || flow.provider != provider.ID || subtle.ConstantTimeCompare([]byte(flow.state), []byte(query.Get("state"))) != 1 {
		// No flow of this browser's: a stale tab, or a link someone else made.
		a.accounts.loginIP.record(client)
		redirectToLogin(w, r, "oauth_failed", flow.next)
		return
	}
	if reason := query.Get("error"); reason != "" {
		code := "oauth_failed"
		if reason == "access_denied" {
			code = "oauth_cancelled"
		}
		redirectToLogin(w, r, code, flow.next)
		return
	}
	profile, err := provider.Profile(r.Context(), query, flow.verifier)
	if err != nil {
		a.accounts.loginIP.record(client)
		a.logger.WarnContext(r.Context(), "sign-in with a provider failed", "provider", provider.ID, "error", err)
		redirectToLogin(w, r, "oauth_failed", flow.next)
		return
	}

	identity := accounts.Identity{Provider: provider.ID, Subject: profile.Subject}
	if email, err := auth.NormalizeEmail(profile.Email); err == nil {
		identity.Email, identity.EmailVerified = email, profile.EmailVerified
	}
	user, err := a.accounts.Store.SignInWithIdentity(r.Context(), identity, a.accounts.RegistrationOpen)
	switch {
	case errors.Is(err, accounts.ErrEmailRequired):
		a.askForEmail(w, r, identity, flow.next)
	case errors.Is(err, accounts.ErrRegistrationClosed):
		redirectToLogin(w, r, "registration_closed", flow.next)
	case err != nil:
		a.logger.ErrorContext(r.Context(), "sign-in with a provider failed", "provider", provider.ID, "error", err)
		redirectToLogin(w, r, "internal", flow.next)
	default:
		if err := a.startSession(w, r, user); err != nil {
			a.logger.ErrorContext(r.Context(), "starting a session failed", "error", err)
			redirectToLogin(w, r, "internal", flow.next)
			return
		}
		http.Redirect(w, r, flow.next, http.StatusFound)
	}
}

// askForEmail keeps the identity aside and sends the visitor to /complete
// to prove an address; the browser holds the pending identity's token.
func (a *api) askForEmail(w http.ResponseWriter, r *http.Request, identity accounts.Identity, next string) {
	token, hash, err := accounts.NewSecret(linkPrefix)
	if err == nil {
		expires := time.Now().Add(pendingIdentityTTL)
		if err = a.accounts.Store.CreatePendingIdentity(r.Context(), hash, identity, expires); err == nil {
			http.SetCookie(w, &http.Cookie{
				Name: a.accounts.linkCookieName, Value: token, Path: "/",
				Expires: expires, MaxAge: int(pendingIdentityTTL.Seconds()),
				HttpOnly: true, Secure: a.accounts.secure, SameSite: http.SameSiteLaxMode,
			})
			http.Redirect(w, r, "/complete?next="+url.QueryEscape(next), http.StatusFound)
			return
		}
	}
	a.logger.ErrorContext(r.Context(), "keeping a sign-in for its address failed", "error", err)
	redirectToLogin(w, r, "internal", next)
}

// pendingIdentity tells /complete which provider is waiting and the address
// it suggested, if any.
func (a *api) pendingIdentity(w http.ResponseWriter, r *http.Request) {
	identity, ok := a.readPendingIdentity(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"provider": identity.Provider, "email": identity.Email})
}

// completeIdentity emails a code to the address the visitor entered; proving
// it signs in to that address's account (or creates it) and links the
// waiting identity to it.
func (a *api) completeIdentity(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email  string `json:"email"`
		Locale string `json:"locale"`
	}
	if !a.decode(w, r, &body) || a.mailUnavailable(w) {
		return
	}
	identity, ok := a.readPendingIdentity(w, r)
	if !ok {
		return
	}
	link := accounts.Identity{Provider: identity.Provider, Subject: identity.Subject}
	a.emailCode(w, r, codeRequest{email: body.Email, locale: body.Locale, identity: link})
}

func (a *api) readPendingIdentity(w http.ResponseWriter, r *http.Request) (accounts.Identity, bool) {
	cookie, err := r.Cookie(a.accounts.linkCookieName)
	if err == nil && strings.HasPrefix(cookie.Value, linkPrefix) {
		identity, err := a.accounts.Store.PendingIdentity(r.Context(), accounts.HashSecret(cookie.Value))
		if err == nil {
			return identity, true
		}
		if !errors.Is(err, accounts.ErrIdentityExpired) {
			a.internalError(w, r, err)
			return accounts.Identity{}, false
		}
	}
	writeError(w, http.StatusNotFound, "identity_expired", "the sign-in has expired; start again")
	return accounts.Identity{}, false
}

// oauthFlow is the oauthCookie's content.
type oauthFlow struct {
	provider, state, verifier, next string
}

// readOAuthCookie returns the flow; when there is none, next is still "/".
func readOAuthCookie(r *http.Request) (oauthFlow, bool) {
	cookie, err := r.Cookie(oauthCookie)
	if err != nil {
		return oauthFlow{next: "/"}, false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 4 || parts[1] == "" || parts[2] == "" {
		return oauthFlow{next: "/"}, false
	}
	next, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return oauthFlow{next: "/"}, false
	}
	return oauthFlow{provider: parts[0], state: parts[1], verifier: parts[2], next: returnPath(string(next))}, true
}

// returnPath is next when it is a path on the site, else "/". A path that
// starts with "//" or "/\" would leave the site.
func returnPath(next string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.HasPrefix(next, `/\`) ||
		len(next) > 512 || strings.ContainsFunc(next, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
		return "/"
	}
	return next
}

// redirectToLogin sends the browser to the sign-in page with an error code.
func redirectToLogin(w http.ResponseWriter, r *http.Request, code, next string) {
	query := url.Values{"error": {code}}
	if next != "/" {
		query.Set("next", next)
	}
	http.Redirect(w, r, "/login?"+query.Encode(), http.StatusFound)
}
