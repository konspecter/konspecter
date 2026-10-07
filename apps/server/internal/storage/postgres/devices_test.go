package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"konspecter/server/internal/accounts"
	"konspecter/server/internal/auth"
	"konspecter/server/internal/devices"
	"konspecter/server/internal/keys"
)

var laptop = devices.Client{Name: "Firefox on Linux", Platform: "linux", ClientVersion: "0.2.0"}

// startAuthorization stores an app's request under the codes' plain bytes.
func startAuthorization(t *testing.T, db *DB, deviceCode, userCode string, expiresAt time.Time) {
	t.Helper()
	if err := db.CreateDeviceAuthorization(context.Background(), []byte(deviceCode), []byte(userCode), laptop, expiresAt); err != nil {
		t.Fatal(err)
	}
}

// allowPoll lets the next poll come at once.
func allowPoll(t *testing.T, db *DB) {
	t.Helper()
	if _, err := db.pool.Exec(context.Background(), `UPDATE device_authorizations SET last_polled_at = NULL`); err != nil {
		t.Fatal(err)
	}
}

func TestConnectingADevice(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	startAuthorization(t, db, "dev", "USER", time.Now().Add(10*time.Minute))

	if c, err := db.PendingDeviceAuthorization(ctx, []byte("USER")); err != nil || c != laptop {
		t.Fatalf("PendingDeviceAuthorization = %+v, %v", c, err)
	}
	if _, _, err := db.ExchangeDeviceCode(ctx, []byte("dev"), []byte("token")); !errors.Is(err, devices.ErrAuthorizationPending) {
		t.Errorf("before approval = %v", err)
	}
	if _, _, err := db.ExchangeDeviceCode(ctx, []byte("dev"), []byte("token")); !errors.Is(err, devices.ErrSlowDown) {
		t.Errorf("polling at once = %v", err)
	}
	if c, err := db.DecideDeviceAuthorization(ctx, []byte("USER"), user.ID, true); err != nil || c != laptop {
		t.Fatalf("approve = %+v, %v", c, err)
	}
	if _, err := db.DecideDeviceAuthorization(ctx, []byte("USER"), user.ID, false); !errors.Is(err, devices.ErrInvalidUserCode) {
		t.Errorf("deciding twice = %v", err)
	}

	allowPoll(t, db)
	token, hash, _ := auth.NewToken()
	device, owner, err := db.ExchangeDeviceCode(ctx, []byte("dev"), hash)
	if err != nil || owner != user || device.Name != laptop.Name || device.Platform != "linux" || device.ClientVersion != "0.2.0" {
		t.Fatalf("exchange = %+v, %+v, %v", device, owner, err)
	}
	if _, _, err := db.ExchangeDeviceCode(ctx, []byte("dev"), []byte("again")); !errors.Is(err, devices.ErrExpiredToken) {
		t.Errorf("used code = %v", err)
	}
	if got, err := db.DeviceByToken(ctx, token); err != nil || got.ID != device.ID || got.User != user {
		t.Errorf("DeviceByToken = %+v, %v", got, err)
	}
}

func TestADeniedDeviceIsNotConnected(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	startAuthorization(t, db, "dev", "USER", time.Now().Add(10*time.Minute))
	if _, err := db.DecideDeviceAuthorization(ctx, []byte("USER"), user.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := db.ExchangeDeviceCode(ctx, []byte("dev"), []byte("token")); !errors.Is(err, devices.ErrAccessDenied) {
		t.Errorf("denied = %v", err)
	}
	if _, _, err := db.ExchangeDeviceCode(ctx, []byte("dev"), []byte("token")); !errors.Is(err, devices.ErrExpiredToken) {
		t.Errorf("after denial = %v", err)
	}
	if list, _ := db.ListDevices(ctx, user.ID); len(list) != 0 {
		t.Errorf("devices = %+v", list)
	}
}

func TestAnExpiredAuthorizationCannotBeApprovedOrUsed(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	startAuthorization(t, db, "dev", "USER", time.Now().Add(-time.Second))
	if _, err := db.PendingDeviceAuthorization(ctx, []byte("USER")); !errors.Is(err, devices.ErrInvalidUserCode) {
		t.Errorf("pending = %v", err)
	}
	if _, err := db.DecideDeviceAuthorization(ctx, []byte("USER"), user.ID, true); !errors.Is(err, devices.ErrInvalidUserCode) {
		t.Errorf("approve = %v", err)
	}
	if _, _, err := db.ExchangeDeviceCode(ctx, []byte("dev"), []byte("token")); !errors.Is(err, devices.ErrExpiredToken) {
		t.Errorf("exchange = %v", err)
	}
	// Expired requests are dropped when the next one comes.
	startAuthorization(t, db, "dev2", "USER2", time.Now().Add(time.Minute))
	var count int
	if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM device_authorizations`).Scan(&count); err != nil || count != 1 {
		t.Errorf("authorizations = %d, %v", count, err)
	}
}

func TestListingAndRevokingDevices(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	ann := createUser(t, db, "ann@example.com")
	bob := createUser(t, db, "bob@example.com")
	first, _ := db.CreateToken(ctx, ann.ID)
	second, _ := db.CreateToken(ctx, ann.ID)
	if _, err := db.CreateToken(ctx, bob.ID); err != nil {
		t.Fatal(err)
	}

	used, err := db.DeviceByToken(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.RecordSync(ctx, used.ID); err != nil {
		t.Fatal(err)
	}
	list, err := db.ListDevices(ctx, ann.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("ListDevices = %+v, %v", list, err)
	}
	if list[0].ID != used.ID || list[0].LastUsedAt == nil || list[0].LastSyncAt == nil || list[1].LastUsedAt != nil {
		t.Errorf("most recent first, with activity: %+v", list)
	}
	if list[1].Name != "Command line token" || list[1].Platform != "other" {
		t.Errorf("command line device = %+v", list[1])
	}

	if err := db.RevokeDevice(ctx, bob.ID, used.ID); !errors.Is(err, devices.ErrNotFound) {
		t.Errorf("revoking another user's device = %v", err)
	}
	if err := db.RevokeDevice(ctx, ann.ID, used.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.RevokeDevice(ctx, ann.ID, used.ID); !errors.Is(err, devices.ErrNotFound) {
		t.Errorf("revoking twice = %v", err)
	}
	if _, err := db.DeviceByToken(ctx, first); !errors.Is(err, auth.ErrDeviceRevoked) {
		t.Errorf("revoked device = %v", err)
	}
	if _, err := db.DeviceByToken(ctx, second); err != nil {
		t.Errorf("the other device = %v", err)
	}
	if list, _ := db.ListDevices(ctx, ann.ID); len(list) != 1 {
		t.Errorf("devices after revoking = %+v", list)
	}

	// Long-revoked rows go when another device is revoked.
	if _, err := db.pool.Exec(ctx, `UPDATE devices SET revoked_at = now() - interval '31 days' WHERE id = $1`, used.ID); err != nil {
		t.Fatal(err)
	}
	other, _ := db.DeviceByToken(ctx, second)
	if err := db.RevokeDevice(ctx, ann.ID, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.DeviceByToken(ctx, first); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("pruned device = %v", err)
	}
}

func TestAccountNameAndDeletion(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	ann := createUser(t, db, "ann@example.com")
	bob := createUser(t, db, "bob@example.com")

	account, err := db.RenameAccount(ctx, ann.ID, "Ann Lee")
	if err != nil || account.Name != "Ann Lee" || account.Email != "ann@example.com" || account.CreatedAt.IsZero() {
		t.Fatalf("RenameAccount = %+v, %v", account, err)
	}
	if got, err := db.Account(ctx, ann.ID); err != nil || got != account {
		t.Errorf("Account = %+v, %v", got, err)
	}

	// Everything of hers: notes, devices, sessions, identities, codes.
	if _, err := db.CreateNote(ctx, ann.ID, "n1", "# Note", testKeyID); err != nil {
		t.Fatal(err)
	}
	token, _ := db.CreateToken(ctx, ann.ID)
	if err := db.CreateSession(ctx, ann.ID, []byte("s"), "", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SignInWithIdentity(ctx, accounts.Identity{Provider: "google", Subject: "g", Email: "ann@example.com", EmailVerified: true}, true); err != nil {
		t.Fatal(err)
	}
	startCode(t, db, "ann@example.com", "123456", "")
	startAuthorization(t, db, "dev", "USER", time.Now().Add(time.Minute))
	if _, err := db.DecideDeviceAuthorization(ctx, []byte("USER"), ann.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateNote(ctx, bob.ID, "n1", "# Bob's", testKeyID); err != nil {
		t.Fatal(err)
	}

	if err := db.DeleteAccount(ctx, ann.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.DeleteAccount(ctx, ann.ID); !errors.Is(err, ErrUserNotFound) {
		t.Errorf("deleting twice = %v", err)
	}
	if _, err := db.DeviceByToken(ctx, token); !errors.Is(err, auth.ErrUnauthorized) {
		t.Errorf("token after deletion = %v", err)
	}
	for table, where := range map[string]string{
		"notes": "user_id = $1", "sync_changes": "user_id = $1", "devices": "user_id = $1",
		"sessions": "user_id = $1", "user_identities": "user_id = $1", "device_authorizations": "user_id = $1",
		"email_codes": "email = 'ann@example.com' OR $1::uuid IS NULL",
	} {
		var count int
		if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE `+where, ann.ID).Scan(&count); err != nil || count != 0 {
			t.Errorf("%s rows left = %d, %v", table, count, err)
		}
	}
	if _, err := db.GetNote(ctx, bob.ID, "n1"); err != nil {
		t.Errorf("bob's note = %v", err)
	}
}

func TestConnectingADeviceByCode(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	user := createUser(t, db, "ann@example.com")
	if _, err := db.RenameAccount(ctx, user.ID, "Ann"); err != nil {
		t.Fatal(err)
	}

	if err := db.CreateConnectCode(ctx, user.ID, []byte("first"), time.Now().Add(5*time.Minute), &keys.Handover{KeyID: "k1", SealedKey: "sealed"}); err != nil {
		t.Fatal(err)
	}
	// A new code replaces the account's old one, and its key with it.
	if err := db.CreateConnectCode(ctx, user.ID, []byte("second"), time.Now().Add(5*time.Minute), nil); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := db.RedeemConnectCode(ctx, []byte("first"), []byte("t1"), laptop); !errors.Is(err, devices.ErrInvalidConnectCode) {
		t.Errorf("the replaced code = %v", err)
	}

	token, hash, _ := auth.NewToken()
	device, owner, key, err := db.RedeemConnectCode(ctx, []byte("second"), hash, laptop)
	if err != nil || owner.ID != user.ID || owner.Email != "ann@example.com" || owner.Name != "Ann" || device.Name != laptop.Name || key != nil {
		t.Fatalf("redeem = %+v, %+v, %+v, %v", device, owner, key, err)
	}
	if d, err := db.DeviceByToken(ctx, token); err != nil || d.ID != device.ID {
		t.Errorf("the new device's token = %+v, %v", d, err)
	}
	if _, _, _, err := db.RedeemConnectCode(ctx, []byte("second"), []byte("t2"), laptop); !errors.Is(err, devices.ErrInvalidConnectCode) {
		t.Errorf("a used code = %v", err)
	}

	// A code with a sealed key hands it over with the token.
	sealed := keys.Handover{KeyID: "k1", SealedKey: "sealed"}
	if err := db.CreateConnectCode(ctx, user.ID, []byte("keyed"), time.Now().Add(5*time.Minute), &sealed); err != nil {
		t.Fatal(err)
	}
	if _, _, key, err := db.RedeemConnectCode(ctx, []byte("keyed"), []byte("t4"), laptop); err != nil || key == nil || *key != sealed {
		t.Errorf("redeem with a key = %+v, %v", key, err)
	}

	if err := db.CreateConnectCode(ctx, user.ID, []byte("old"), time.Now().Add(-time.Second), nil); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := db.RedeemConnectCode(ctx, []byte("old"), []byte("t3"), laptop); !errors.Is(err, devices.ErrInvalidConnectCode) {
		t.Errorf("an expired code = %v", err)
	}
}
