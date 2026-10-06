package httpapi

import (
	"net/http"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
)

// The account on the site's settings page: its name, and deleting it.

func (a *api) registerSettingsRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/account", a.withSessionInfo(a.account))
	mux.Handle("PATCH /api/account", a.withSessionInfo(a.renameAccount))
	mux.Handle("DELETE /api/account", a.withSessionInfo(a.deleteAccount))
}

type accountJSON struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	// RecentSignIn says whether this browser signed in recently enough to
	// delete the account (accounts.RecentSignIn).
	RecentSignIn bool `json:"recent_sign_in"`
}

func toAccountJSON(account accounts.Account, session auth.Session) accountJSON {
	return accountJSON{
		ID: account.ID, Email: account.Email, Name: account.Name, CreatedAt: account.CreatedAt.UTC(),
		RecentSignIn: recentSignIn(session),
	}
}

func recentSignIn(session auth.Session) bool {
	return time.Since(session.CreatedAt) < accounts.RecentSignIn
}

func (a *api) account(w http.ResponseWriter, r *http.Request, session auth.Session) {
	account, err := a.accounts.Store.Account(r.Context(), session.User.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toAccountJSON(account, session))
}

// renameAccount changes the account's name, or the language of its emails
// (the site's language, when the owner picks another).
func (a *api) renameAccount(w http.ResponseWriter, r *http.Request, session auth.Session) {
	var body struct {
		Name   *string `json:"name"`
		Locale *string `json:"locale"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Name == nil && body.Locale == nil {
		writeError(w, http.StatusBadRequest, "invalid_request", `"name" or "locale" is required`)
		return
	}
	if body.Locale != nil {
		locale, ok := siteLocale(*body.Locale)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_request", `"locale" must be "en" or "ru"`)
			return
		}
		a.setLocale(r, session.User.ID, locale)
	}
	var account accounts.Account
	var err error
	if body.Name == nil {
		account, err = a.accounts.Store.Account(r.Context(), session.User.ID)
	} else {
		name, nameErr := accounts.NormalizeName(*body.Name)
		if nameErr != nil {
			writeError(w, http.StatusBadRequest, "invalid_name", nameErr.Error())
			return
		}
		account, err = a.accounts.Store.RenameAccount(r.Context(), session.User.ID, name)
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, toAccountJSON(account, session))
}

// deleteAccount deletes the account and everything in it. The browser must
// have signed in recently and the owner must type the address: a session
// left open, or a slip, is not enough. The billing service cancels a
// renewing subscription at its gateway first, and forgets the account. The
// apps' tokens stop working, their streams end now, and they keep their
// notes.
func (a *api) deleteAccount(w http.ResponseWriter, r *http.Request, session auth.Session) {
	var body struct {
		Email string `json:"email"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if !recentSignIn(session) {
		writeError(w, http.StatusForbidden, "reauthentication_required", "sign in again to delete the account")
		return
	}
	if email, err := auth.NormalizeEmail(body.Email); err != nil || email != session.User.Email {
		writeError(w, http.StatusBadRequest, "email_mismatch", "type the account's email address to confirm")
		return
	}
	if !a.forgetBilling(w, r, session.User.ID) {
		return
	}
	if err := a.accounts.Store.DeleteAccount(r.Context(), session.User.ID); err != nil {
		a.internalError(w, r, err)
		return
	}
	a.hub.end(session.User.ID, "")
	a.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}
