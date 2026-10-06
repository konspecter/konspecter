package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/entitlements"
	"konspecter/server/internal/mail"
)

// Paid sync: a billing service of its own sells sync. The server
// keeps each account's latest entitlement and enforces it: the sync routes
// answer 402 when the account may not sync. The site's subscription
// requests, the price list and the gateways' webhooks are passed on to the
// service, the signed-in user named in headers the server sets itself. The
// service pushes entitlements to the internal routes, and has the server
// email billing events.

// EntitlementStore keeps the accounts' entitlements, and finds where to
// email an account.
type EntitlementStore interface {
	Entitlement(ctx context.Context, userID string) (entitlements.Entitlement, error)
	PutEntitlement(ctx context.Context, e entitlements.Entitlement) (bool, error)
	Recipient(ctx context.Context, userID string) (email, locale string, err error)
}

// Billing makes sync paid: a billing service sells it. It needs Accounts.
type Billing struct {
	// URL is the billing service as the server reaches it ("http://billing:8081").
	URL string
	// Token is shared with the service: the server sends it, and the
	// internal routes take nothing without it.
	Token string
	Store EntitlementStore
}

type billingAPI struct {
	Billing
	service *entitlements.Client
	proxy   *httputil.ReverseProxy
	asked   *askLimiter
	now     func() time.Time
}

// The headers that name the signed-in user to the billing service.
const (
	userIDHeader    = "X-Konspecter-User-Id"
	userEmailHeader = "X-Konspecter-User-Email"
)

// maxProxiedBytes bounds a request passed on to the billing service.
const maxProxiedBytes = 64 << 10

// askInterval is how often the server asks the billing service again about
// an account whose entitlement ran out without word of what came next.
const askInterval = time.Minute

func newBillingAPI(b Billing, now func() time.Time) (*billingAPI, error) {
	target, err := url.Parse(b.URL)
	if err != nil {
		return nil, err
	}
	return &billingAPI{
		Billing: b,
		service: &entitlements.Client{BaseURL: b.URL, Token: b.Token},
		proxy: &httputil.ReverseProxy{
			Rewrite: func(r *httputil.ProxyRequest) { r.SetURL(target) },
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
				writeError(w, http.StatusBadGateway, "billing_unavailable", "subscriptions cannot be reached; try again later")
			},
		},
		asked: newAskLimiter(askInterval),
		now:   now,
	}, nil
}

func (a *api) registerBillingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/billing/plans", a.plans)
	mux.HandleFunc("POST /api/billing/webhooks/{gateway}", a.webhook)
	mux.Handle("GET /api/subscription", a.withSession(a.subscription))
	for _, route := range []string{
		"POST /api/subscription", "GET /api/subscription/checkouts/{id}",
		"POST /api/subscription/cancel", "POST /api/subscription/resume",
	} {
		mux.Handle(route, a.withSession(a.subscriptionChange))
	}
	if a.billing != nil {
		mux.Handle("PUT /internal/entitlements/{user}", a.internal(a.putEntitlement))
		mux.Handle("POST /internal/users/{user}/notices", a.internal(a.sendNotice))
	}
}

// entitled lets next run only for accounts that may sync. While sync is
// free it is next itself.
func (a *api) entitled(next userHandler) userHandler {
	if a.billing == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if a.syncAllowed(w, r, user.ID) {
			next(w, r, user)
		}
	}
}

// entitledDevice is entitled for a device's request.
func (a *api) entitledDevice(next deviceHandler) deviceHandler {
	if a.billing == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request, device auth.Device) {
		if a.syncAllowed(w, r, device.User.ID) {
			next(w, r, device)
		}
	}
}

// syncAllowed answers 402 subscription_required, and false, when the user
// may not sync. A sync request may start the account's trial.
func (a *api) syncAllowed(w http.ResponseWriter, r *http.Request, userID string) bool {
	e, err := a.entitlement(r.Context(), userID, true)
	if err != nil {
		a.logger.ErrorContext(r.Context(), "the billing service did not say whether an account may sync", "error", err)
		writeError(w, http.StatusServiceUnavailable, "billing_unavailable", "whether this account may sync is not known yet; try again later")
		return false
	}
	if !e.Allowed(a.billing.now()) {
		writeError(w, http.StatusPaymentRequired, "subscription_required",
			"sync needs a subscription; every note is kept, here and on the devices")
		return false
	}
	return true
}

// entitlement is the user's entitlement as the server holds it. It asks the
// billing service when it holds none, or one whose time ran out with no
// word of what came next (a renewal it did not hear of, most likely), at
// most once a minute. A sync (syncing) of an account that never had any
// time asks as well: that is when its trial starts.
func (a *api) entitlement(ctx context.Context, userID string, syncing bool) (entitlements.Entitlement, error) {
	b := a.billing
	now := b.now()
	e, err := b.Store.Entitlement(ctx, userID)
	missing := errors.Is(err, entitlements.ErrNone)
	if err != nil && !missing {
		return entitlements.Entitlement{}, err
	}
	never := e.Status == entitlements.Expired && e.Until == nil
	switch {
	case missing:
	case e.Stale(now) && b.asked.allow(userID, now):
	case never && syncing && b.asked.allow(userID+" trial", now):
	default:
		return e, nil
	}
	fresh, err := b.service.Fetch(ctx, userID, syncing)
	if err != nil {
		if missing {
			return entitlements.Entitlement{}, err
		}
		a.logger.WarnContext(ctx, "asking the billing service for an entitlement failed", "error", err)
		return e, nil
	}
	return a.keepEntitlement(ctx, fresh)
}

// keepEntitlement stores an entitlement unless a later one is kept, and
// returns the one kept. When the account may no longer sync, its event
// streams end, so its apps hear of it at once.
func (a *api) keepEntitlement(ctx context.Context, e entitlements.Entitlement) (entitlements.Entitlement, error) {
	b := a.billing
	stored, err := b.Store.PutEntitlement(ctx, e)
	if err != nil {
		return entitlements.Entitlement{}, err
	}
	if !stored {
		return b.Store.Entitlement(ctx, e.UserID)
	}
	if !e.Allowed(b.now()) {
		a.hub.end(e.UserID, "")
	}
	return e, nil
}

type accessJSON struct {
	State string     `json:"state"`
	Until *time.Time `json:"until"`
}

var freeAccess = &accessJSON{State: "free"}

// access is the user's sync for /api/me: free, or the entitlement's status
// and time. Nil when the billing service cannot say yet.
func (a *api) access(r *http.Request, userID string) *accessJSON {
	if a.billing == nil {
		return freeAccess
	}
	e, err := a.entitlement(r.Context(), userID, false)
	if err != nil {
		a.logger.WarnContext(r.Context(), "the billing service did not say how an account's sync stands", "error", err)
		return nil
	}
	return &accessJSON{State: string(e.Status), Until: utc(e.Until)}
}

// plans says what sync costs, for the site's pages: the billing service's
// answer, or that sync is free.
func (a *api) plans(w http.ResponseWriter, r *http.Request) {
	if a.billing == nil {
		writeJSON(w, http.StatusOK, map[string]any{"paid": false, "gateways": []any{}})
		return
	}
	a.passOn(w, r, nil)
}

// webhook passes a payment gateway's notification on to the billing
// service as it came: the service checks it.
func (a *api) webhook(w http.ResponseWriter, r *http.Request) {
	if a.billingOff(w) {
		return
	}
	a.passOn(w, r, nil)
}

// subscription is the account's subscription as the site's settings show
// it: the billing service's answer, or that sync is free.
func (a *api) subscription(w http.ResponseWriter, r *http.Request, user auth.User) {
	if a.billing == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"paid": false, "access": freeAccess, "subscription": nil, "payments": []any{},
		})
		return
	}
	a.passOn(w, r, &user)
}

// subscriptionChange passes the site's subscribing, checkout, cancelling
// or resuming on to the billing service. The account's entitlement is
// asked again after it, so the apps can sync at once after paying.
func (a *api) subscriptionChange(w http.ResponseWriter, r *http.Request, user auth.User) {
	if a.billingOff(w) {
		return
	}
	a.passOn(w, r, &user)
	fresh, err := a.billing.service.Fetch(r.Context(), user.ID, false)
	if err == nil {
		_, err = a.keepEntitlement(r.Context(), fresh)
	}
	if err != nil {
		a.logger.WarnContext(r.Context(), "asking the billing service for an entitlement failed", "error", err)
	}
}

// passOn sends the request to the billing service and its answer back.
// Nothing of the browser's credentials goes along: the service hears the
// token, and the user the server signed in, if any.
func (a *api) passOn(w http.ResponseWriter, r *http.Request, user *auth.User) {
	out := r.Clone(r.Context())
	out.Body = http.MaxBytesReader(w, r.Body, maxProxiedBytes)
	out.Header.Del("Cookie")
	for name := range out.Header {
		if strings.HasPrefix(strings.ToLower(name), "x-konspecter-") {
			out.Header.Del(name)
		}
	}
	out.Header.Set("Authorization", "Bearer "+a.billing.Token)
	if user != nil {
		out.Header.Set(userIDHeader, user.ID)
		out.Header.Set(userEmailHeader, user.Email)
	}
	a.billing.proxy.ServeHTTP(w, out)
}

func (a *api) billingOff(w http.ResponseWriter) bool {
	if a.billing == nil {
		writeError(w, http.StatusNotFound, "billing_off", "sync is free on this server")
		return true
	}
	return false
}

// internal lets only the billing service in: the request must bear the
// shared token.
func (a *api) internal(next http.HandlerFunc) http.Handler {
	want := []byte("Bearer " + a.billing.Token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), want) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "only the billing service may call this")
			return
		}
		next(w, r)
	})
}

// putEntitlement is the billing service telling of an account's
// entitlement. One older than the one kept changes nothing.
func (a *api) putEntitlement(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status  entitlements.Status `json:"status"`
		Until   *time.Time          `json:"until"`
		Version int64               `json:"version"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	e := entitlements.Entitlement{UserID: r.PathValue("user"), Status: body.Status, Until: body.Until, Version: body.Version}
	if err := e.Check(); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_entitlement", err.Error())
		return
	}
	kept, err := a.keepEntitlement(r.Context(), e)
	if errors.Is(err, auth.ErrUserNotFound) {
		writeError(w, http.StatusNotFound, "unknown_user", "no such user")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stored": kept.Version == e.Version})
}

// sendNotice is the billing service having an account emailed of a billing
// event, in the account's language.
func (a *api) sendNotice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID       string     `json:"id"`
		Kind     string     `json:"kind"`
		Amount   string     `json:"amount"`
		Currency string     `json:"currency"`
		Period   string     `json:"period"`
		Gateway  string     `json:"gateway"`
		Until    *time.Time `json:"until"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	email, locale, err := a.billing.Store.Recipient(r.Context(), r.PathValue("user"))
	if errors.Is(err, auth.ErrUserNotFound) {
		writeError(w, http.StatusNotFound, "unknown_user", "no such user")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	message, ok := mail.BillingNotice(mail.ParseLocale(locale), a.accounts.PublicURL, email, mail.Notice{
		Kind: body.Kind, Amount: body.Amount, Currency: body.Currency, Period: body.Period, Until: body.Until,
	})
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown_kind", "no email for that kind of event")
		return
	}
	if a.accounts.Mailer == nil {
		writeError(w, http.StatusServiceUnavailable, "mail_off", "this server sends no email")
		return
	}
	if err := a.accounts.Mailer.Send(r.Context(), message); err != nil {
		a.logger.ErrorContext(r.Context(), "emailing a billing event failed", "event", body.ID, "kind", body.Kind, "error", err)
		writeError(w, http.StatusBadGateway, "mail_failed", "the email could not be sent; try again later")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"sent": true})
}

// forgetBilling has the billing service cancel a renewing subscription at
// its gateway and forget the account, before the account is deleted. It
// answers, and returns false, when that could not be done: the account is
// then kept.
func (a *api) forgetBilling(w http.ResponseWriter, r *http.Request, userID string) bool {
	if a.billing == nil {
		return true
	}
	err := a.billing.service.Forget(r.Context(), userID)
	switch {
	case errors.Is(err, entitlements.ErrGateway):
		a.logger.ErrorContext(r.Context(), "payment gateway failed", "path", r.URL.Path, "error", err)
		writeError(w, http.StatusBadGateway, "gateway_failed", "the payment service did not answer; try again later")
		return false
	case err != nil:
		a.logger.ErrorContext(r.Context(), "the billing service did not forget an account", "error", err)
		writeError(w, http.StatusBadGateway, "billing_unavailable", "subscriptions cannot be reached; try again later")
		return false
	}
	return true
}

// askLimiter keeps the server from asking the billing service about one
// account more than once an interval.
type askLimiter struct {
	mu       sync.Mutex
	interval time.Duration
	last     map[string]time.Time
}

func newAskLimiter(interval time.Duration) *askLimiter {
	return &askLimiter{interval: interval, last: map[string]time.Time{}}
}

func (l *askLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if last, ok := l.last[key]; ok && now.Sub(last) < l.interval {
		return false
	}
	if len(l.last) >= 10_000 {
		for k, t := range l.last {
			if now.Sub(t) >= l.interval {
				delete(l.last, k)
			}
		}
	}
	l.last[key] = now
	return true
}

// siteLocale reads a language the site speaks.
func siteLocale(value string) (string, bool) {
	switch value {
	case "en", "ru":
		return value, true
	}
	return "", false
}

// requestLocale is the language a site request is in: the site's lang
// cookie, else the browser's first language the site speaks, else English.
func requestLocale(r *http.Request) string {
	if cookie, err := r.Cookie("lang"); err == nil {
		if locale, ok := siteLocale(cookie.Value); ok {
			return locale
		}
	}
	for _, tag := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		tag, _, _ = strings.Cut(strings.TrimSpace(tag), ";")
		language, _, _ := strings.Cut(strings.ToLower(tag), "-")
		if locale, ok := siteLocale(language); ok {
			return locale
		}
	}
	return "en"
}

// setLocale keeps the language of the user's emails.
func (a *api) setLocale(r *http.Request, userID, locale string) {
	if err := a.accounts.Store.SetLocale(r.Context(), userID, locale); err != nil {
		a.logger.WarnContext(r.Context(), "keeping the account's language failed", "error", err)
	}
}
