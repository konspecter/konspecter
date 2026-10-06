package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/devices"
)

func TestTheAccountAndItsName(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")

	res := siteCall(t, s.server.URL, http.MethodGet, "/api/account", session, nil)
	if res.status != http.StatusOK || res.body["email"] != "ann@example.com" || res.body["name"] != "" || res.body["recent_sign_in"] != true {
		t.Fatalf("account = %d %v", res.status, res.body)
	}
	res = siteCall(t, s.server.URL, http.MethodPatch, "/api/account", session, map[string]any{"name": "  Ann Lee  "})
	if res.status != http.StatusOK || res.body["name"] != "Ann Lee" {
		t.Errorf("rename = %d %v", res.status, res.body)
	}
	// The site's header greets the account by the name.
	if res := siteCall(t, s.server.URL, http.MethodGet, "/api/me", session, nil); res.body["name"] != "Ann Lee" {
		t.Errorf("me after rename = %d %v", res.status, res.body)
	}
	for _, bad := range []map[string]any{{"name": strings.Repeat("a", accounts.MaxNameLength+1)}, {"name": "Ann\nLee"}} {
		if res := siteCall(t, s.server.URL, http.MethodPatch, "/api/account", session, bad); res.status != http.StatusBadRequest || errorCode(res) != "invalid_name" {
			t.Errorf("rename to %q = %d %v", bad["name"], res.status, res.body)
		}
	}
	if res := siteCall(t, s.server.URL, http.MethodPatch, "/api/account", session, map[string]any{}); errorCode(res) != "invalid_request" {
		t.Errorf("rename without a name = %v", res.body)
	}
	if res := siteCall(t, s.server.URL, http.MethodGet, "/api/account", nil, nil); res.status != http.StatusUnauthorized {
		t.Errorf("account without a session = %d", res.status)
	}
}

func TestDeletingTheAccount(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	s.devices.add("ksp_ann_phone", s.store.users["ann@example.com"].user, devices.Client{Name: "Phone", Platform: "android"})
	stream := openStreamWithHeartbeat(t, s, "ksp_ann_phone")

	if res := siteCall(t, s.server.URL, http.MethodDelete, "/api/account", session, map[string]any{"email": "bob@example.com"}); res.status != http.StatusBadRequest || errorCode(res) != "email_mismatch" {
		t.Errorf("with another address = %d %v", res.status, res.body)
	}
	res := siteCall(t, s.server.URL, http.MethodDelete, "/api/account", session, map[string]any{"email": " Ann@Example.com "})
	if res.status != http.StatusNoContent || !strings.Contains(res.header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("delete = %d %v %q", res.status, res.body, res.header.Get("Set-Cookie"))
	}
	if !stream.ends() {
		t.Error("the account's streams are still open")
	}
	if res := call(t, s.server, http.MethodGet, "/api/sync", "ksp_ann_phone", ""); res.status != http.StatusUnauthorized {
		t.Errorf("the app after deletion = %d", res.status)
	}
	if res := siteCall(t, s.server.URL, http.MethodGet, "/api/account", session, nil); res.status != http.StatusUnauthorized {
		t.Errorf("the session after deletion = %d", res.status)
	}
	if _, ok := s.store.users["ann@example.com"]; ok {
		t.Error("the account is still there")
	}
}

func TestDeletingNeedsARecentSignIn(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	s.store.signedInAgo(accounts.RecentSignIn + time.Minute)

	if res := siteCall(t, s.server.URL, http.MethodGet, "/api/account", session, nil); res.body["recent_sign_in"] != false {
		t.Errorf("account = %v", res.body)
	}
	res := siteCall(t, s.server.URL, http.MethodDelete, "/api/account", session, map[string]any{"email": "ann@example.com"})
	if res.status != http.StatusForbidden || errorCode(res) != "reauthentication_required" {
		t.Errorf("delete = %d %v", res.status, res.body)
	}
	if _, ok := s.store.users["ann@example.com"]; !ok {
		t.Error("the account was deleted")
	}
}

func TestAccountChangesMustComeFromTheSite(t *testing.T) {
	s := newAccountServer(t, nil)
	session := signedIn(t, s, "ann@example.com")
	res := callWithCookie(t, s.server, http.MethodDelete, "/api/account", session, "https://evil.example")
	if res.status != http.StatusForbidden || errorCode(res) != "forbidden_origin" {
		t.Errorf("delete from another site = %d %v", res.status, res.body)
	}
}
