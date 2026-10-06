package entitlements

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetch(t *testing.T) {
	var asked []string
	answer := `{"user_id":"u1","status":"active","until":"2026-11-09T12:00:00Z","version":7}`
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(answer))
	}))
	defer service.Close()
	client := &Client{BaseURL: service.URL + "/", Token: "secret"}

	e, err := client.Fetch(context.Background(), "u1", true)
	if err != nil {
		t.Fatal(err)
	}
	if e.UserID != "u1" || e.Status != Active || !e.Until.Equal(time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)) || e.Version != 7 {
		t.Errorf("entitlement = %+v", e)
	}
	if _, err := client.Fetch(context.Background(), "u1", false); err != nil {
		t.Fatal(err)
	}
	if asked[0] != "GET /internal/entitlements/u1?start_trial=1 Bearer secret" || asked[1] != "GET /internal/entitlements/u1 Bearer secret" {
		t.Errorf("asked = %v", asked)
	}
	for _, bad := range []string{
		`{"user_id":"u2","status":"active","until":"2026-11-09T12:00:00Z","version":7}`,
		`{"user_id":"u1","status":"paused","until":"2026-11-09T12:00:00Z","version":7}`,
		`{"user_id":"u1","status":"active","version":7}`,
		`not json`,
	} {
		answer = bad
		if _, err := client.Fetch(context.Background(), "u1", false); err == nil {
			t.Errorf("took %s", bad)
		}
	}
}

func TestForget(t *testing.T) {
	status := http.StatusNoContent
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/internal/users/u1" {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(status)
	}))
	defer service.Close()
	client := &Client{BaseURL: service.URL, Token: "secret"}
	if err := client.Forget(context.Background(), "u1"); err != nil {
		t.Errorf("forget = %v", err)
	}
	status = http.StatusBadGateway
	if err := client.Forget(context.Background(), "u1"); !errors.Is(err, ErrGateway) {
		t.Errorf("gateway down = %v", err)
	}
	status = http.StatusInternalServerError
	if err := client.Forget(context.Background(), "u1"); err == nil || errors.Is(err, ErrGateway) {
		t.Errorf("service failed = %v", err)
	}
	service.Close()
	if err := client.Forget(context.Background(), "u1"); err == nil {
		t.Error("forgot with the service gone")
	}
}
