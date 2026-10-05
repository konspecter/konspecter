package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
)

func startCode(t *testing.T, db *DB, email, code, passwordHash string) {
	t.Helper()
	err := db.StartEmailCode(context.Background(), email, accounts.HashCode(email, code), passwordHash, accounts.Identity{}, time.Now().Add(10*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
}

func TestEmailCodeCreatesTheAccountWithItsPassword(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	startCode(t, db, "new@example.com", "123456", "hash-1")

	user, err := db.VerifyEmailCode(ctx, "new@example.com", accounts.HashCode("new@example.com", "123456"), true)
	if err != nil {
		t.Fatalf("VerifyEmailCode() = %v", err)
	}
	if user.Email != "new@example.com" || user.ID == "" {
		t.Errorf("user = %+v", user)
	}
	got, hash, err := db.PasswordHash(ctx, "new@example.com")
	if err != nil || got.ID != user.ID || hash != "hash-1" {
		t.Errorf("PasswordHash() = %+v, %q, %v", got, hash, err)
	}
	// The code is used up.
	if _, err := db.VerifyEmailCode(ctx, "new@example.com", accounts.HashCode("new@example.com", "123456"), true); !errors.Is(err, accounts.ErrInvalidCode) {
		t.Errorf("second use = %v", err)
	}
}

func TestEmailCodeSignsAnExistingAccountIn(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	existing := createUser(t, db, "ann@example.com")
	startCode(t, db, "ann@example.com", "111111", "")

	user, err := db.VerifyEmailCode(ctx, "ann@example.com", accounts.HashCode("ann@example.com", "111111"), false)
	if err != nil || user.ID != existing.ID {
		t.Fatalf("VerifyEmailCode() = %+v, %v", user, err)
	}
	// Without a password in the request the account keeps having none.
	if _, hash, _ := db.PasswordHash(ctx, "ann@example.com"); hash != "" {
		t.Errorf("hash = %q", hash)
	}
}

func TestOnlyTheNewestCodeCounts(t *testing.T) {
	db := openTestDB(t)
	startCode(t, db, "ann@example.com", "111111", "")
	startCode(t, db, "ann@example.com", "222222", "")
	ctx := context.Background()
	if _, err := db.VerifyEmailCode(ctx, "ann@example.com", accounts.HashCode("ann@example.com", "111111"), true); !errors.Is(err, accounts.ErrInvalidCode) {
		t.Errorf("old code = %v", err)
	}
	if _, err := db.VerifyEmailCode(ctx, "ann@example.com", accounts.HashCode("ann@example.com", "222222"), true); err != nil {
		t.Errorf("new code = %v", err)
	}
}

func TestACodeStopsAfterTooManyWrongGuesses(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	startCode(t, db, "ann@example.com", "123456", "")
	for range accounts.MaxCodeAttempts {
		if _, err := db.VerifyEmailCode(ctx, "ann@example.com", accounts.HashCode("ann@example.com", "000000"), true); !errors.Is(err, accounts.ErrInvalidCode) {
			t.Fatalf("wrong guess = %v", err)
		}
	}
	if _, err := db.VerifyEmailCode(ctx, "ann@example.com", accounts.HashCode("ann@example.com", "123456"), true); !errors.Is(err, accounts.ErrInvalidCode) {
		t.Errorf("right code after the limit = %v", err)
	}
}

func TestAnExpiredCodeFails(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	hash := accounts.HashCode("ann@example.com", "123456")
	if err := db.StartEmailCode(ctx, "ann@example.com", hash, "", accounts.Identity{}, time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.VerifyEmailCode(ctx, "ann@example.com", hash, true); !errors.Is(err, accounts.ErrInvalidCode) {
		t.Errorf("VerifyEmailCode() = %v", err)
	}
}

func TestClosedRegistrationCreatesNoAccount(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	startCode(t, db, "new@example.com", "123456", "")
	if _, err := db.VerifyEmailCode(ctx, "new@example.com", accounts.HashCode("new@example.com", "123456"), false); !errors.Is(err, accounts.ErrRegistrationClosed) {
		t.Errorf("VerifyEmailCode() = %v", err)
	}
	if _, _, err := db.PasswordHash(ctx, "new@example.com"); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("PasswordHash() = %v", err)
	}
}

func TestPasswordResetIsSingleUseAndEndsSessions(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	session := []byte("session-hash")
	if err := db.CreateSession(ctx, user.ID, session, "browser", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := db.CreatePasswordReset(ctx, user.ID, []byte("old-token"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := db.CreatePasswordReset(ctx, user.ID, []byte("token"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ResetPassword(ctx, []byte("old-token"), "x"); !errors.Is(err, accounts.ErrInvalidResetToken) {
		t.Errorf("an earlier link still works: %v", err)
	}

	got, err := db.ResetPassword(ctx, []byte("token"), "new-hash")
	if err != nil || got.ID != user.ID {
		t.Fatalf("ResetPassword() = %+v, %v", got, err)
	}
	if _, hash, _ := db.PasswordHash(ctx, "ann@example.com"); hash != "new-hash" {
		t.Errorf("hash = %q", hash)
	}
	if _, err := db.SessionByID(ctx, session); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("the session survived the reset: %v", err)
	}
	if _, err := db.ResetPassword(ctx, []byte("token"), "again"); !errors.Is(err, accounts.ErrInvalidResetToken) {
		t.Errorf("second use = %v", err)
	}
}

func TestAnExpiredResetFails(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	if err := db.CreatePasswordReset(ctx, user.ID, []byte("token"), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ResetPassword(ctx, []byte("token"), "x"); !errors.Is(err, accounts.ErrInvalidResetToken) {
		t.Errorf("ResetPassword() = %v", err)
	}
}

func TestSessions(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	if err := db.CreateSession(ctx, user.ID, []byte("live"), "browser", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateSession(ctx, user.ID, []byte("old"), "browser", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}

	s, err := db.SessionByID(ctx, []byte("live"))
	if err != nil || s.User.ID != user.ID || s.User.Email != "ann@example.com" {
		t.Fatalf("SessionByID() = %+v, %v", s, err)
	}
	if _, err := db.SessionByID(ctx, []byte("old")); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("expired session = %v", err)
	}

	later := time.Now().Add(48 * time.Hour).Truncate(time.Second)
	if err := db.ExtendSession(ctx, []byte("live"), later); err != nil {
		t.Fatal(err)
	}
	if s, _ := db.SessionByID(ctx, []byte("live")); !s.ExpiresAt.Equal(later) {
		t.Errorf("expires at %v, want %v", s.ExpiresAt, later)
	}

	if err := db.DeleteSession(ctx, []byte("live")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SessionByID(ctx, []byte("live")); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("deleted session = %v", err)
	}
}
