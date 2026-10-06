package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
	"konspecter/server/internal/devices"
	"konspecter/server/internal/mail"
	"konspecter/server/internal/oauth"
)

// AccountStore is the storage the site's sign-in needs.
type AccountStore interface {
	StartEmailCode(ctx context.Context, email string, codeHash []byte, passwordHash string, identity accounts.Identity, expiresAt time.Time) error
	VerifyEmailCode(ctx context.Context, email string, codeHash []byte, createAllowed bool) (auth.User, error)
	PasswordHash(ctx context.Context, email string) (auth.User, string, error)
	CreatePasswordReset(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	ResetPassword(ctx context.Context, tokenHash []byte, passwordHash string) (auth.User, error)
	CreateSession(ctx context.Context, userID string, idHash []byte, userAgent string, expiresAt time.Time) error
	SessionByID(ctx context.Context, idHash []byte) (auth.Session, error)
	ExtendSession(ctx context.Context, idHash []byte, expiresAt time.Time) error
	DeleteSession(ctx context.Context, idHash []byte) error
	SignInWithIdentity(ctx context.Context, identity accounts.Identity, createAllowed bool) (auth.User, error)
	CreatePendingIdentity(ctx context.Context, tokenHash []byte, identity accounts.Identity, expiresAt time.Time) error
	PendingIdentity(ctx context.Context, tokenHash []byte) (accounts.Identity, error)
	Account(ctx context.Context, userID string) (accounts.Account, error)
	RenameAccount(ctx context.Context, userID, name string) (accounts.Account, error)
	DeleteAccount(ctx context.Context, userID string) error
	// SetLocale keeps the language of the user's emails.
	SetLocale(ctx context.Context, userID, locale string) error
}

// DeviceStore is the storage for connecting apps to accounts.
type DeviceStore interface {
	CreateDeviceAuthorization(ctx context.Context, deviceCodeHash, userCodeHash []byte, client devices.Client, expiresAt time.Time) error
	PendingDeviceAuthorization(ctx context.Context, userCodeHash []byte) (devices.Client, error)
	DecideDeviceAuthorization(ctx context.Context, userCodeHash []byte, userID string, approve bool) (devices.Client, error)
	ExchangeDeviceCode(ctx context.Context, deviceCodeHash, tokenHash []byte) (devices.Device, auth.User, error)
	CreateConnectCode(ctx context.Context, userID string, codeHash []byte, expiresAt time.Time) error
	RedeemConnectCode(ctx context.Context, codeHash, tokenHash []byte, client devices.Client) (devices.Device, auth.User, error)
	ListDevices(ctx context.Context, userID string) ([]devices.Device, error)
	RevokeDevice(ctx context.Context, userID, deviceID string) error
}

// Mailer sends one email.
type Mailer interface {
	Send(ctx context.Context, m mail.Message) error
}

// Accounts turns on sign-in for the account site.
type Accounts struct {
	Store AccountStore
	// Devices connects apps through the browser (device authorization).
	Devices DeviceStore
	// Mailer sends codes and reset links; nil means no email, and the flows
	// that need one answer 503.
	Mailer Mailer
	// PublicURL is the site's origin ("https://notes.example.com"): links in
	// emails, the session cookie's Secure flag, and the only Origin allowed
	// to sign in or use a session.
	PublicURL        string
	RegistrationOpen bool
	SessionTTL       time.Duration
	EmailCodeTTL     time.Duration
	PasswordResetTTL time.Duration
	// DeviceCodeTTL is how long an app's request to connect waits for approval.
	DeviceCodeTTL time.Duration
	Rates         Rates
	// Providers are the configured sign-in providers by id.
	Providers map[string]*oauth.Provider
	// LoginProviders are the provider ids the site offers per language
	// ("en", "ru"), each one in Providers.
	LoginProviders map[string][]string
}

// Rates are the abuse limits; see config.Rates.
type Rates struct {
	LoginFailuresPerIP    int
	LoginFailuresPerEmail int
	EmailsPerAddress      int
	EmailsPerIP           int
	// DeviceRequestsPerIP: requests to connect an app per client address per hour.
	DeviceRequestsPerIP int
}

// sessionRefresh is how stale a session's last use may get before its
// expiry (and cookie) is moved forward.
const sessionRefresh = time.Hour

type accountAPI struct {
	Accounts
	cookieName     string
	linkCookieName string
	secure         bool
	loginIP        *windowLimiter
	loginEmail     *windowLimiter
	mailIP         *windowLimiter
	mailAddress    *windowLimiter
	deviceIP       *windowLimiter
}

func newAccountAPI(config Accounts, now func() time.Time) *accountAPI {
	secure := strings.HasPrefix(config.PublicURL, "https://")
	prefix := ""
	if secure {
		// __Host-: the browser keeps it to this exact host, Secure, path /.
		prefix = "__Host-"
	}
	return &accountAPI{
		Accounts:       config,
		cookieName:     prefix + "ksp_session",
		linkCookieName: prefix + "ksp_link",
		secure:         secure,
		loginIP:        newWindowLimiter(config.Rates.LoginFailuresPerIP, 15*time.Minute, now),
		loginEmail:     newWindowLimiter(config.Rates.LoginFailuresPerEmail, 15*time.Minute, now),
		mailIP:         newWindowLimiter(config.Rates.EmailsPerIP, time.Hour, now),
		mailAddress:    newWindowLimiter(config.Rates.EmailsPerAddress, time.Hour, now),
		deviceIP:       newWindowLimiter(config.Rates.DeviceRequestsPerIP, time.Hour, now),
	}
}

func (a *api) registerAccountRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/auth/code", a.siteRequest(a.sendCode))
	mux.Handle("POST /api/auth/code/verify", a.siteRequest(a.verifyCode))
	mux.Handle("POST /api/auth/login", a.siteRequest(a.login))
	mux.Handle("POST /api/auth/logout", a.siteRequest(a.logout))
	mux.Handle("POST /api/auth/password/forgot", a.siteRequest(a.forgotPassword))
	mux.Handle("POST /api/auth/password/reset", a.siteRequest(a.resetPassword))
	a.registerProviderRoutes(mux)
	a.registerSettingsRoutes(mux)
	a.registerDeviceRoutes(mux)
}

// siteRequest guards the site's requests: sign-in must be configured, and a
// request that changes something must come from the site's own pages
// (Origin), which stops other sites from posting on a visitor's behalf.
func (a *api) siteRequest(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.accounts == nil {
			writeError(w, http.StatusServiceUnavailable, "not_configured", "sign-in is not configured on this server")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("Origin") != a.accounts.PublicURL {
			writeError(w, http.StatusForbidden, "forbidden_origin", "this request must come from the site")
			return
		}
		next(w, r)
	})
}

// withSession runs next for the user signed in with the session cookie.
func (a *api) withSession(next userHandler) http.Handler {
	return a.withSessionInfo(func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		next(w, r, session.User)
	})
}

// withSessionInfo runs next with the browser's session.
func (a *api) withSessionInfo(next func(w http.ResponseWriter, r *http.Request, session auth.Session)) http.Handler {
	return a.siteRequest(func(w http.ResponseWriter, r *http.Request) {
		session, ok := a.currentSession(w, r)
		if !ok {
			return
		}
		next(w, r, session)
	})
}

// withTokenOrSession runs next for the bearer token's user (the apps) or,
// without an Authorization header, the session's (the site).
func (a *api) withTokenOrSession(next userHandler) http.Handler {
	bearer := a.authenticated(next)
	session := a.withSession(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			bearer.ServeHTTP(w, r)
			return
		}
		session.ServeHTTP(w, r)
	})
}

// currentSession resolves the session cookie, moving its expiry forward when
// it was last used a while ago. It answers 401 itself when there is no session.
func (a *api) currentSession(w http.ResponseWriter, r *http.Request) (auth.Session, bool) {
	cookie, err := r.Cookie(a.accounts.cookieName)
	if err == nil && strings.HasPrefix(cookie.Value, auth.SessionPrefix) {
		hash := accounts.HashSecret(cookie.Value)
		session, err := a.accounts.Store.SessionByID(r.Context(), hash)
		if err == nil {
			if time.Since(session.LastSeenAt) > sessionRefresh {
				expires := time.Now().Add(a.accounts.SessionTTL)
				if err := a.accounts.Store.ExtendSession(r.Context(), hash, expires); err != nil {
					a.internalError(w, r, err)
					return auth.Session{}, false
				}
				a.setSessionCookie(w, cookie.Value, expires)
			}
			return session, true
		}
		if !errors.Is(err, auth.ErrUnauthorized) {
			a.internalError(w, r, err)
			return auth.Session{}, false
		}
	}
	writeError(w, http.StatusUnauthorized, "unauthorized", "sign in first")
	return auth.Session{}, false
}

func (a *api) setSessionCookie(w http.ResponseWriter, id string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: a.accounts.cookieName, Value: id, Path: "/",
		Expires: expires, MaxAge: int(time.Until(expires).Seconds()),
		HttpOnly: true, Secure: a.accounts.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (a *api) clearSessionCookie(w http.ResponseWriter) {
	a.clearCookie(w, a.accounts.cookieName, "/")
}

func (a *api) clearCookie(w http.ResponseWriter, name, path string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: path, MaxAge: -1,
		HttpOnly: true, Secure: a.accounts.secure, SameSite: http.SameSiteLaxMode,
	})
}

// signIn starts a session for user and answers with the user.
func (a *api) signIn(w http.ResponseWriter, r *http.Request, user auth.User) {
	if err := a.startSession(w, r, user); err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": userJSON(user)})
}

// startSession stores a session for user and sets its cookie. A sign-in
// with another service that was waiting for an address is dropped: the
// browser has signed in now, one way or another.
func (a *api) startSession(w http.ResponseWriter, r *http.Request, user auth.User) error {
	id, hash, err := accounts.NewSecret(auth.SessionPrefix)
	if err != nil {
		return err
	}
	expires := time.Now().Add(a.accounts.SessionTTL)
	if err := a.accounts.Store.CreateSession(r.Context(), user.ID, hash, r.UserAgent(), expires); err != nil {
		return err
	}
	a.setSessionCookie(w, id, expires)
	a.setLocale(r, user.ID, requestLocale(r))
	if _, err := r.Cookie(a.accounts.linkCookieName); err == nil {
		a.clearCookie(w, a.accounts.linkCookieName, "/")
	}
	return nil
}

func userJSON(user auth.User) map[string]string {
	return map[string]string{"id": user.ID, "email": user.Email}
}

// rateLimited answers 429 when any of the keys is over its limit.
func rateLimited(w http.ResponseWriter, checks ...limitCheck) bool {
	for _, check := range checks {
		if retry, blocked := check.limiter.blocked(check.key); blocked {
			w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
			writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts; try again later")
			return true
		}
	}
	return false
}

type limitCheck struct {
	limiter *windowLimiter
	key     string
}

func (a *api) mailUnavailable(w http.ResponseWriter) bool {
	if a.accounts.Mailer == nil {
		writeError(w, http.StatusServiceUnavailable, "mail_unavailable", "this server cannot send email")
		return true
	}
	return false
}

func (a *api) send(w http.ResponseWriter, r *http.Request, m mail.Message) bool {
	if err := a.accounts.Mailer.Send(r.Context(), m); err != nil {
		a.logger.ErrorContext(r.Context(), "sending email failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "mail_failed", "the email could not be sent; try again later")
		return false
	}
	return true
}

// sendCode emails a sign-in code. Proving it signs in, creating the account
// if there is none; a password sent along becomes the account's password.
// The answer is the same whether or not the account exists.
func (a *api) sendCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string  `json:"email"`
		Password *string `json:"password"`
		Locale   string  `json:"locale"`
	}
	if !a.decode(w, r, &body) || a.mailUnavailable(w) {
		return
	}
	a.emailCode(w, r, codeRequest{email: body.Email, password: body.Password, locale: body.Locale})
}

// codeRequest is what an email code will do once proven: sign in to the
// address's account, set a password, link an identity.
type codeRequest struct {
	email    string
	password *string
	locale   string
	identity accounts.Identity
}

func (a *api) emailCode(w http.ResponseWriter, r *http.Request, request codeRequest) {
	email, err := auth.NormalizeEmail(request.email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_email", "enter a valid email address")
		return
	}
	passwordHash := ""
	if request.password != nil {
		if err := accounts.ValidatePassword(*request.password); err != nil {
			writeError(w, http.StatusBadRequest, "weak_password", err.Error())
			return
		}
	}
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.mailIP, client}, limitCheck{a.accounts.mailAddress, email}) {
		return
	}
	a.accounts.mailIP.record(client)
	a.accounts.mailAddress.record(email)
	if request.password != nil {
		if passwordHash, err = accounts.HashPassword(*request.password); err != nil {
			a.internalError(w, r, err)
			return
		}
	}

	locale := mail.ParseLocale(request.locale)
	_, _, err = a.accounts.Store.PasswordHash(r.Context(), email)
	exists := err == nil
	if err != nil && !errors.Is(err, auth.ErrUserNotFound) {
		a.internalError(w, r, err)
		return
	}
	if !exists && !a.accounts.RegistrationOpen {
		if a.send(w, r, mail.RegistrationClosed(locale, a.accounts.PublicURL, email)) {
			writeJSON(w, http.StatusAccepted, map[string]any{"expires_in": int(a.accounts.EmailCodeTTL.Seconds())})
		}
		return
	}
	code, err := accounts.NewCode()
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	expires := time.Now().Add(a.accounts.EmailCodeTTL)
	if err := a.accounts.Store.StartEmailCode(r.Context(), email, accounts.HashCode(email, code), passwordHash, request.identity, expires); err != nil {
		a.internalError(w, r, err)
		return
	}
	if a.send(w, r, mail.SignInCode(locale, a.accounts.PublicURL, email, code, a.accounts.EmailCodeTTL, !exists)) {
		writeJSON(w, http.StatusAccepted, map[string]any{"expires_in": int(a.accounts.EmailCodeTTL.Seconds())})
	}
}

func (a *api) verifyCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.loginIP, client}) {
		return
	}
	email, emailErr := auth.NormalizeEmail(body.Email)
	code := accounts.NormalizeCode(body.Code)
	if emailErr != nil || len(code) != accounts.CodeLength {
		a.accounts.loginIP.record(client)
		writeError(w, http.StatusBadRequest, "invalid_code", "the code is wrong or has expired")
		return
	}
	user, err := a.accounts.Store.VerifyEmailCode(r.Context(), email, accounts.HashCode(email, code), a.accounts.RegistrationOpen)
	switch {
	case errors.Is(err, accounts.ErrInvalidCode):
		a.accounts.loginIP.record(client)
		writeError(w, http.StatusBadRequest, "invalid_code", "the code is wrong or has expired")
	case errors.Is(err, accounts.ErrRegistrationClosed):
		writeError(w, http.StatusForbidden, "registration_closed", "this server does not take new accounts")
	case err != nil:
		a.internalError(w, r, err)
	default:
		a.signIn(w, r, user)
	}
}

func (a *api) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	email, err := auth.NormalizeEmail(body.Email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "the email or password is wrong")
		return
	}
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.loginIP, client}, limitCheck{a.accounts.loginEmail, email}) {
		return
	}
	user, hash, err := a.accounts.Store.PasswordHash(r.Context(), email)
	if err != nil && !errors.Is(err, auth.ErrUserNotFound) {
		a.internalError(w, r, err)
		return
	}
	if !accounts.CheckPasswordOrDummy(hash, body.Password) {
		a.accounts.loginIP.record(client)
		a.accounts.loginEmail.record(email)
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "the email or password is wrong")
		return
	}
	a.signIn(w, r, user)
}

// logout ends the session, if any, and clears the cookie.
func (a *api) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(a.accounts.cookieName); err == nil && cookie.Value != "" {
		if err := a.accounts.Store.DeleteSession(r.Context(), accounts.HashSecret(cookie.Value)); err != nil {
			a.internalError(w, r, err)
			return
		}
	}
	a.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// forgotPassword emails a reset link, or, without an account, says so to
// the address. The answer is the same either way.
func (a *api) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email  string `json:"email"`
		Locale string `json:"locale"`
	}
	if !a.decode(w, r, &body) || a.mailUnavailable(w) {
		return
	}
	email, err := auth.NormalizeEmail(body.Email)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_email", "enter a valid email address")
		return
	}
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.mailIP, client}, limitCheck{a.accounts.mailAddress, email}) {
		return
	}
	a.accounts.mailIP.record(client)
	a.accounts.mailAddress.record(email)

	locale := mail.ParseLocale(body.Locale)
	user, _, err := a.accounts.Store.PasswordHash(r.Context(), email)
	var message mail.Message
	switch {
	case errors.Is(err, auth.ErrUserNotFound):
		message = mail.NoAccount(locale, a.accounts.PublicURL, email)
	case err != nil:
		a.internalError(w, r, err)
		return
	default:
		token, hash, err := accounts.NewSecret("ksr_")
		if err != nil {
			a.internalError(w, r, err)
			return
		}
		if err := a.accounts.Store.CreatePasswordReset(r.Context(), user.ID, hash, time.Now().Add(a.accounts.PasswordResetTTL)); err != nil {
			a.internalError(w, r, err)
			return
		}
		link := a.accounts.PublicURL + "/reset?token=" + url.QueryEscape(token)
		message = mail.PasswordReset(locale, a.accounts.PublicURL, email, link, a.accounts.PasswordResetTTL)
	}
	if a.send(w, r, message) {
		w.WriteHeader(http.StatusAccepted)
	}
}

// resetPassword sets a new password with a reset link's token, ends the
// user's other sessions and signs this browser in.
func (a *api) resetPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if err := accounts.ValidatePassword(body.Password); err != nil {
		writeError(w, http.StatusBadRequest, "weak_password", err.Error())
		return
	}
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.loginIP, client}) {
		return
	}
	hash, err := accounts.HashPassword(body.Password)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	user, err := a.accounts.Store.ResetPassword(r.Context(), accounts.HashSecret(body.Token), hash)
	if errors.Is(err, accounts.ErrInvalidResetToken) {
		a.accounts.loginIP.record(client)
		writeError(w, http.StatusBadRequest, "invalid_token", "the link is wrong, used or has expired")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	a.signIn(w, r, user)
}
