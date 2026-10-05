// Package config reads the server's settings from the environment and from
// an optional .env file. A variable set in the real environment always wins
// over the same variable in the file, so a deployment can override any line.
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"net/netip"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"konspecter/server/internal/oauth"
)

// DefaultEnvFile is read when KONSPECTER_ENV_FILE does not name another file.
// It may be missing; a file named explicitly must exist.
const DefaultEnvFile = ".env"

const defaultAddr = ":8080"

// Config holds every server setting.
type Config struct {
	// DatabaseURL is the PostgreSQL connection URL (KONSPECTER_DATABASE_URL).
	DatabaseURL string
	// Addr is the listen address (KONSPECTER_ADDR, default ":8080").
	Addr string
	// AllowedOrigins are the browser origins allowed to call the API
	// (KONSPECTER_ALLOWED_ORIGINS, comma-separated).
	AllowedOrigins []string
	// PublicURL is the origin of the account site and API behind the proxy,
	// e.g. "https://notes.example.com" (KONSPECTER_PUBLIC_URL). Sign-in on the
	// site is off without it: emails link to it, and browser requests that
	// sign in or use a session must come from it.
	PublicURL string
	// RegistrationOpen says whether new accounts are accepted
	// (KONSPECTER_REGISTRATION: "open", the default, or "closed").
	RegistrationOpen bool
	// SessionTTL is how long a site session lasts unused (KONSPECTER_SESSION_TTL, default 720h).
	SessionTTL time.Duration
	// EmailCodeTTL is how long a sign-in code works (KONSPECTER_EMAIL_CODE_TTL, default 10m).
	EmailCodeTTL time.Duration
	// PasswordResetTTL is how long a reset link works (KONSPECTER_PASSWORD_RESET_TTL, default 30m).
	PasswordResetTTL time.Duration
	// Mail configures sending email.
	Mail Mail
	// TrustedProxies are the addresses whose X-Forwarded-For is believed
	// (KONSPECTER_TRUSTED_PROXIES: comma-separated IPs or CIDR prefixes).
	TrustedProxies []netip.Prefix
	// Rates limits sign-in attempts and emails.
	Rates Rates
	// OAuth holds the sign-in providers' clients by provider id (one of
	// oauth.IDs). A provider is on only when both of its
	// KONSPECTER_OAUTH_<ID>_CLIENT_ID and _CLIENT_SECRET are set.
	OAuth map[string]OAuthClient
	// LoginProviders are the providers the site offers per language
	// (KONSPECTER_LOGIN_PROVIDERS_EN, default "google,linkedin,x";
	// KONSPECTER_LOGIN_PROVIDERS_RU, default "yandex,vk").
	LoginProviders map[string][]string
}

// OAuthClient is the app registered with a sign-in provider.
type OAuthClient struct {
	ClientID     string
	ClientSecret string
}

// Mail is how the server sends email (KONSPECTER_MAIL_TRANSPORT): "smtp"
// (the default) through KONSPECTER_SMTP_*, or "log" to write messages to
// the log (development; the log then holds sign-in codes). With "smtp" and
// no host, no email is sent and the sign-in flows that need one are off.
type Mail struct {
	Transport string
	Host      string
	Port      int
	Username  string
	Password  string
	From      string
	// Security is "starttls" (default), "tls" or "none" (KONSPECTER_SMTP_TLS).
	Security string
}

// Enabled reports whether the server can send email.
func (m Mail) Enabled() bool {
	return m.Transport == "log" || m.Host != ""
}

// Rates are the abuse limits (KONSPECTER_RATE_*), each a count per window.
type Rates struct {
	// LoginFailuresPerIP: failed password or code checks per client address per 15 minutes (default 20).
	LoginFailuresPerIP int
	// LoginFailuresPerEmail: failed password checks per address per 15 minutes (default 10).
	LoginFailuresPerEmail int
	// EmailsPerAddress: emails sent to one address per hour (default 5).
	EmailsPerAddress int
	// EmailsPerIP: emails one client address may trigger per hour (default 20).
	EmailsPerIP int
}

// Load reads the settings. getenv looks up the real environment; the .env
// file named by KONSPECTER_ENV_FILE (default DefaultEnvFile) fills in the
// variables it leaves empty.
func Load(getenv func(string) string) (Config, error) {
	lookup, err := withEnvFile(getenv)
	if err != nil {
		return Config{}, err
	}
	r := reader{lookup: lookup}
	cfg := Config{
		DatabaseURL:      lookup("KONSPECTER_DATABASE_URL"),
		Addr:             r.text("KONSPECTER_ADDR", defaultAddr),
		AllowedOrigins:   splitList(lookup("KONSPECTER_ALLOWED_ORIGINS")),
		PublicURL:        r.origin("KONSPECTER_PUBLIC_URL"),
		RegistrationOpen: r.choice("KONSPECTER_REGISTRATION", "open", "closed") == "open",
		SessionTTL:       r.duration("KONSPECTER_SESSION_TTL", 30*24*time.Hour),
		EmailCodeTTL:     r.duration("KONSPECTER_EMAIL_CODE_TTL", 10*time.Minute),
		PasswordResetTTL: r.duration("KONSPECTER_PASSWORD_RESET_TTL", 30*time.Minute),
		Mail: Mail{
			Transport: r.choice("KONSPECTER_MAIL_TRANSPORT", "smtp", "log"),
			Host:      lookup("KONSPECTER_SMTP_HOST"),
			Port:      r.integer("KONSPECTER_SMTP_PORT", 587),
			Username:  lookup("KONSPECTER_SMTP_USERNAME"),
			Password:  lookup("KONSPECTER_SMTP_PASSWORD"),
			From:      lookup("KONSPECTER_SMTP_FROM"),
			Security:  r.choice("KONSPECTER_SMTP_TLS", "starttls", "tls", "none"),
		},
		TrustedProxies: r.prefixes("KONSPECTER_TRUSTED_PROXIES"),
		Rates: Rates{
			LoginFailuresPerIP:    r.integer("KONSPECTER_RATE_LOGIN_PER_IP", 20),
			LoginFailuresPerEmail: r.integer("KONSPECTER_RATE_LOGIN_PER_EMAIL", 10),
			EmailsPerAddress:      r.integer("KONSPECTER_RATE_EMAIL_PER_ADDRESS", 5),
			EmailsPerIP:           r.integer("KONSPECTER_RATE_EMAIL_PER_IP", 20),
		},
	}
	cfg.OAuth = r.oauthClients()
	cfg.LoginProviders = map[string][]string{
		"en": r.providers("KONSPECTER_LOGIN_PROVIDERS_EN", "google,linkedin,x"),
		"ru": r.providers("KONSPECTER_LOGIN_PROVIDERS_RU", "yandex,vk"),
	}
	if cfg.Mail.Transport == "smtp" && cfg.Mail.Host != "" && cfg.Mail.From == "" {
		r.fail("KONSPECTER_SMTP_FROM is required with KONSPECTER_SMTP_HOST")
	}
	if len(r.errs) > 0 {
		return Config{}, errors.Join(r.errs...)
	}
	return cfg, nil
}

// reader parses typed settings, collecting every problem instead of stopping at the first.
type reader struct {
	lookup func(string) string
	errs   []error
}

func (r *reader) fail(format string, args ...any) {
	r.errs = append(r.errs, fmt.Errorf(format, args...))
}

func (r *reader) text(name, fallback string) string {
	if value := r.lookup(name); value != "" {
		return value
	}
	return fallback
}

func (r *reader) choice(name string, options ...string) string {
	value := strings.ToLower(strings.TrimSpace(r.lookup(name)))
	if value == "" {
		return options[0]
	}
	for _, option := range options {
		if value == option {
			return value
		}
	}
	r.fail("%s must be one of %s, not %q", name, strings.Join(options, ", "), value)
	return options[0]
}

func (r *reader) duration(name string, fallback time.Duration) time.Duration {
	value := r.lookup(name)
	if value == "" {
		return fallback
	}
	d, err := time.ParseDuration(value)
	if err != nil || d <= 0 {
		r.fail("%s must be a positive duration such as 30m or 720h, not %q", name, value)
		return fallback
	}
	return d
}

func (r *reader) integer(name string, fallback int) int {
	value := r.lookup(name)
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		r.fail("%s must be a positive whole number, not %q", name, value)
		return fallback
	}
	return n
}

// origin reads an http(s) URL and keeps its origin (scheme and host).
func (r *reader) origin(name string) string {
	value := r.lookup(name)
	if value == "" {
		return ""
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		r.fail("%s must be an http(s) URL such as https://notes.example.com, not %q", name, value)
		return ""
	}
	return u.Scheme + "://" + strings.ToLower(u.Host)
}

func (r *reader) prefixes(name string) []netip.Prefix {
	var out []netip.Prefix
	for _, item := range splitList(r.lookup(name)) {
		if prefix, err := netip.ParsePrefix(item); err == nil {
			out = append(out, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(item)
		if err != nil {
			r.fail("%s: %q is neither an IP address nor a CIDR prefix", name, item)
			continue
		}
		out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return out
}

func (r *reader) oauthClients() map[string]OAuthClient {
	clients := map[string]OAuthClient{}
	for _, id := range oauth.IDs {
		prefix := "KONSPECTER_OAUTH_" + strings.ToUpper(id)
		client := OAuthClient{ClientID: r.lookup(prefix + "_CLIENT_ID"), ClientSecret: r.lookup(prefix + "_CLIENT_SECRET")}
		switch {
		case client.ClientID != "" && client.ClientSecret != "":
			clients[id] = client
		case client.ClientID != "" || client.ClientSecret != "":
			r.fail("%s_CLIENT_ID and %s_CLIENT_SECRET must be set together", prefix, prefix)
		}
	}
	return clients
}

// providers reads a list of sign-in provider ids.
func (r *reader) providers(name, fallback string) []string {
	ids := splitList(r.text(name, fallback))
	for _, id := range ids {
		if !slices.Contains(oauth.IDs, id) {
			r.fail("%s: unknown provider %q (want some of %s)", name, id, strings.Join(oauth.IDs, ", "))
		}
	}
	return ids
}

// withEnvFile returns a lookup that prefers getenv and falls back to the .env file.
func withEnvFile(getenv func(string) string) (func(string) string, error) {
	path := getenv("KONSPECTER_ENV_FILE")
	explicit := path != ""
	if !explicit {
		path = DefaultEnvFile
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) && !explicit {
		return getenv, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read env file: %w", err)
	}
	file, err := ParseEnv(string(data))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return func(key string) string {
		if value := getenv(key); value != "" {
			return value
		}
		return file[key]
	}, nil
}

// ParseEnv parses .env text: KEY=VALUE lines, with an optional "export "
// prefix, blank lines and # comments. A value may be single-quoted (taken
// as is) or double-quoted (\n, \", \\ and \$ are unescaped); an unquoted
// value ends at " #" and is trimmed.
func ParseEnv(text string) (map[string]string, error) {
	values := make(map[string]string)
	for number, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, raw, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || !validKey(key) {
			return nil, fmt.Errorf("line %d: want KEY=VALUE", number+1)
		}
		value, err := parseValue(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", number+1, err)
		}
		values[key] = value
	}
	return values, nil
}

func validKey(key string) bool {
	if key == "" {
		return false
	}
	for i, r := range key {
		letter := r == '_' || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')
		if !letter && (i == 0 || r < '0' || r > '9') {
			return false
		}
	}
	return true
}

func parseValue(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	switch quote := raw[0]; quote {
	case '\'', '"':
		end := closingQuote(raw, quote)
		if end < 0 {
			return "", errors.New("unterminated quoted value")
		}
		if rest := strings.TrimSpace(raw[end+1:]); rest != "" && !strings.HasPrefix(rest, "#") {
			return "", errors.New("text after the quoted value")
		}
		value := raw[1:end]
		if quote == '"' {
			value = unescape(value)
		}
		return value, nil
	}
	if i := strings.Index(raw, " #"); i >= 0 {
		raw = raw[:i]
	}
	return strings.TrimSpace(raw), nil
}

// closingQuote returns the index of the quote that ends raw's quoted value, or -1.
func closingQuote(raw string, quote byte) int {
	for i := 1; i < len(raw); i++ {
		switch {
		case quote == '"' && raw[i] == '\\':
			i++
		case raw[i] == quote:
			return i
		}
	}
	return -1
}

func unescape(value string) string {
	var b strings.Builder
	for i := 0; i < len(value); i++ {
		if value[i] != '\\' || i+1 == len(value) {
			b.WriteByte(value[i])
			continue
		}
		i++
		switch value[i] {
		case 'n':
			b.WriteByte('\n')
		case 't':
			b.WriteByte('\t')
		default: // \" \\ \$ and anything else: the character itself
			b.WriteByte(value[i])
		}
	}
	return b.String()
}

func splitList(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}
