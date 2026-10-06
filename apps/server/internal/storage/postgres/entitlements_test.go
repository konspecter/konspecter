package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"konspecter/server/internal/entitlements"
)

func TestEntitlementsKeepTheLatestVersion(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	if _, err := db.Entitlement(ctx, user.ID); !errors.Is(err, entitlements.ErrNone) {
		t.Errorf("none yet = %v", err)
	}
	until := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	put := func(e entitlements.Entitlement) bool {
		t.Helper()
		e.UserID = user.ID
		stored, err := db.PutEntitlement(ctx, e)
		if err != nil {
			t.Fatal(err)
		}
		return stored
	}
	if !put(entitlements.Entitlement{Status: entitlements.Active, Until: &until, Version: 5}) {
		t.Error("the first one was not kept")
	}
	if put(entitlements.Entitlement{Status: entitlements.Expired, Version: 4}) || put(entitlements.Entitlement{Status: entitlements.Expired, Version: 5}) {
		t.Error("an older version was kept")
	}
	if !put(entitlements.Entitlement{Status: entitlements.Expired, Version: 6}) {
		t.Error("a newer version was not kept")
	}
	e, err := db.Entitlement(ctx, user.ID)
	if err != nil || e.Status != entitlements.Expired || e.Until != nil || e.Version != 6 || e.UserID != user.ID {
		t.Errorf("entitlement = %+v, %v", e, err)
	}

	for _, id := range []string{"00000000-0000-4000-8000-000000000000", "not-a-uuid"} {
		if _, err := db.PutEntitlement(ctx, entitlements.Entitlement{UserID: id, Status: entitlements.Expired, Version: 1}); !errors.Is(err, ErrUserNotFound) {
			t.Errorf("put for %s = %v", id, err)
		}
		if _, err := db.Entitlement(ctx, id); !errors.Is(err, entitlements.ErrNone) {
			t.Errorf("read for %s = %v", id, err)
		}
	}

	// Deleting the account deletes its entitlement.
	if err := db.DeleteAccount(ctx, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Entitlement(ctx, user.ID); !errors.Is(err, entitlements.ErrNone) {
		t.Errorf("after deleting = %v", err)
	}
}

func TestRecipient(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ada@example.com")
	if email, locale, err := db.Recipient(ctx, user.ID); err != nil || email != "ada@example.com" || locale != "en" {
		t.Errorf("recipient = %q %q %v", email, locale, err)
	}
	if err := db.SetLocale(ctx, user.ID, "ru"); err != nil {
		t.Fatal(err)
	}
	if _, locale, _ := db.Recipient(ctx, user.ID); locale != "ru" {
		t.Errorf("locale = %q", locale)
	}
	if _, _, err := db.Recipient(ctx, "00000000-0000-4000-8000-000000000000"); !errors.Is(err, ErrUserNotFound) {
		t.Errorf("unknown user = %v", err)
	}
}
