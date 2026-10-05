package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"konspecter/server/internal/accounts"
)

func TestAVerifiedIdentityCreatesTheAccountAndSignsInAgain(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	google := accounts.Identity{Provider: "google", Subject: "g-1", Email: "ann@example.com", EmailVerified: true}

	user, err := db.SignInWithIdentity(ctx, google, true)
	if err != nil || user.Email != "ann@example.com" {
		t.Fatalf("first sign-in = %+v, %v", user, err)
	}
	// The account exists by address now, without a password.
	if got, hash, err := db.PasswordHash(ctx, "ann@example.com"); err != nil || got.ID != user.ID || hash != "" {
		t.Errorf("PasswordHash() = %+v, %q, %v", got, hash, err)
	}
	// Later sign-ins find the identity, even with another (or no) address.
	again, err := db.SignInWithIdentity(ctx, accounts.Identity{Provider: "google", Subject: "g-1"}, false)
	if err != nil || again.ID != user.ID {
		t.Errorf("second sign-in = %+v, %v", again, err)
	}
}

func TestAVerifiedIdentityLinksToTheAccountWithItsAddress(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	existing := createUser(t, db, "ann@example.com")
	yandex := accounts.Identity{Provider: "yandex", Subject: "y-1", Email: "ann@example.com", EmailVerified: true}

	user, err := db.SignInWithIdentity(ctx, yandex, false)
	if err != nil || user.ID != existing.ID {
		t.Fatalf("SignInWithIdentity() = %+v, %v", user, err)
	}
	var verified bool
	if err := db.pool.QueryRow(ctx, `SELECT email_verified_at IS NOT NULL FROM users WHERE id = $1`, user.ID).Scan(&verified); err != nil || !verified {
		t.Errorf("verified = %v, %v", verified, err)
	}
}

func TestANewIdentityWithoutAVerifiedAddressNeedsOne(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	createUser(t, db, "ann@example.com")
	for _, identity := range []accounts.Identity{
		{Provider: "x", Subject: "x-1"},
		// An unverified address must not reach the account that has it.
		{Provider: "vk", Subject: "v-1", Email: "ann@example.com"},
	} {
		if _, err := db.SignInWithIdentity(ctx, identity, true); !errors.Is(err, accounts.ErrEmailRequired) {
			t.Errorf("%s = %v", identity.Provider, err)
		}
	}
}

func TestIdentitiesRespectClosedRegistration(t *testing.T) {
	db := openTestDB(t)
	identity := accounts.Identity{Provider: "google", Subject: "g-1", Email: "new@example.com", EmailVerified: true}
	if _, err := db.SignInWithIdentity(context.Background(), identity, false); !errors.Is(err, accounts.ErrRegistrationClosed) {
		t.Errorf("SignInWithIdentity() = %v", err)
	}
}

func TestAPendingIdentityIsLinkedByTheEmailCode(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	x := accounts.Identity{Provider: "x", Subject: "x-1"}
	token := []byte("token-hash")
	if err := db.CreatePendingIdentity(ctx, token, accounts.Identity{Provider: "x", Subject: "x-1", Email: "hint@example.com"}, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	pending, err := db.PendingIdentity(ctx, token)
	if err != nil || pending != (accounts.Identity{Provider: "x", Subject: "x-1", Email: "hint@example.com"}) {
		t.Fatalf("PendingIdentity() = %+v, %v", pending, err)
	}

	hash := accounts.HashCode("ann@example.com", "123456")
	if err := db.StartEmailCode(ctx, "ann@example.com", hash, "", x, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	user, err := db.VerifyEmailCode(ctx, "ann@example.com", hash, true)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := db.SignInWithIdentity(ctx, x, false); err != nil || again.ID != user.ID {
		t.Errorf("sign-in after linking = %+v, %v", again, err)
	}
	if _, err := db.PendingIdentity(ctx, token); !errors.Is(err, accounts.ErrIdentityExpired) {
		t.Errorf("pending after linking = %v", err)
	}
}

func TestAPendingIdentityExpires(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	if err := db.CreatePendingIdentity(ctx, []byte("old"), accounts.Identity{Provider: "x", Subject: "x-1"}, time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.PendingIdentity(ctx, []byte("old")); !errors.Is(err, accounts.ErrIdentityExpired) {
		t.Errorf("expired = %v", err)
	}
	if _, err := db.PendingIdentity(ctx, []byte("unknown")); !errors.Is(err, accounts.ErrIdentityExpired) {
		t.Errorf("unknown = %v", err)
	}
}

func TestDeletingAUserDropsItsIdentities(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	identity := accounts.Identity{Provider: "google", Subject: "g-1", Email: "ann@example.com", EmailVerified: true}
	user, err := db.SignInWithIdentity(ctx, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, user.ID); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM user_identities`).Scan(&count); err != nil || count != 0 {
		t.Errorf("identities left = %d, %v", count, err)
	}
}
