// Command server runs the Konspecter HTTP API.
//
//	server [serve]                 migrate the database, then serve HTTP
//	server migrate                 apply database migrations and exit
//	server create-user -email ADDR create a user and print an API token
//	server create-token -email ADDR print a new API token for a user
//	server revoke-tokens -email ADDR disconnect every device of a user
//	server version                 print the version
//
// Configuration comes from the environment and from an optional .env file
// (KONSPECTER_ENV_FILE, default ./.env); the environment wins. See
// .env.example and package config:
//
//	KONSPECTER_DATABASE_URL  PostgreSQL connection URL (required)
//	KONSPECTER_ADDR          listen address (default ":8080")
//	KONSPECTER_ALLOWED_ORIGINS  comma-separated browser origins allowed to call the API
//	KONSPECTER_PUBLIC_URL    the account site's origin; turns sign-in on
//	KONSPECTER_MAIL_TRANSPORT, KONSPECTER_SMTP_*  how emails are sent
//	KONSPECTER_OAUTH_*, KONSPECTER_LOGIN_PROVIDERS_*  sign-in with other services
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"konspecter/server/internal/config"
	"konspecter/server/internal/httpapi"
	"konspecter/server/internal/mail"
	"konspecter/server/internal/oauth"
	"konspecter/server/internal/storage/postgres"
)

// version is set at build time: -ldflags "-X main.version=0.1.0".
var version = "dev"

const shutdownTimeout = 10 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, getenv func(string) string, stdout io.Writer) error {
	command := "serve"
	if len(args) > 0 {
		command, args = args[0], args[1:]
	}
	if command == "version" {
		_, err := fmt.Fprintf(stdout, "konspecter server %s\n", version)
		return err
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return errors.New("KONSPECTER_DATABASE_URL is not set")
	}

	switch command {
	case "serve":
		return withDB(ctx, cfg.DatabaseURL, func(db *postgres.DB) error {
			if err := db.Migrate(ctx); err != nil {
				return err
			}
			accounts, err := accountOptions(cfg, db, slog.Default())
			if err != nil {
				return err
			}
			options := httpapi.Options{
				AllowedOrigins: cfg.AllowedOrigins,
				TrustedProxies: cfg.TrustedProxies,
				Accounts:       accounts,
			}
			handler := httpapi.NewHandler(db, db, slog.Default(), options)
			return serve(ctx, cfg.Addr, handler, handler.CloseStreams)
		})
	case "migrate":
		return withDB(ctx, cfg.DatabaseURL, func(db *postgres.DB) error { return db.Migrate(ctx) })
	case "create-user", "create-token":
		email, err := parseEmail(command, args)
		if err != nil {
			return err
		}
		return withDB(ctx, cfg.DatabaseURL, func(db *postgres.DB) error {
			return issueToken(ctx, db, command == "create-user", email, stdout)
		})
	case "revoke-tokens":
		email, err := parseEmail(command, args)
		if err != nil {
			return err
		}
		return withDB(ctx, cfg.DatabaseURL, func(db *postgres.DB) error {
			user, err := db.UserByEmail(ctx, email)
			if err != nil {
				return err
			}
			count, err := db.RevokeUserTokens(ctx, user.ID)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(stdout, "revoked %d token(s) of %s\n", count, user.Email)
			return err
		})
	default:
		return fmt.Errorf("unknown command %q (want serve, migrate, create-user, create-token or revoke-tokens)", command)
	}
}

// accountOptions turns on sign-in on the site when the public URL is set.
func accountOptions(cfg config.Config, db *postgres.DB, logger *slog.Logger) (*httpapi.Accounts, error) {
	if cfg.PublicURL == "" {
		logger.Info("sign-in on the site is off: KONSPECTER_PUBLIC_URL is not set")
		return nil, nil
	}
	providers, lists, err := loginProviders(cfg, logger)
	if err != nil {
		return nil, err
	}
	accounts := &httpapi.Accounts{
		Store:            db,
		Devices:          db,
		PublicURL:        cfg.PublicURL,
		RegistrationOpen: cfg.RegistrationOpen,
		SessionTTL:       cfg.SessionTTL,
		EmailCodeTTL:     cfg.EmailCodeTTL,
		PasswordResetTTL: cfg.PasswordResetTTL,
		DeviceCodeTTL:    cfg.DeviceCodeTTL,
		Rates: httpapi.Rates{
			LoginFailuresPerIP:    cfg.Rates.LoginFailuresPerIP,
			LoginFailuresPerEmail: cfg.Rates.LoginFailuresPerEmail,
			EmailsPerAddress:      cfg.Rates.EmailsPerAddress,
			EmailsPerIP:           cfg.Rates.EmailsPerIP,
			DeviceRequestsPerIP:   cfg.Rates.DeviceRequestsPerIP,
		},
		Providers:      providers,
		LoginProviders: lists,
	}
	switch {
	case cfg.Mail.Transport == "log":
		logger.Warn("emails are written to the log, not sent (KONSPECTER_MAIL_TRANSPORT=log): use this for development only")
		accounts.Mailer = &mail.Log{Logger: logger}
	case cfg.Mail.Host != "":
		security, _ := mail.ParseSecurity(cfg.Mail.Security) // validated by config
		accounts.Mailer = &mail.SMTP{
			Host: cfg.Mail.Host, Port: cfg.Mail.Port, Username: cfg.Mail.Username, Password: cfg.Mail.Password,
			From: cfg.Mail.From, Security: security,
		}
	default:
		logger.Warn("no email is sent (KONSPECTER_SMTP_HOST is not set): sign-in codes and password resets are off")
	}
	return accounts, nil
}

// loginProviders sets up the configured sign-in providers, each calling back
// to the public URL, and keeps only those in the site's per-language lists.
func loginProviders(cfg config.Config, logger *slog.Logger) (map[string]*oauth.Provider, map[string][]string, error) {
	providers := map[string]*oauth.Provider{}
	for id, client := range cfg.OAuth {
		provider, err := oauth.New(id, client.ClientID, client.ClientSecret, cfg.PublicURL+"/api/auth/"+id+"/callback")
		if err != nil {
			return nil, nil, err
		}
		providers[id] = provider
	}
	lists := map[string][]string{}
	for locale, ids := range cfg.LoginProviders {
		lists[locale] = []string{}
		for _, id := range ids {
			if providers[id] == nil {
				logger.Info("a sign-in provider is listed but not set up", "provider", id, "locale", locale)
				continue
			}
			lists[locale] = append(lists[locale], id)
		}
	}
	return providers, lists, nil
}

func withDB(ctx context.Context, url string, use func(*postgres.DB) error) error {
	db, err := postgres.Open(ctx, url)
	if err != nil {
		return err
	}
	defer db.Close()
	return use(db)
}

func parseEmail(command string, args []string) (string, error) {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	email := flags.String("email", "", "the user's email address")
	if err := flags.Parse(args); err != nil {
		return "", fmt.Errorf("%s: %w", command, err)
	}
	if *email == "" {
		return "", fmt.Errorf("%s: -email is required", command)
	}
	return *email, nil
}

// issueToken prints a new API token, creating the user first if asked to.
// The token is shown only here; the database keeps just its hash.
func issueToken(ctx context.Context, db *postgres.DB, create bool, email string, stdout io.Writer) error {
	if err := db.Migrate(ctx); err != nil {
		return err
	}
	lookup := db.UserByEmail
	if create {
		lookup = db.CreateUser
	}
	user, err := lookup(ctx, email)
	if err != nil {
		return err
	}
	token, err := db.CreateToken(ctx, user.ID)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "user %s (%s)\ntoken %s\n", user.Email, user.ID, token)
	return err
}

// serve runs the HTTP server until ctx is cancelled, then shuts down gracefully.
// onShutdown runs when shutdown starts, to end long-lived requests (event
// streams) that Shutdown would otherwise wait for.
func serve(ctx context.Context, addr string, handler http.Handler, onShutdown ...func()) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", addr, err)
	}
	return serveOn(ctx, ln, handler, onShutdown...)
}

func serveOn(ctx context.Context, ln net.Listener, handler http.Handler, onShutdown ...func()) error {
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    32 << 10,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	for _, f := range onShutdown {
		srv.RegisterOnShutdown(f)
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.Serve(ln)
	}()
	slog.Info("listening", "addr", ln.Addr().String())

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	return nil
}
