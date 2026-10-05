package httpapi

import (
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"konspecter/server/internal/auth"
)

// Change events: GET /api/events is a Server-Sent Events stream that tells a
// client when to sync. It carries no note data; clients pull GET /api/sync.
const (
	// changesEvent is sent on connect and after the user's committed changes.
	changesEvent = "event: changes\ndata: {}\n\n"
	// pingComment keeps proxies and the connection alive between events.
	pingComment = ": ping\n\n"
	// defaultHeartbeat is how often a stream is pinged and its token re-checked.
	defaultHeartbeat = 25 * time.Second
	// streamWriteTimeout bounds each write, replacing the server's WriteTimeout
	// (which would otherwise end every stream after 30 s).
	streamWriteTimeout = time.Minute
	// maxStreamsPerUser bounds the open streams (tabs, devices) of one user.
	maxStreamsPerUser = 16
)

var (
	errTooManyStreams = errors.New("too many open event streams")
	errHubClosed      = errors.New("event streams are closed")
)

// hub fans a user's change notifications out to the user's open streams.
// Each subscriber has a buffer of one: a burst of changes arrives as one
// event, and publishers never block. A stream also ends at once when its
// device is disconnected or its account deleted.
type hub struct {
	mu     sync.Mutex
	users  map[string]map[*subscriber]struct{}
	closed bool
	done   chan struct{} // closed by close: every stream ends
}

// subscriber is one open stream.
type subscriber struct {
	deviceID string
	changed  chan struct{}
	ended    chan struct{} // closed by end
}

func newHub() *hub {
	return &hub{users: map[string]map[*subscriber]struct{}{}, done: make(chan struct{})}
}

// subscribe opens a stream for the user's device; unsubscribe must follow.
func (h *hub) subscribe(userID, deviceID string) (*subscriber, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, errHubClosed
	}
	streams := h.users[userID]
	if len(streams) >= maxStreamsPerUser {
		return nil, errTooManyStreams
	}
	if streams == nil {
		streams = map[*subscriber]struct{}{}
		h.users[userID] = streams
	}
	s := &subscriber{deviceID: deviceID, changed: make(chan struct{}, 1), ended: make(chan struct{})}
	streams[s] = struct{}{}
	return s, nil
}

func (h *hub) unsubscribe(userID string, s *subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.remove(userID, s)
}

func (h *hub) remove(userID string, s *subscriber) {
	delete(h.users[userID], s)
	if len(h.users[userID]) == 0 {
		delete(h.users, userID)
	}
}

// publish tells the user's streams that something changed.
func (h *hub) publish(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.users[userID] {
		select {
		case s.changed <- struct{}{}:
		default: // An event is already pending.
		}
	}
}

// end closes the streams of one of the user's devices, or with deviceID ""
// every stream of the user.
func (h *hub) end(userID, deviceID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.users[userID] {
		if deviceID == "" || s.deviceID == deviceID {
			close(s.ended)
			h.remove(userID, s)
		}
	}
}

// close ends every open stream and refuses new ones.
func (h *hub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.closed {
		h.closed = true
		close(h.done)
	}
}

// events streams change notifications to the device's user until the client
// leaves, the device is disconnected, a write fails or the server shuts down.
func (a *api) events(w http.ResponseWriter, r *http.Request, device auth.Device) {
	user := device.User
	stream, err := a.hub.subscribe(user.ID, device.ID)
	switch {
	case errors.Is(err, errTooManyStreams):
		writeError(w, http.StatusTooManyRequests, "too_many_streams", "too many open event streams; close some and retry")
		return
	case err != nil:
		writeError(w, http.StatusServiceUnavailable, "shutting_down", "the server is shutting down")
		return
	}
	defer a.hub.unsubscribe(user.ID, stream)

	token, _ := auth.BearerToken(r.Header.Get("Authorization"))
	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("X-Accel-Buffering", "no") // Tell reverse proxies (nginx) not to buffer.
	w.WriteHeader(http.StatusOK)

	send := func(message string) bool {
		if err := rc.SetWriteDeadline(time.Now().Add(streamWriteTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return false
		}
		if _, err := io.WriteString(w, message); err != nil {
			return false
		}
		return rc.Flush() == nil
	}

	if !send(changesEvent) {
		return
	}
	heartbeat := time.NewTicker(a.heartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-a.hub.done:
			return
		case <-stream.ended:
			return // Disconnected on the site: the next request hears why.
		case <-stream.changed:
			if !send(changesEvent) {
				return
			}
		case <-heartbeat.C:
			// Revoked from the command line, which this process does not hear of.
			current, err := a.auth.DeviceByToken(r.Context(), token)
			if err != nil && !errors.Is(err, auth.ErrUnauthorized) && !errors.Is(err, auth.ErrDeviceRevoked) && r.Context().Err() == nil {
				a.logger.WarnContext(r.Context(), "event stream: token check failed", "error", err)
			}
			if err != nil || current.ID != device.ID {
				return // Revoked (or unverifiable): the client must authenticate again.
			}
			if !send(pingComment) {
				return
			}
		}
	}
}
