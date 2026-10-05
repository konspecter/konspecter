package httpapi

import (
	"bufio"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// wait bounds every expectation on a stream.
const wait = 2 * time.Second

type eventStream struct {
	res    *http.Response
	frames <-chan string // each event or comment, blank line included; closed at the end
	cancel context.CancelFunc
}

// openStream opens GET /api/events. On 200 its frames are read in the
// background until the stream ends or the test finishes.
func openStream(t *testing.T, server *httptest.Server, token string) *eventStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := server.Client().Do(req)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		res.Body.Close()
	})
	frames := make(chan string)
	s := &eventStream{res: res, frames: frames, cancel: cancel}
	if res.StatusCode != http.StatusOK {
		close(frames)
		return s
	}
	go func() {
		defer close(frames)
		scanner := bufio.NewScanner(res.Body)
		var frame strings.Builder
		for scanner.Scan() {
			frame.WriteString(scanner.Text() + "\n")
			if scanner.Text() != "" {
				continue
			}
			select {
			case frames <- frame.String():
			case <-ctx.Done():
				return
			}
			frame.Reset()
		}
	}()
	return s
}

func (s *eventStream) next(t *testing.T) string {
	t.Helper()
	select {
	case frame, ok := <-s.frames:
		if !ok {
			t.Fatal("stream ended")
		}
		return frame
	case <-time.After(wait):
		t.Fatal("no frame")
	}
	return ""
}

// nextEvent skips heartbeats to the next event.
func (s *eventStream) nextEvent(t *testing.T) string {
	t.Helper()
	for {
		if frame := s.next(t); frame != pingComment {
			return frame
		}
	}
}

// ends reports whether the server ends the stream, skipping frames.
func (s *eventStream) ends() bool {
	timeout := time.After(wait)
	for {
		select {
		case _, ok := <-s.frames:
			if !ok {
				return true
			}
		case <-timeout:
			return false
		}
	}
}

func streams(h *Handler, userID string) int {
	h.hub.mu.Lock()
	defer h.hub.mu.Unlock()
	return len(h.hub.users[userID])
}

func TestEventStreamStartsWithAChangesEvent(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{})
	s := openStream(t, server, adaToken)
	for header, want := range map[string]string{
		"Content-Type":      "text/event-stream",
		"Cache-Control":     "no-store",
		"X-Accel-Buffering": "no",
	} {
		if got := s.res.Header.Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if s.res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", s.res.StatusCode)
	}
	if frame := s.next(t); frame != changesEvent {
		t.Errorf("first frame = %q, want %q", frame, changesEvent)
	}
}

func TestEventStreamRequiresAToken(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{})
	if r := call(t, server, "GET", "/api/events", "ksp_unknown", ""); r.status != http.StatusUnauthorized {
		t.Errorf("status = %d", r.status)
	}
}

func TestEventStreamAnnouncesChangesOfTheUserOnly(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{heartbeat: 30 * time.Millisecond})
	ada := openStream(t, server, adaToken)
	bob := openStream(t, server, bobToken)
	ada.nextEvent(t)
	bob.nextEvent(t)

	changes := []struct{ method, path, body string }{
		{"POST", "/api/notes", `{"id":"n1","markdown":"v1"}`},
		{"PUT", "/api/notes/n1", `{"markdown":"v2","base_revision":1}`},
		{"DELETE", "/api/notes/n1?base_revision=2", ""},
	}
	for _, c := range changes {
		if r := call(t, server, c.method, c.path, adaToken, c.body); r.status >= 300 {
			t.Fatalf("%s %s = %d %v", c.method, c.path, r.status, r.body)
		}
		if frame := ada.nextEvent(t); frame != changesEvent {
			t.Errorf("after %s: %q", c.method, frame)
		}
	}
	// Failed changes announce nothing; Bob hears only heartbeats.
	if r := call(t, server, "PUT", "/api/notes/n1", adaToken, `{"markdown":"stale","base_revision":1}`); r.status != http.StatusConflict {
		t.Fatalf("stale update = %d", r.status)
	}
	for range 3 {
		if frame := bob.next(t); frame != pingComment {
			t.Fatalf("Bob got %q", frame)
		}
	}
}

func TestEventStreamHeartbeat(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{heartbeat: 10 * time.Millisecond})
	s := openStream(t, server, adaToken)
	s.next(t)
	for range 2 {
		if frame := s.next(t); frame != pingComment {
			t.Errorf("frame = %q, want %q", frame, pingComment)
		}
	}
}

func TestEventStreamEndsWhenTheTokenIsRevoked(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{heartbeat: 10 * time.Millisecond})
	bob := openStream(t, server, bobToken)
	ada := openStream(t, server, adaToken)
	bob.next(t)
	ada.next(t)
	if r := call(t, server, "DELETE", "/api/tokens/current", bobToken, ""); r.status != http.StatusNoContent {
		t.Fatalf("revoke = %d", r.status)
	}
	if !bob.ends() {
		t.Error("stream of a revoked token is still open")
	}
	if frame := ada.next(t); frame != pingComment {
		t.Errorf("another user's stream: %q", frame)
	}
}

func TestEventStreamsPerUserAreLimited(t *testing.T) {
	server, _, _ := newTestServerWith(t, Options{})
	for range maxStreamsPerUser {
		openStream(t, server, adaToken).next(t)
	}
	extra := openStream(t, server, adaToken)
	if extra.res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("stream %d: status %d", maxStreamsPerUser+1, extra.res.StatusCode)
	}
	r := call(t, server, "GET", "/api/events", adaToken, "")
	if errorCode(r) != "too_many_streams" {
		t.Errorf("error = %v", r.body)
	}
	openStream(t, server, bobToken).next(t) // Other users are not affected.
}

func TestEventStreamEndsWhenTheClientLeaves(t *testing.T) {
	server, _, handler := newTestServerWith(t, Options{})
	s := openStream(t, server, adaToken)
	s.next(t)
	if n := streams(handler, "user-ada"); n != 1 {
		t.Fatalf("open streams = %d", n)
	}
	s.cancel()
	deadline := time.Now().Add(wait)
	for streams(handler, "user-ada") != 0 {
		if time.Now().After(deadline) {
			t.Fatal("the handler kept the stream after the client left")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCloseStreamsEndsOpenStreams(t *testing.T) {
	server, _, handler := newTestServerWith(t, Options{})
	s := openStream(t, server, adaToken)
	s.next(t)
	handler.CloseStreams()
	if !s.ends() {
		t.Fatal("stream still open after CloseStreams")
	}
	if r := call(t, server, "GET", "/api/events", adaToken, ""); r.status != http.StatusServiceUnavailable || errorCode(r) != "shutting_down" {
		t.Errorf("stream after close = %d %v", r.status, r.body)
	}
}

// The server's read and write timeouts must not end a stream.
func TestEventStreamOutlivesServerTimeouts(t *testing.T) {
	handler, _ := newTestHandler(Options{heartbeat: 20 * time.Millisecond})
	server := httptest.NewUnstartedServer(handler)
	server.Config.ReadTimeout = 100 * time.Millisecond
	server.Config.WriteTimeout = 100 * time.Millisecond
	server.Start()
	t.Cleanup(server.Close)
	t.Cleanup(handler.CloseStreams)

	s := openStream(t, server, adaToken)
	s.next(t)
	for start := time.Now(); time.Since(start) < 400*time.Millisecond; {
		if frame := s.next(t); frame != pingComment {
			t.Fatalf("frame = %q", frame)
		}
	}
}

func TestHub(t *testing.T) {
	h := newHub()
	ada, err := h.subscribe("ada", "laptop")
	if err != nil {
		t.Fatal(err)
	}
	bob, _ := h.subscribe("bob", "phone")

	h.publish("ada")
	h.publish("ada") // Coalesced, and never blocks.
	if len(ada.changed) != 1 || len(bob.changed) != 0 {
		t.Errorf("pending: ada %d, bob %d", len(ada.changed), len(bob.changed))
	}

	for range maxStreamsPerUser - 1 {
		if _, err := h.subscribe("ada", "laptop"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.subscribe("ada", "laptop"); !errors.Is(err, errTooManyStreams) {
		t.Errorf("over the limit: %v", err)
	}
	h.unsubscribe("ada", ada)
	if _, err := h.subscribe("ada", "laptop"); err != nil {
		t.Errorf("after unsubscribe: %v", err)
	}

	h.close()
	h.close()
	select {
	case <-h.done:
	default:
		t.Error("done not closed")
	}
	if _, err := h.subscribe("carol", "tablet"); !errors.Is(err, errHubClosed) {
		t.Errorf("after close: %v", err)
	}
}

func TestHubEndsTheStreamsOfADeviceOrAUser(t *testing.T) {
	h := newHub()
	laptop, _ := h.subscribe("ada", "laptop")
	phone, _ := h.subscribe("ada", "phone")
	bob, _ := h.subscribe("bob", "phone")

	h.end("ada", "laptop")
	if !closed(laptop.ended) || closed(phone.ended) || closed(bob.ended) {
		t.Error("ending ada's laptop ended other streams, or not it")
	}
	h.unsubscribe("ada", laptop) // After end: harmless.
	h.end("ada", "")
	if !closed(phone.ended) || closed(bob.ended) {
		t.Error("ending ada's streams")
	}
	if len(h.users["ada"]) != 0 || len(h.users["bob"]) != 1 {
		t.Errorf("streams left: %v", h.users)
	}
}

func closed(ch chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}
