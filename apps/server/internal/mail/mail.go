// Package mail sends the server's emails (sign-in codes, password resets)
// over SMTP, or writes them to the log for development and tests.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// Message is one plain-text email to one address.
type Message struct {
	To      string
	Subject string
	Text    string
}

// Security is how the SMTP connection is protected.
type Security string

const (
	// StartTLS upgrades a plain connection (usually port 587). The server must offer it.
	StartTLS Security = "starttls"
	// ImplicitTLS speaks TLS from the start (usually port 465).
	ImplicitTLS Security = "tls"
	// NoTLS sends in the clear: only for a relay on the same host or network.
	NoTLS Security = "none"
)

// ParseSecurity reads a Security value; empty means StartTLS.
func ParseSecurity(value string) (Security, error) {
	switch s := Security(strings.ToLower(strings.TrimSpace(value))); s {
	case "":
		return StartTLS, nil
	case StartTLS, ImplicitTLS, NoTLS:
		return s, nil
	default:
		return "", fmt.Errorf("unknown SMTP security %q (want starttls, tls or none)", value)
	}
}

// SMTP sends mail through an SMTP server.
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	// From is the sender, e.g. "Konspecter <noreply@example.com>".
	From     string
	Security Security
	// Timeout bounds one delivery (default 30 seconds).
	Timeout time.Duration
}

// Send delivers m. It returns once the server has accepted the message.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	from, err := netmail.ParseAddress(s.From)
	if err != nil {
		return fmt.Errorf("sender address: %w", err)
	}
	to, err := netmail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("recipient address: %w", err)
	}
	body, err := Compose(from, to.Address, m, time.Now())
	if err != nil {
		return err
	}

	timeout := s.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := s.dial(ctx)
	if err != nil {
		return err
	}
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp: %w", err)
	}
	client, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp: %w", err)
	}
	defer func() { _ = client.Close() }()

	if s.Security == StartTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("smtp: the server does not offer STARTTLS (set the security to tls or none)")
		}
		if err := client.StartTLS(&tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if s.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := client.Rcpt(to.Address); err != nil {
		return fmt.Errorf("smtp rcpt to: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	return client.Quit()
}

func (s *SMTP) dial(ctx context.Context) (net.Conn, error) {
	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	if s.Security == ImplicitTLS {
		dialer := &tls.Dialer{Config: &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}}
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("smtp connect: %w", err)
		}
		return conn, nil
	}
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("smtp connect: %w", err)
	}
	return conn, nil
}

// Compose renders m as an RFC 5322 message: UTF-8 text, quoted-printable,
// CRLF line endings.
func Compose(from *netmail.Address, to string, m Message, now time.Time) ([]byte, error) {
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return nil, fmt.Errorf("message id: %w", err)
	}
	domain := from.Address[strings.LastIndex(from.Address, "@")+1:]

	var b bytes.Buffer
	header := func(name, value string) {
		b.WriteString(name + ": " + value + "\r\n")
	}
	header("From", from.String())
	header("To", (&netmail.Address{Address: to}).String())
	header("Subject", mime.QEncoding.Encode("utf-8", m.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", "<"+hex.EncodeToString(id)+"@"+domain+">")
	header("MIME-Version", "1.0")
	header("Content-Type", "text/plain; charset=utf-8")
	header("Content-Transfer-Encoding", "quoted-printable")
	b.WriteString("\r\n")

	qp := quotedprintable.NewWriter(&b)
	text := strings.ReplaceAll(strings.ReplaceAll(m.Text, "\r\n", "\n"), "\n", "\r\n")
	if _, err := qp.Write([]byte(text)); err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	if err := qp.Close(); err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	return b.Bytes(), nil
}

// Log writes messages to the log instead of sending them. For development
// and tests only: the log then holds sign-in codes and reset links.
type Log struct {
	Logger *slog.Logger
}

// Send logs m.
func (l *Log) Send(ctx context.Context, m Message) error {
	l.Logger.InfoContext(ctx, "email (not sent: KONSPECTER_MAIL_TRANSPORT=log)",
		"to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}
