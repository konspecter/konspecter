package config

import (
	"net/netip"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func writeFile(t *testing.T, text string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadUsesDefaults(t *testing.T) {
	t.Chdir(t.TempDir()) // no ./.env here
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	want := Config{
		Addr:             ":8080",
		RegistrationOpen: true,
		SessionTTL:       720 * time.Hour,
		EmailCodeTTL:     10 * time.Minute,
		PasswordResetTTL: 30 * time.Minute,
		DeviceCodeTTL:    10 * time.Minute,
		Mail:             Mail{Transport: "smtp", Port: 587, Security: "starttls"},
		Rates:            Rates{LoginFailuresPerIP: 20, LoginFailuresPerEmail: 10, EmailsPerAddress: 5, EmailsPerIP: 20, DeviceRequestsPerIP: 20},
		OAuth:            map[string]OAuthClient{},
		LoginProviders:   map[string][]string{"en": {"google", "linkedin", "x"}, "ru": {"yandex", "vk"}},
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Errorf("Load() = %+v, want %+v", cfg, want)
	}
}

func TestLoadReadsTheEnvironment(t *testing.T) {
	t.Chdir(t.TempDir())
	cfg, err := Load(env(map[string]string{
		"KONSPECTER_DATABASE_URL":    "postgres://db",
		"KONSPECTER_ADDR":            "127.0.0.1:9000",
		"KONSPECTER_ALLOWED_ORIGINS": " https://a.example , ,tauri://localhost",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != "postgres://db" || cfg.Addr != "127.0.0.1:9000" ||
		!reflect.DeepEqual(cfg.AllowedOrigins, []string{"https://a.example", "tauri://localhost"}) {
		t.Errorf("Load() = %+v", cfg)
	}
}

func TestLoadReadsTheAccountSettings(t *testing.T) {
	t.Chdir(t.TempDir())
	cfg, err := Load(env(map[string]string{
		"KONSPECTER_PUBLIC_URL":             "https://Notes.Example.com/ignored/path",
		"KONSPECTER_REGISTRATION":           "Closed",
		"KONSPECTER_SESSION_TTL":            "48h",
		"KONSPECTER_EMAIL_CODE_TTL":         "5m",
		"KONSPECTER_PASSWORD_RESET_TTL":     "1h",
		"KONSPECTER_DEVICE_CODE_TTL":        "15m",
		"KONSPECTER_MAIL_TRANSPORT":         "smtp",
		"KONSPECTER_SMTP_HOST":              "smtp.example.com",
		"KONSPECTER_SMTP_PORT":              "465",
		"KONSPECTER_SMTP_USERNAME":          "user",
		"KONSPECTER_SMTP_PASSWORD":          "secret",
		"KONSPECTER_SMTP_FROM":              "Konspecter <noreply@example.com>",
		"KONSPECTER_SMTP_TLS":               "tls",
		"KONSPECTER_TRUSTED_PROXIES":        "10.0.0.1, 172.16.0.0/12,::1",
		"KONSPECTER_RATE_LOGIN_PER_IP":      "3",
		"KONSPECTER_RATE_LOGIN_PER_EMAIL":   "2",
		"KONSPECTER_RATE_EMAIL_PER_ADDRESS": "1",
		"KONSPECTER_RATE_EMAIL_PER_IP":      "4",
		"KONSPECTER_RATE_DEVICE_PER_IP":     "6",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://notes.example.com" || cfg.RegistrationOpen {
		t.Errorf("public URL %q, registration open %v", cfg.PublicURL, cfg.RegistrationOpen)
	}
	if cfg.SessionTTL != 48*time.Hour || cfg.EmailCodeTTL != 5*time.Minute || cfg.PasswordResetTTL != time.Hour ||
		cfg.DeviceCodeTTL != 15*time.Minute {
		t.Errorf("lifetimes %v %v %v %v", cfg.SessionTTL, cfg.EmailCodeTTL, cfg.PasswordResetTTL, cfg.DeviceCodeTTL)
	}
	wantMail := Mail{Transport: "smtp", Host: "smtp.example.com", Port: 465, Username: "user", Password: "secret",
		From: "Konspecter <noreply@example.com>", Security: "tls"}
	if cfg.Mail != wantMail || !cfg.Mail.Enabled() {
		t.Errorf("mail = %+v", cfg.Mail)
	}
	wantProxies := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.1/32"),
		netip.MustParsePrefix("172.16.0.0/12"),
		netip.MustParsePrefix("::1/128"),
	}
	if !reflect.DeepEqual(cfg.TrustedProxies, wantProxies) {
		t.Errorf("proxies = %v", cfg.TrustedProxies)
	}
	if cfg.Rates != (Rates{LoginFailuresPerIP: 3, LoginFailuresPerEmail: 2, EmailsPerAddress: 1, EmailsPerIP: 4, DeviceRequestsPerIP: 6}) {
		t.Errorf("rates = %+v", cfg.Rates)
	}
}

func TestMailIsOffWithoutAHost(t *testing.T) {
	if (Mail{Transport: "smtp"}).Enabled() {
		t.Error("smtp without a host is enabled")
	}
	if !(Mail{Transport: "log"}).Enabled() {
		t.Error("the log transport is disabled")
	}
}

func TestLoadReportsEveryBadSetting(t *testing.T) {
	t.Chdir(t.TempDir())
	_, err := Load(env(map[string]string{
		"KONSPECTER_PUBLIC_URL":        "notes.example.com",
		"KONSPECTER_REGISTRATION":      "maybe",
		"KONSPECTER_SESSION_TTL":       "a month",
		"KONSPECTER_SMTP_PORT":         "-1",
		"KONSPECTER_SMTP_HOST":         "smtp.example.com",
		"KONSPECTER_TRUSTED_PROXIES":   "proxy.local",
		"KONSPECTER_MAIL_TRANSPORT":    "pigeon",
		"KONSPECTER_RATE_EMAIL_PER_IP": "0",
	}))
	if err == nil {
		t.Fatal("Load() accepted bad settings")
	}
	for _, name := range []string{
		"KONSPECTER_PUBLIC_URL", "KONSPECTER_REGISTRATION", "KONSPECTER_SESSION_TTL", "KONSPECTER_SMTP_PORT",
		"KONSPECTER_TRUSTED_PROXIES", "KONSPECTER_MAIL_TRANSPORT", "KONSPECTER_RATE_EMAIL_PER_IP",
	} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("the error does not name %s:\n%v", name, err)
		}
	}
}

func TestLoadReadsTheSignInProviders(t *testing.T) {
	t.Chdir(t.TempDir())
	cfg, err := Load(env(map[string]string{
		"KONSPECTER_OAUTH_GOOGLE_CLIENT_ID":     "google-id",
		"KONSPECTER_OAUTH_GOOGLE_CLIENT_SECRET": "google-secret",
		"KONSPECTER_OAUTH_VK_CLIENT_ID":         "vk-id",
		"KONSPECTER_OAUTH_VK_CLIENT_SECRET":     "vk-secret",
		"KONSPECTER_LOGIN_PROVIDERS_EN":         "x, google",
		"KONSPECTER_LOGIN_PROVIDERS_RU":         "vk,google",
	}))
	if err != nil {
		t.Fatal(err)
	}
	wantClients := map[string]OAuthClient{
		"google": {ClientID: "google-id", ClientSecret: "google-secret"},
		"vk":     {ClientID: "vk-id", ClientSecret: "vk-secret"},
	}
	if !reflect.DeepEqual(cfg.OAuth, wantClients) {
		t.Errorf("OAuth = %+v", cfg.OAuth)
	}
	wantLists := map[string][]string{"en": {"x", "google"}, "ru": {"vk", "google"}}
	if !reflect.DeepEqual(cfg.LoginProviders, wantLists) {
		t.Errorf("LoginProviders = %v", cfg.LoginProviders)
	}
}

func TestBadSignInProviders(t *testing.T) {
	t.Chdir(t.TempDir())
	_, err := Load(env(map[string]string{
		"KONSPECTER_OAUTH_X_CLIENT_ID":  "x-id", // no secret
		"KONSPECTER_LOGIN_PROVIDERS_RU": "yandex,odnoklassniki",
	}))
	if err == nil {
		t.Fatal("Load() accepted bad providers")
	}
	for _, want := range []string{"KONSPECTER_OAUTH_X_CLIENT_SECRET", `"odnoklassniki"`} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not name %s:\n%v", want, err)
		}
	}
}

func TestSMTPNeedsASender(t *testing.T) {
	t.Chdir(t.TempDir())
	_, err := Load(env(map[string]string{"KONSPECTER_SMTP_HOST": "smtp.example.com"}))
	if err == nil || !strings.Contains(err.Error(), "KONSPECTER_SMTP_FROM") {
		t.Errorf("Load() = %v", err)
	}
}

func TestTheEnvironmentWinsOverTheEnvFile(t *testing.T) {
	path := writeFile(t, "KONSPECTER_DATABASE_URL=postgres://file\nKONSPECTER_ADDR=:7000\n")
	cfg, err := Load(env(map[string]string{
		"KONSPECTER_ENV_FILE": path,
		"KONSPECTER_ADDR":     ":9000",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != "postgres://file" || cfg.Addr != ":9000" {
		t.Errorf("Load() = %+v, want the URL from the file and the address from the environment", cfg)
	}
}

func TestLoadReadsDotEnvInTheWorkingDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("KONSPECTER_DATABASE_URL=postgres://here\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(dir)
	cfg, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != "postgres://here" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
}

func TestANamedEnvFileMustExist(t *testing.T) {
	_, err := Load(env(map[string]string{"KONSPECTER_ENV_FILE": filepath.Join(t.TempDir(), "missing.env")}))
	if err == nil {
		t.Fatal("Load() succeeded with a missing named env file")
	}
}

func TestLoadReportsTheBrokenLine(t *testing.T) {
	path := writeFile(t, "# settings\nKONSPECTER_ADDR=:1\nnot a setting\n")
	_, err := Load(env(map[string]string{"KONSPECTER_ENV_FILE": path}))
	if err == nil || !strings.Contains(err.Error(), "line 3") {
		t.Errorf("Load() = %v, want an error on line 3", err)
	}
}

func TestParseEnv(t *testing.T) {
	text := strings.Join([]string{
		"# a comment",
		"",
		"PLAIN=value",
		"export EXPORTED=yes",
		"SPACED = padded value  ",
		"COMMENTED=value # note",
		"HASH=a#b",
		"EMPTY=",
		`SINGLE='keep \n # as is'`,
		`DOUBLE="line\nnext \"quoted\" \\ \$HOME" # note`,
		"WINDOWS=crlf\r",
		"_UNDER_1=ok",
	}, "\n")
	got, err := ParseEnv(text)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"PLAIN":     "value",
		"EXPORTED":  "yes",
		"SPACED":    "padded value",
		"COMMENTED": "value",
		"HASH":      "a#b",
		"EMPTY":     "",
		"SINGLE":    `keep \n # as is`,
		"DOUBLE":    "line\nnext \"quoted\" \\ $HOME",
		"WINDOWS":   "crlf",
		"_UNDER_1":  "ok",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ParseEnv() =\n%#v\nwant\n%#v", got, want)
	}
}

func TestParseEnvRejectsBrokenLines(t *testing.T) {
	for _, line := range []string{
		"NO_EQUALS",
		"=value",
		"1KEY=value",
		"BAD-KEY=value",
		`OPEN="unterminated`,
		`TRAILING="value" extra`,
	} {
		if _, err := ParseEnv(line); err == nil {
			t.Errorf("ParseEnv(%q) succeeded", line)
		}
	}
}
