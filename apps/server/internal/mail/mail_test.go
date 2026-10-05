package mail

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"log/slog"
	"mime"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeSMTP accepts one message and reports the session's commands and data.
func fakeSMTP(t *testing.T) (addr string, result <-chan []string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	out := make(chan []string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		var log []string
		r := bufio.NewReader(conn)
		reply := func(s string) { _, _ = io.WriteString(conn, s+"\r\n") }
		reply("220 fake ESMTP")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				out <- log
				return
			}
			line = strings.TrimRight(line, "\r\n")
			log = append(log, line)
			switch verb := strings.ToUpper(strings.Fields(line + " x")[0]); verb {
			case "EHLO":
				reply("250-fake")
				reply("250 8BITMIME")
			case "DATA":
				reply("354 go ahead")
				var data strings.Builder
				for {
					l, err := r.ReadString('\n')
					if err != nil || l == ".\r\n" {
						break
					}
					data.WriteString(l)
				}
				log = append(log, data.String())
				reply("250 queued")
			case "QUIT":
				reply("221 bye")
				out <- log
				return
			default:
				reply("250 ok")
			}
		}
	}()
	return ln.Addr().String(), out
}

func TestSMTPSendsOneMessage(t *testing.T) {
	addr, result := fakeSMTP(t)
	host, port, _ := net.SplitHostPort(addr)
	portNumber, _ := strconv.Atoi(port)
	sender := &SMTP{Host: host, Port: portNumber, From: "Konspecter <noreply@example.com>", Security: NoTLS}
	err := sender.Send(context.Background(), Message{To: "ann@example.com", Subject: "Код: 123456", Text: "Привет\nкод 123456"})
	if err != nil {
		t.Fatalf("Send() = %v", err)
	}
	log := <-result
	joined := strings.Join(log, "\n")
	for _, want := range []string{"MAIL FROM:<noreply@example.com>", "RCPT TO:<ann@example.com>", "QUIT"} {
		if !strings.Contains(joined, want) {
			t.Errorf("session lacks %q:\n%s", want, joined)
		}
	}
	data := log[len(log)-2]
	message, err := netmail.ReadMessage(strings.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(quotedprintable.NewReader(message.Body))
	// The SMTP data writer ends the message with a line break.
	if strings.TrimRight(string(body), "\r\n") != "Привет\r\nкод 123456" {
		t.Errorf("body = %q", body)
	}
}

func TestSMTPRequiresOfferedStartTLS(t *testing.T) {
	addr, _ := fakeSMTP(t)
	host, port, _ := net.SplitHostPort(addr)
	portNumber, _ := strconv.Atoi(port)
	sender := &SMTP{Host: host, Port: portNumber, From: "noreply@example.com", Security: StartTLS, Timeout: 5 * time.Second}
	err := sender.Send(context.Background(), Message{To: "ann@example.com", Subject: "s", Text: "t"})
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Errorf("Send() = %v, want a STARTTLS error", err)
	}
}

func TestComposeEncodesHeadersAndBody(t *testing.T) {
	from := &netmail.Address{Name: "Konspecter", Address: "noreply@example.com"}
	raw, err := Compose(from, "ann@example.com", Message{Subject: "Код для входа", Text: "a\nb"}, time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	message, err := netmail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(message.Header.Get("Subject"))
	if err != nil || subject != "Код для входа" {
		t.Errorf("subject = %q, %v", subject, err)
	}
	if got := message.Header.Get("Date"); got != "Mon, 05 Oct 2026 12:00:00 +0000" {
		t.Errorf("date = %q", got)
	}
	if !strings.HasSuffix(message.Header.Get("Message-ID"), "@example.com>") {
		t.Errorf("message id = %q", message.Header.Get("Message-ID"))
	}
	if strings.Count(string(raw), "\r\n") != strings.Count(string(raw), "\n") {
		t.Error("the message has bare LF line endings")
	}
}

func TestParseSecurity(t *testing.T) {
	for value, want := range map[string]Security{"": StartTLS, "STARTTLS": StartTLS, "tls": ImplicitTLS, "none": NoTLS} {
		if got, err := ParseSecurity(value); err != nil || got != want {
			t.Errorf("ParseSecurity(%q) = %q, %v", value, got, err)
		}
	}
	if _, err := ParseSecurity("ssl"); err == nil {
		t.Error("ParseSecurity(ssl) succeeded")
	}
}

func TestTextsSpeakTheRequestedLanguage(t *testing.T) {
	en := SignInCode(ParseLocale("de"), "a@example.com", "123456", 10*time.Minute, false)
	ru := SignInCode(ParseLocale("ru"), "a@example.com", "123456", 10*time.Minute, true)
	if !strings.Contains(en.Subject, "sign-in code: 123456") || !strings.Contains(en.Text, "10 minutes") {
		t.Errorf("english = %+v", en)
	}
	if !strings.Contains(ru.Subject, "регистрации") || !strings.Contains(ru.Text, "10 мин") {
		t.Errorf("russian = %+v", ru)
	}
	reset := PasswordReset(English, "a@example.com", "https://notes.example.com/reset?token=x", 30*time.Minute)
	if reset.To != "a@example.com" || !strings.Contains(reset.Text, "https://notes.example.com/reset?token=x") {
		t.Errorf("reset = %+v", reset)
	}
	if !strings.Contains(NoAccount(Russian, "a@example.com", "https://n.example").Text, "https://n.example/register") {
		t.Error("the no-account email lacks the sign-up link")
	}
	if RegistrationClosed(English, "a@example.com").Subject == "" {
		t.Error("empty subject")
	}
}

func TestLogTransportLogs(t *testing.T) {
	var out bytes.Buffer
	sender := &Log{Logger: slog.New(slog.NewTextHandler(&out, nil))}
	if err := sender.Send(context.Background(), Message{To: "a@example.com", Subject: "s", Text: "code 123456"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "123456") {
		t.Errorf("log = %q", out.String())
	}
}
