package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/devices"
)

// Connecting apps (RFC 8628, the OAuth device flow, over JSON). An app asks
// to be connected (authorize) and polls (token) while its owner approves its
// user code on the site's /activate page, signed in. The owner sees the
// connected devices on the site and can disconnect any of them: its token
// stops working and its event streams end at once.

func (a *api) registerDeviceRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/devices/authorize", a.deviceFlow(a.authorizeDevice))
	mux.Handle("POST /api/devices/token", a.deviceFlow(a.deviceToken))
	mux.Handle("GET /api/devices/pending", a.withSession(a.pendingDevice))
	mux.Handle("POST /api/devices/approve", a.withSession(a.decideDevice(true)))
	mux.Handle("POST /api/devices/deny", a.withSession(a.decideDevice(false)))
	mux.Handle("GET /api/devices", a.withSession(a.listDevices))
	mux.Handle("DELETE /api/devices/{id}", a.withSession(a.revokeDevice))
}

// deviceFlow guards the apps' side of the flow. The apps call from their own
// origins (CORS), so unlike the site's requests there is no Origin check:
// nothing here acts on a browser's cookies.
func (a *api) deviceFlow(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.accounts == nil || a.accounts.Devices == nil {
			writeError(w, http.StatusServiceUnavailable, "not_configured", "sign-in is not configured on this server")
			return
		}
		next(w, r)
	})
}

type deviceJSON struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Platform      string     `json:"platform"`
	ClientVersion string     `json:"client_version"`
	CreatedAt     time.Time  `json:"created_at"`
	LastUsedAt    *time.Time `json:"last_used_at"`
	LastSyncAt    *time.Time `json:"last_sync_at"`
}

func toDeviceJSON(d devices.Device) deviceJSON {
	return deviceJSON{
		ID: d.ID, Name: d.Name, Platform: d.Platform, ClientVersion: d.ClientVersion,
		CreatedAt: d.CreatedAt.UTC(), LastUsedAt: utc(d.LastUsedAt), LastSyncAt: utc(d.LastSyncAt),
	}
}

func clientJSON(c devices.Client) map[string]string {
	return map[string]string{"name": c.Name, "platform": c.Platform, "client_version": c.ClientVersion}
}

// authorizeDevice starts connecting an app: it returns the device code the
// app polls with and the user code its owner approves on the site.
func (a *api) authorizeDevice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		Platform      string `json:"platform"`
		ClientVersion string `json:"client_version"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.deviceIP, client}) {
		return
	}
	a.accounts.deviceIP.record(client)
	deviceCode, userCode, err := devices.NewCodes()
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	info := devices.NormalizeClient(devices.Client{Name: body.Name, Platform: body.Platform, ClientVersion: body.ClientVersion})
	expires := time.Now().Add(a.accounts.DeviceCodeTTL)
	hash := devices.HashCode(devices.NormalizeUserCode(userCode))
	if err := a.accounts.Devices.CreateDeviceAuthorization(r.Context(), devices.HashCode(deviceCode), hash, info, expires); err != nil {
		a.internalError(w, r, err)
		return
	}
	verification := a.accounts.PublicURL + "/activate"
	writeJSON(w, http.StatusOK, map[string]any{
		"device_code":               deviceCode,
		"user_code":                 userCode,
		"verification_uri":          verification,
		"verification_uri_complete": verification + "?code=" + url.QueryEscape(userCode),
		"expires_in":                int(a.accounts.DeviceCodeTTL.Seconds()),
		"interval":                  int(devices.Interval.Seconds()),
	})
}

// deviceToken is the app's poll. It answers 400 with the RFC's error codes
// until the owner decides; once approved, it returns the device's token.
func (a *api) deviceToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DeviceCode string `json:"device_code"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	token, tokenHash, err := auth.NewToken()
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	device, user, err := a.accounts.Devices.ExchangeDeviceCode(r.Context(), devices.HashCode(body.DeviceCode), tokenHash)
	switch {
	case errors.Is(err, devices.ErrAuthorizationPending):
		writeError(w, http.StatusBadRequest, "authorization_pending", "waiting for the owner to approve the device")
	case errors.Is(err, devices.ErrSlowDown):
		writeError(w, http.StatusBadRequest, "slow_down", "polling too often; wait 5 seconds longer between polls")
	case errors.Is(err, devices.ErrAccessDenied):
		writeError(w, http.StatusBadRequest, "access_denied", "the owner denied the device")
	case errors.Is(err, devices.ErrExpiredToken):
		writeError(w, http.StatusBadRequest, "expired_token", "the code has expired; start again")
	case err != nil:
		a.internalError(w, r, err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"token": token, "device": toDeviceJSON(device), "user": userJSON(user)})
	}
}

// userCodeOf reads a user code typed on the site. A wrong code counts as a
// failed attempt of the client's address: a signed-in visitor guessing
// codes could otherwise connect a stranger's app to their account.
func (a *api) userCodeOf(w http.ResponseWriter, r *http.Request, input string) ([]byte, bool) {
	client := clientAddress(r, a.trusted)
	if rateLimited(w, limitCheck{a.accounts.loginIP, client}) {
		return nil, false
	}
	code := devices.NormalizeUserCode(input)
	if code == "" {
		a.accounts.loginIP.record(client)
		writeError(w, http.StatusNotFound, "invalid_user_code", "no device is waiting for this code")
		return nil, false
	}
	return devices.HashCode(code), true
}

func (a *api) userCodeError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, devices.ErrInvalidUserCode) {
		a.accounts.loginIP.record(clientAddress(r, a.trusted))
		writeError(w, http.StatusNotFound, "invalid_user_code", "no device is waiting for this code")
		return
	}
	a.internalError(w, r, err)
}

// pendingDevice tells /activate which app waits under a user code.
func (a *api) pendingDevice(w http.ResponseWriter, r *http.Request, _ auth.User) {
	hash, ok := a.userCodeOf(w, r, r.URL.Query().Get("user_code"))
	if !ok {
		return
	}
	info, err := a.accounts.Devices.PendingDeviceAuthorization(r.Context(), hash)
	if err != nil {
		a.userCodeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"device": clientJSON(info)})
}

// decideDevice approves the app waiting under a user code for the signed-in
// user, or denies it.
func (a *api) decideDevice(approve bool) userHandler {
	return func(w http.ResponseWriter, r *http.Request, user auth.User) {
		var body struct {
			UserCode string `json:"user_code"`
		}
		if !a.decode(w, r, &body) {
			return
		}
		hash, ok := a.userCodeOf(w, r, body.UserCode)
		if !ok {
			return
		}
		info, err := a.accounts.Devices.DecideDeviceAuthorization(r.Context(), hash, user.ID, approve)
		if err != nil {
			a.userCodeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"device": clientJSON(info)})
	}
}

func (a *api) listDevices(w http.ResponseWriter, r *http.Request, user auth.User) {
	list, err := a.accounts.Devices.ListDevices(r.Context(), user.ID)
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	out := make([]deviceJSON, 0, len(list))
	for _, d := range list {
		out = append(out, toDeviceJSON(d))
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out})
}

// revokeDevice disconnects a device: its token stops working and its open
// event streams end now. Its app keeps every note; it only stops syncing.
func (a *api) revokeDevice(w http.ResponseWriter, r *http.Request, user auth.User) {
	id := r.PathValue("id")
	if !devices.ValidID(id) {
		writeError(w, http.StatusNotFound, "not_found", "device not found")
		return
	}
	err := a.accounts.Devices.RevokeDevice(r.Context(), user.ID, id)
	if errors.Is(err, devices.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "device not found")
		return
	}
	if err != nil {
		a.internalError(w, r, err)
		return
	}
	a.hub.end(user.ID, id)
	w.WriteHeader(http.StatusNoContent)
}
