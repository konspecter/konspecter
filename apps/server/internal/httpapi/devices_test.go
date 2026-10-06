package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// signedIn returns the session cookie of a new account.
func signedIn(t *testing.T, s accountSetup, email string) *http.Cookie {
	t.Helper()
	s.store.addUser(email, "secret password")
	res := newBrowser(t, s.server).post("/api/auth/login", map[string]any{"email": email, "password": "secret password"})
	if res.status != http.StatusOK {
		t.Fatalf("login = %d %v", res.status, res.body)
	}
	return sessionFrom(t, res)
}

// siteCall sends a request of the site's pages: the session cookie, the
// site's Origin and a JSON body.
func siteCall(t *testing.T, server string, method, path string, cookie *http.Cookie, body any) response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, server+path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	req.Header.Set("Origin", site)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	_ = json.Unmarshal(data, &decoded)
	return response{status: res.StatusCode, header: res.Header, body: decoded}
}

// appCall sends a request of an app: its own origin, JSON, maybe a token.
func appCall(t *testing.T, server, method, path, token string, body any) response {
	t.Helper()
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, server+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.example.com")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	var decoded map[string]any
	_ = json.Unmarshal(out, &decoded)
	return response{status: res.StatusCode, header: res.Header, body: decoded}
}

func authorize(t *testing.T, s accountSetup) (deviceCode, userCode string) {
	t.Helper()
	res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/authorize", "", map[string]any{
		"name": "Firefox on Linux", "platform": "linux", "client_version": "0.2.0",
	})
	if res.status != http.StatusOK {
		t.Fatalf("authorize = %d %v", res.status, res.body)
	}
	deviceCode, _ = res.body["device_code"].(string)
	userCode, _ = res.body["user_code"].(string)
	return deviceCode, userCode
}

func poll(t *testing.T, s accountSetup, deviceCode string) response {
	t.Helper()
	s.devices.forgetPolls()
	return appCall(t, s.server.URL, http.MethodPost, "/api/devices/token", "", map[string]any{"device_code": deviceCode})
}

func TestConnectingAnAppThroughTheBrowser(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")

	res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/authorize", "", map[string]any{
		"name": "Firefox on Linux", "platform": "linux", "client_version": "0.2.0",
	})
	if res.status != http.StatusOK {
		t.Fatalf("authorize = %d %v", res.status, res.body)
	}
	userCode, _ := res.body["user_code"].(string)
	deviceCode, _ := res.body["device_code"].(string)
	if res.body["verification_uri"] != site+"/activate" ||
		res.body["verification_uri_complete"] != site+"/activate?code="+url.QueryEscape(userCode) ||
		res.body["expires_in"] != float64(600) || res.body["interval"] != float64(5) ||
		!strings.HasPrefix(deviceCode, "ksd_") || len(userCode) != 9 {
		t.Errorf("authorize = %v", res.body)
	}
	// The apps call from their own origin.
	if res.header.Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Errorf("CORS = %q", res.header.Get("Access-Control-Allow-Origin"))
	}

	if res := poll(t, s, deviceCode); res.status != http.StatusBadRequest || errorCode(res) != "authorization_pending" {
		t.Errorf("before approval = %d %v", res.status, res.body)
	}
	res = appCall(t, s.server.URL, http.MethodPost, "/api/devices/token", "", map[string]any{"device_code": deviceCode})
	if errorCode(res) != "slow_down" {
		t.Errorf("polling at once = %v", res.body)
	}

	// The owner sees the app, typed in lower case, and approves it.
	lower := strings.ToLower(strings.ReplaceAll(userCode, "-", " "))
	pending := siteCall(t, s.server.URL, http.MethodGet, "/api/devices/pending?user_code="+url.QueryEscape(lower), session, nil)
	device, _ := pending.body["device"].(map[string]any)
	if pending.status != http.StatusOK || device["name"] != "Firefox on Linux" || device["platform"] != "linux" || device["client_version"] != "0.2.0" {
		t.Fatalf("pending = %d %v", pending.status, pending.body)
	}
	if res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", session, map[string]any{"user_code": userCode}); res.status != http.StatusOK {
		t.Fatalf("approve = %d %v", res.status, res.body)
	}

	res = poll(t, s, deviceCode)
	token, _ := res.body["token"].(string)
	user, _ := res.body["user"].(map[string]any)
	connected, _ := res.body["device"].(map[string]any)
	if res.status != http.StatusOK || !strings.HasPrefix(token, "ksp_") || user["email"] != "ann@example.com" || connected["name"] != "Firefox on Linux" {
		t.Fatalf("token = %d %v", res.status, res.body)
	}
	s.devices.connectToken(token)
	if res := call(t, s.server, http.MethodGet, "/api/me", token, ""); res.status != http.StatusOK || res.body["email"] != "ann@example.com" {
		t.Errorf("me with the new token = %d %v", res.status, res.body)
	}
	if res := poll(t, s, deviceCode); errorCode(res) != "expired_token" {
		t.Errorf("the code again = %v", res.body)
	}
}

func TestDenyingAnApp(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	deviceCode, userCode := authorize(t, s)
	if res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/deny", session, map[string]any{"user_code": userCode}); res.status != http.StatusOK {
		t.Fatalf("deny = %d %v", res.status, res.body)
	}
	if res := poll(t, s, deviceCode); errorCode(res) != "access_denied" {
		t.Errorf("after denial = %v", res.body)
	}
	if res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", session, map[string]any{"user_code": userCode}); errorCode(res) != "invalid_user_code" {
		t.Errorf("approving after denial = %v", res.body)
	}
}

func TestAnExpiredRequestToConnect(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	deviceCode, userCode := authorize(t, s)
	s.devices.expire()
	if res := siteCall(t, s.server.URL, http.MethodGet, "/api/devices/pending?user_code="+userCode, session, nil); res.status != http.StatusNotFound || errorCode(res) != "invalid_user_code" {
		t.Errorf("pending = %d %v", res.status, res.body)
	}
	if res := poll(t, s, deviceCode); errorCode(res) != "expired_token" {
		t.Errorf("poll = %v", res.body)
	}
	if res := poll(t, s, "ksd_unknown"); errorCode(res) != "expired_token" {
		t.Errorf("unknown code = %v", res.body)
	}
}

func TestApprovingNeedsTheSiteAndASession(t *testing.T) {
	s := newAccountServer(t, nil)
	_, userCode := authorize(t, s)
	if res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", nil, map[string]any{"user_code": userCode}); res.status != http.StatusUnauthorized {
		t.Errorf("without a session = %d", res.status)
	}
	res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", "", map[string]any{"user_code": userCode})
	if res.status != http.StatusForbidden || errorCode(res) != "forbidden_origin" {
		t.Errorf("from another origin = %d %v", res.status, res.body)
	}
	// A bearer token is no session either.
	if res := appCall(t, s.server.URL, http.MethodGet, "/api/devices", adaToken, nil); res.status != http.StatusUnauthorized {
		t.Errorf("devices with a token = %d", res.status)
	}
}

func TestGuessingUserCodesIsRateLimited(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) { a.Rates.LoginFailuresPerIP = 2 })
	session := signedIn(t, s, "ann@example.com")
	for _, code := range []string{"BCDF-GHJK", "not a code"} {
		if res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", session, map[string]any{"user_code": code}); errorCode(res) != "invalid_user_code" {
			t.Fatalf("guess %q = %v", code, res.body)
		}
	}
	_, userCode := authorize(t, s)
	res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", session, map[string]any{"user_code": userCode})
	if res.status != http.StatusTooManyRequests {
		t.Errorf("after two wrong codes = %d %v", res.status, res.body)
	}
}

func TestRequestsToConnectAreRateLimited(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) { a.Rates.DeviceRequestsPerIP = 1 })
	authorize(t, s)
	res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/authorize", "", map[string]any{})
	if res.status != http.StatusTooManyRequests {
		t.Errorf("second request = %d %v", res.status, res.body)
	}
}

func TestTheDeviceFlowIsOffWithoutAccounts(t *testing.T) {
	server, _ := newTestServer(t)
	res := appCall(t, server.URL, http.MethodPost, "/api/devices/authorize", "", map[string]any{})
	if res.status != http.StatusServiceUnavailable || errorCode(res) != "not_configured" {
		t.Errorf("authorize = %d %v", res.status, res.body)
	}
}

func TestListingAndDisconnectingDevices(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	deviceCode, userCode := authorize(t, s)
	siteCall(t, s.server.URL, http.MethodPost, "/api/devices/approve", session, map[string]any{"user_code": userCode})
	token, _ := poll(t, s, deviceCode).body["token"].(string)
	s.devices.connectToken(token)
	call(t, s.server, http.MethodGet, "/api/sync", token, "")

	res := siteCall(t, s.server.URL, http.MethodGet, "/api/devices", session, nil)
	list, _ := res.body["devices"].([]any)
	if res.status != http.StatusOK || len(list) != 1 {
		t.Fatalf("devices = %d %v", res.status, res.body)
	}
	device, _ := list[0].(map[string]any)
	id, _ := device["id"].(string)
	if device["name"] != "Firefox on Linux" || device["last_used_at"] == nil || device["last_sync_at"] == nil {
		t.Errorf("device = %v", device)
	}

	stream := openStreamWithHeartbeat(t, s, token)
	if res := siteCall(t, s.server.URL, http.MethodDelete, "/api/devices/"+id, session, nil); res.status != http.StatusNoContent {
		t.Fatalf("disconnect = %d %v", res.status, res.body)
	}
	if !stream.ends() {
		t.Error("the device's stream is still open")
	}
	res = call(t, s.server, http.MethodGet, "/api/sync", token, "")
	if res.status != http.StatusUnauthorized || errorCode(res) != "device_revoked" {
		t.Errorf("sync after disconnecting = %d %v", res.status, res.body)
	}
	if res := siteCall(t, s.server.URL, http.MethodDelete, "/api/devices/"+id, session, nil); res.status != http.StatusNotFound {
		t.Errorf("disconnecting twice = %d", res.status)
	}
	if res := siteCall(t, s.server.URL, http.MethodDelete, "/api/devices/not-a-uuid", session, nil); res.status != http.StatusNotFound {
		t.Errorf("a malformed id = %d", res.status)
	}
	// Another user's device is not this user's to disconnect.
	ada, _ := s.devices.DeviceByToken(t.Context(), adaToken)
	if res := siteCall(t, s.server.URL, http.MethodDelete, "/api/devices/"+ada.ID, session, nil); res.status != http.StatusNotFound {
		t.Errorf("another user's device = %d", res.status)
	}
}

// openStreamWithHeartbeat opens an event stream and reads its first event.
// The heartbeat is the default 25 s, so only the hub can end it in time.
func openStreamWithHeartbeat(t *testing.T, s accountSetup, token string) *eventStream {
	t.Helper()
	stream := openStream(t, s.server, token)
	if stream.res.StatusCode != http.StatusOK {
		t.Fatalf("stream = %d", stream.res.StatusCode)
	}
	stream.next(t)
	return stream
}

func TestConnectingAnAppByQRCode(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")

	res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/connect-codes", session, nil)
	code, _ := res.body["code"].(string)
	if res.status != http.StatusOK || !strings.HasPrefix(code, "ksc_") || res.body["url"] != site+"/connect#"+code || res.body["expires_in"] != float64(300) {
		t.Fatalf("connect code = %d %v", res.status, res.body)
	}

	res = appCall(t, s.server.URL, http.MethodPost, "/api/devices/connect", "", map[string]any{
		"code": code, "name": "Konspecter for Android", "platform": "android", "client_version": "0.3.0",
	})
	token, _ := res.body["token"].(string)
	user, _ := res.body["user"].(map[string]any)
	device, _ := res.body["device"].(map[string]any)
	if res.status != http.StatusOK || !strings.HasPrefix(token, "ksp_") || user["email"] != "ann@example.com" || device["platform"] != "android" {
		t.Fatalf("connect = %d %v", res.status, res.body)
	}
	if res.header.Get("Access-Control-Allow-Origin") != "https://app.example.com" {
		t.Errorf("CORS = %q", res.header.Get("Access-Control-Allow-Origin"))
	}
	s.devices.connectToken(token)
	if res := call(t, s.server, http.MethodGet, "/api/me", token, ""); res.status != http.StatusOK || res.body["email"] != "ann@example.com" {
		t.Errorf("me with the new token = %d %v", res.status, res.body)
	}

	// A code works once.
	res = appCall(t, s.server.URL, http.MethodPost, "/api/devices/connect", "", map[string]any{"code": code})
	if res.status != http.StatusBadRequest || errorCode(res) != "invalid_connect_code" {
		t.Errorf("the code again = %d %v", res.status, res.body)
	}
}

func TestANewConnectCodeReplacesTheOldAndCodesExpire(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	first, _ := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/connect-codes", session, nil).body["code"].(string)
	second, _ := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/connect-codes", session, nil).body["code"].(string)
	if res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/connect", "", map[string]any{"code": first}); errorCode(res) != "invalid_connect_code" {
		t.Errorf("the replaced code = %v", res.body)
	}
	s.devices.expireConnectCodes()
	if res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/connect", "", map[string]any{"code": second}); errorCode(res) != "invalid_connect_code" {
		t.Errorf("an expired code = %v", res.body)
	}
}

func TestConnectCodesNeedASessionAndGuessesAreLimited(t *testing.T) {
	s := newAccountServer(t, func(a *Accounts) { a.Rates.DeviceRequestsPerIP = 2 })
	if res := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/connect-codes", nil, nil); res.status != http.StatusUnauthorized {
		t.Errorf("without a session = %d", res.status)
	}
	for _, code := range []string{"ksc_" + strings.Repeat("a", 32), "not a code"} {
		if res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/connect", "", map[string]any{"code": code}); errorCode(res) != "invalid_connect_code" {
			t.Fatalf("guess %q = %v", code, res.body)
		}
	}
	session := signedIn(t, s, "ann@example.com")
	code, _ := siteCall(t, s.server.URL, http.MethodPost, "/api/devices/connect-codes", session, nil).body["code"].(string)
	if res := appCall(t, s.server.URL, http.MethodPost, "/api/devices/connect", "", map[string]any{"code": code}); res.status != http.StatusTooManyRequests {
		t.Errorf("after two wrong codes = %d %v", res.status, res.body)
	}
}
