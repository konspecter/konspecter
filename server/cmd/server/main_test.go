package main

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func env(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestRunRequiresADatabaseURL(t *testing.T) {
	err := run(context.Background(), nil, env(nil), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "KONSPECTER_DATABASE_URL") {
		t.Errorf("run() = %v", err)
	}
}

func TestRunRejectsUnknownCommandsAndMissingFlags(t *testing.T) {
	vars := env(map[string]string{"KONSPECTER_DATABASE_URL": "postgres://unused"})
	if err := run(context.Background(), []string{"launch"}, vars, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Errorf("unknown command: %v", err)
	}
	if err := run(context.Background(), []string{"create-user"}, vars, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "-email is required") {
		t.Errorf("missing email: %v", err)
	}
}

func TestServeShutsDownWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serve(ctx, "127.0.0.1:0", http.NotFoundHandler()) }()
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serve() = %v, want nil", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve() did not return after cancellation")
	}
}

func TestServeFailsOnInvalidAddress(t *testing.T) {
	if err := serve(context.Background(), "invalid-address", http.NotFoundHandler()); err == nil {
		t.Fatal("serve() = nil, want listen error")
	}
}

// With a test database, exercise the real commands end to end.
func TestCommandsAgainstPostgres(t *testing.T) {
	url := os.Getenv("KONSPECTER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("KONSPECTER_TEST_DATABASE_URL is not set")
	}
	vars := env(map[string]string{"KONSPECTER_DATABASE_URL": url})
	ctx := context.Background()
	email := "cli-" + time.Now().Format("150405.000000000") + "@example.com"

	if err := run(ctx, []string{"migrate"}, vars, &bytes.Buffer{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var out bytes.Buffer
	if err := run(ctx, []string{"create-user", "-email", email}, vars, &out); err != nil {
		t.Fatalf("create-user: %v", err)
	}
	if !strings.Contains(out.String(), "token ksp_") {
		t.Errorf("create-user output = %q", out.String())
	}
	out.Reset()
	if err := run(ctx, []string{"create-token", "-email", email}, vars, &out); err != nil || !strings.Contains(out.String(), "token ksp_") {
		t.Errorf("create-token = %q, %v", out.String(), err)
	}
	if err := run(ctx, []string{"create-token", "-email", "nobody@example.com"}, vars, &out); err == nil {
		t.Error("create-token for an unknown user succeeded")
	}
}

func TestVersionNeedsNoDatabase(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), []string{"version"}, env(nil), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.String(), "konspecter server ") {
		t.Errorf("version output = %q", out.String())
	}
}
