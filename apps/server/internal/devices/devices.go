// Package devices holds the rules for connecting apps to an account: the
// device authorization codes (modelled on RFC 8628, the OAuth device flow),
// what an app says about itself, and the device records the owner sees.
//
// An app asks for a pair of codes. It keeps the device code and polls with
// it; its owner approves the user code on the site, signed in. The next poll
// then gets the device's API token. Storage and HTTP live elsewhere.
package devices

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// The outcomes of polling with a device code (RFC 8628 section 3.5).
var (
	// ErrAuthorizationPending: the owner has not decided yet.
	ErrAuthorizationPending = errors.New("authorization_pending")
	// ErrSlowDown: the app polls faster than the interval.
	ErrSlowDown = errors.New("slow_down")
	// ErrAccessDenied: the owner denied the device.
	ErrAccessDenied = errors.New("access_denied")
	// ErrExpiredToken: the code expired, was used, or never existed.
	ErrExpiredToken = errors.New("expired_token")
)

// ErrInvalidUserCode means no pending authorization has that user code.
var ErrInvalidUserCode = errors.New("invalid user code")

// ErrNotFound means the account has no such (connected) device.
var ErrNotFound = errors.New("device not found")

// ValidID reports whether id can be a device's id (a UUID).
func ValidID(id string) bool { return idPattern.MatchString(id) }

var idPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Interval is how often an app may poll, at most.
const Interval = 5 * time.Second

// Client is what an app says about itself when it asks to be connected.
type Client struct {
	Name          string
	Platform      string
	ClientVersion string
}

// Device is an app connected to an account.
type Device struct {
	ID            string
	Name          string
	Platform      string
	ClientVersion string
	CreatedAt     time.Time
	// LastUsedAt is its last request (kept to the minute); nil if none yet.
	LastUsedAt *time.Time
	// LastSyncAt is its last pull of changes (kept to the minute); nil if none yet.
	LastSyncAt *time.Time
}

// Platforms the apps report; anything else is "other".
var Platforms = []string{"web", "macos", "windows", "linux", "android", "ios", "other"}

const (
	maxNameLength    = 100
	maxVersionLength = 32
	defaultName      = "Konspecter"
)

// NormalizeClient cleans what an app sent: names and versions are trimmed,
// stripped of control characters and cut to length; an unknown platform
// becomes "other"; a missing name becomes "Konspecter".
func NormalizeClient(c Client) Client {
	name := clean(c.Name, maxNameLength)
	if name == "" {
		name = defaultName
	}
	platform := strings.ToLower(strings.TrimSpace(c.Platform))
	known := false
	for _, p := range Platforms {
		known = known || p == platform
	}
	if !known {
		platform = "other"
	}
	return Client{Name: name, Platform: platform, ClientVersion: clean(c.ClientVersion, maxVersionLength)}
}

// clean trims text, drops control characters and invalid UTF-8, and keeps at
// most limit characters.
func clean(text string, limit int) string {
	text = strings.Map(func(r rune) rune {
		if r == utf8.RuneError || unicode.IsControl(r) {
			return -1
		}
		return r
	}, text)
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) > limit {
		text = strings.TrimSpace(string([]rune(text)[:limit]))
	}
	return text
}

// userCodeAlphabet has no vowels (no words) and no look-alike letters, as
// RFC 8628 section 6.1 suggests: 20^8 codes, about 34 bits.
const userCodeAlphabet = "BCDFGHJKLMNPQRSTVWXZ"

// UserCodeLength is the number of letters in a user code.
const UserCodeLength = 8

// NewCodes returns a device code (for the app) and a user code (for the
// person, shown as "BCDF-GHJK").
func NewCodes() (deviceCode, userCode string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generate device code: %w", err)
	}
	deviceCode = "ksd_" + base64.RawURLEncoding.EncodeToString(raw)
	letters := make([]byte, UserCodeLength)
	for i := range letters {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(userCodeAlphabet))))
		if err != nil {
			return "", "", fmt.Errorf("generate user code: %w", err)
		}
		letters[i] = userCodeAlphabet[n.Int64()]
	}
	return deviceCode, FormatUserCode(string(letters)), nil
}

// FormatUserCode writes a normalized user code as "BCDF-GHJK".
func FormatUserCode(code string) string {
	if len(code) != UserCodeLength {
		return code
	}
	return code[:4] + "-" + code[4:]
}

// NormalizeUserCode turns what a person typed into the canonical code:
// upper case, without the dash, spaces or anything else that is not a letter
// of the alphabet. It returns "" when no code of the right length remains.
func NormalizeUserCode(input string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(input) {
		if strings.ContainsRune(userCodeAlphabet, r) {
			b.WriteRune(r)
		} else if !unicode.IsSpace(r) && r != '-' {
			return ""
		}
	}
	if b.Len() != UserCodeLength {
		return ""
	}
	return b.String()
}

// HashCode returns the stored form of a device code or a (normalized) user code.
func HashCode(code string) []byte {
	sum := sha256.Sum256([]byte("konspecter/device\x00" + code))
	return sum[:]
}
