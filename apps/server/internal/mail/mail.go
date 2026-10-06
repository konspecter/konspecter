// Package mail sends the server's emails (sign-in codes, password resets)
// over SMTP, or writes them to the log for development and tests. Each is
// sent as plain text and as HTML with the logo.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// Message is one email to one address: plain text, and optionally the same
// as HTML (which shows the logo, sent along by Content-ID).
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
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

// Compose renders m as an RFC 5322 message with CRLF line endings: UTF-8
// text in quoted-printable or, with HTML, multipart/alternative of the text
// and a multipart/related of the HTML and the logo.
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

	if m.HTML == "" {
		header("Content-Type", "text/plain; charset=utf-8")
		header("Content-Transfer-Encoding", "quoted-printable")
		b.WriteString("\r\n")
		if err := writeQuotedPrintable(&b, m.Text); err != nil {
			return nil, err
		}
		return b.Bytes(), nil
	}

	alternative := multipart.NewWriter(&b)
	header("Content-Type", "multipart/alternative; boundary="+alternative.Boundary())
	b.WriteString("\r\n")
	if err := writeTextPart(alternative, "text/plain", m.Text); err != nil {
		return nil, err
	}
	// The related part names its boundary in its header, before its writer exists.
	boundary := multipart.NewWriter(io.Discard).Boundary()
	part, err := alternative.CreatePart(textproto.MIMEHeader{
		"Content-Type": {"multipart/related; boundary=" + boundary},
	})
	if err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	related := multipart.NewWriter(part)
	if err := related.SetBoundary(boundary); err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	if err := writeTextPart(related, "text/html", m.HTML); err != nil {
		return nil, err
	}
	logo, err := related.CreatePart(textproto.MIMEHeader{
		"Content-Type":              {"image/png"},
		"Content-Transfer-Encoding": {"base64"},
		"Content-ID":                {"<" + logoID + ">"},
		"Content-Disposition":       {`inline; filename="konspecter.png"`},
	})
	if err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	if err := writeBase64(logo, logoPNG); err != nil {
		return nil, err
	}
	if err := related.Close(); err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	if err := alternative.Close(); err != nil {
		return nil, fmt.Errorf("encode message: %w", err)
	}
	return b.Bytes(), nil
}

// writeTextPart adds a UTF-8 text part (text/plain or text/html) in quoted-printable.
func writeTextPart(w *multipart.Writer, contentType, text string) error {
	part, err := w.CreatePart(textproto.MIMEHeader{
		"Content-Type":              {contentType + "; charset=utf-8"},
		"Content-Transfer-Encoding": {"quoted-printable"},
	})
	if err != nil {
		return fmt.Errorf("encode message: %w", err)
	}
	return writeQuotedPrintable(part, text)
}

// writeQuotedPrintable writes text with CRLF line endings in quoted-printable.
func writeQuotedPrintable(w io.Writer, text string) error {
	qp := quotedprintable.NewWriter(w)
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\n", "\r\n")
	if _, err := qp.Write([]byte(text)); err != nil {
		return fmt.Errorf("encode message: %w", err)
	}
	if err := qp.Close(); err != nil {
		return fmt.Errorf("encode message: %w", err)
	}
	return nil
}

// writeBase64 writes data in base64, in lines of 76 characters (RFC 2045).
func writeBase64(w io.Writer, data []byte) error {
	encoded := base64.StdEncoding.EncodeToString(data)
	for len(encoded) > 0 {
		n := min(76, len(encoded))
		if _, err := io.WriteString(w, encoded[:n]+"\r\n"); err != nil {
			return fmt.Errorf("encode message: %w", err)
		}
		encoded = encoded[n:]
	}
	return nil
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
