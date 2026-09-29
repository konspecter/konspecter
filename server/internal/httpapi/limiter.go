package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// authFailuresPerMinute is how many failed authentications one client address
// may make per window before being refused. Tokens are 256-bit, so this is not
// about guessing them; it stops noisy or abusive clients cheaply.
const authFailuresPerMinute = 30

// failureLimiter counts failures per key in fixed windows.
type failureLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	now    func() time.Time
	counts map[string]*failureCount
}

type failureCount struct {
	n     int
	start time.Time
}

func newFailureLimiter(limit int, window time.Duration, now func() time.Time) *failureLimiter {
	return &failureLimiter{limit: limit, window: window, now: now, counts: map[string]*failureCount{}}
}

// blocked reports whether key is over the limit, and for how much longer.
func (l *failureLimiter) blocked(key string) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	c, ok := l.counts[key]
	if !ok {
		return 0, false
	}
	elapsed := l.now().Sub(c.start)
	if elapsed >= l.window {
		delete(l.counts, key)
		return 0, false
	}
	return l.window - elapsed, c.n >= l.limit
}

func (l *failureLimiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	c, ok := l.counts[key]
	if !ok || now.Sub(c.start) >= l.window {
		if len(l.counts) > 100_000 {
			l.counts = map[string]*failureCount{} // Bound memory under a flood.
		}
		l.counts[key] = &failureCount{n: 1, start: now}
		return
	}
	c.n++
}

// clientAddress is the connection's remote IP. Forwarded headers are not
// trusted: they are client-controlled unless a proxy sets them.
func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
