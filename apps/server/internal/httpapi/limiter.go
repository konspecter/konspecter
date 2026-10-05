package httpapi

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// authFailuresPerMinute is how many failed authentications one client address
// may make per window before being refused. Tokens are 256-bit, so this is not
// about guessing them; it stops noisy or abusive clients cheaply.
const authFailuresPerMinute = 30

// windowLimiter counts events (failed sign-ins, emails sent) per key in
// fixed windows and refuses a key once it reaches the limit.
type windowLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	now    func() time.Time
	counts map[string]*windowCount
}

type windowCount struct {
	n     int
	start time.Time
}

func newWindowLimiter(limit int, window time.Duration, now func() time.Time) *windowLimiter {
	return &windowLimiter{limit: limit, window: window, now: now, counts: map[string]*windowCount{}}
}

// blocked reports whether key is over the limit, and for how much longer.
func (l *windowLimiter) blocked(key string) (time.Duration, bool) {
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

// record counts one event for key.
func (l *windowLimiter) record(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	c, ok := l.counts[key]
	if !ok || now.Sub(c.start) >= l.window {
		if len(l.counts) > 100_000 {
			l.counts = map[string]*windowCount{} // Bound memory under a flood.
		}
		l.counts[key] = &windowCount{n: 1, start: now}
		return
	}
	c.n++
}

// clientAddress is the client's IP: the connection's remote address, or,
// when that is a trusted proxy (the reverse proxy, the site's server), the
// nearest address in X-Forwarded-For that is not a trusted proxy. Forwarded
// headers from anyone else are ignored: clients can write them.
func clientAddress(r *http.Request, trusted []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil || !isTrusted(remote, trusted) {
		return host
	}
	var chain []string
	for _, header := range r.Header.Values("X-Forwarded-For") {
		chain = append(chain, strings.Split(header, ",")...)
	}
	client := host
	for i := len(chain) - 1; i >= 0; i-- {
		addr, err := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if err != nil {
			break // A malformed hop: stop at the last good one.
		}
		client = addr.Unmap().String()
		if !isTrusted(addr, trusted) {
			break
		}
	}
	return client
}

func isTrusted(addr netip.Addr, trusted []netip.Prefix) bool {
	addr = addr.Unmap()
	for _, prefix := range trusted {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}
