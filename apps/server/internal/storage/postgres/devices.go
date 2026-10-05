package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"konspecter/server/internal/auth"
	"konspecter/server/internal/devices"
)

// revokedKept is how long a disconnected device's row stays, so its app
// hears "device_revoked" rather than a bare "unauthorized".
const revokedKept = "30 days"

// cliDevice describes a token issued from the command line.
var cliDevice = devices.Client{Name: "Command line token", Platform: "other"}

// CreateToken issues a new API token for the user, as a device of its own
// (the command line). The token is returned once and only its hash is stored.
func (db *DB) CreateToken(ctx context.Context, userID string) (string, error) {
	token, hash, err := auth.NewToken()
	if err != nil {
		return "", err
	}
	if _, err := insertDevice(ctx, db.pool, userID, hash, cliDevice); err != nil {
		return "", err
	}
	return token, nil
}

func insertDevice(ctx context.Context, q querier, userID string, tokenHash []byte, client devices.Client) (devices.Device, error) {
	var d devices.Device
	err := q.QueryRow(ctx, `
		INSERT INTO devices (token_hash, user_id, name, platform, client_version) VALUES ($1, $2, $3, $4, $5)
		RETURNING `+deviceColumns, tokenHash, userID, client.Name, client.Platform, client.ClientVersion,
	).Scan(&d.ID, &d.Name, &d.Platform, &d.ClientVersion, &d.CreatedAt, &d.LastUsedAt, &d.LastSyncAt)
	if err != nil {
		return devices.Device{}, fmt.Errorf("create device: %w", err)
	}
	return d, nil
}

const deviceColumns = `id::text, name, platform, client_version, created_at, last_used_at, last_sync_at`

// RevokeToken deletes one token's device: the app signed itself out.
// Revoking an unknown token is not an error.
func (db *DB) RevokeToken(ctx context.Context, token string) error {
	if _, err := db.pool.Exec(ctx, `DELETE FROM devices WHERE token_hash = $1`, auth.HashToken(token)); err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	return nil
}

// RevokeUserTokens disconnects every device of a user and returns how many
// there were.
func (db *DB) RevokeUserTokens(ctx context.Context, userID string) (int64, error) {
	tag, err := db.pool.Exec(ctx,
		`UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	if err != nil {
		return 0, fmt.Errorf("revoke tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}

// DeviceByToken resolves a bearer token to its device and user, and records
// the use (at most once a minute, to spare the database a write per request).
// auth.ErrDeviceRevoked if the device was disconnected.
func (db *DB) DeviceByToken(ctx context.Context, token string) (auth.Device, error) {
	var d auth.Device
	var revoked bool
	err := db.pool.QueryRow(ctx, `
		WITH touched AS (
			UPDATE devices SET last_used_at = now()
			WHERE token_hash = $1 AND revoked_at IS NULL
				AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
		)
		SELECT d.id::text, d.revoked_at IS NOT NULL, u.id::text, u.email
		FROM devices d JOIN users u ON u.id = d.user_id
		WHERE d.token_hash = $1`, auth.HashToken(token),
	).Scan(&d.ID, &revoked, &d.User.ID, &d.User.Email)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return auth.Device{}, auth.ErrUnauthorized
	case err != nil:
		return auth.Device{}, fmt.Errorf("authenticate: %w", err)
	case revoked:
		return auth.Device{}, auth.ErrDeviceRevoked
	}
	return d, nil
}

// RecordSync notes that a device pulled changes (at most once a minute).
func (db *DB) RecordSync(ctx context.Context, deviceID string) error {
	if _, err := db.pool.Exec(ctx, `
		UPDATE devices SET last_sync_at = now()
		WHERE id = $1 AND (last_sync_at IS NULL OR last_sync_at < now() - interval '1 minute')`, deviceID,
	); err != nil {
		return fmt.Errorf("record sync: %w", err)
	}
	return nil
}

// ListDevices returns the user's connected devices, most recently active first.
func (db *DB) ListDevices(ctx context.Context, userID string) ([]devices.Device, error) {
	rows, err := db.pool.Query(ctx, `SELECT `+deviceColumns+` FROM devices
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY coalesce(last_used_at, created_at) DESC, id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (devices.Device, error) {
		var d devices.Device
		err := row.Scan(&d.ID, &d.Name, &d.Platform, &d.ClientVersion, &d.CreatedAt, &d.LastUsedAt, &d.LastSyncAt)
		return d, err
	})
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}
	return list, nil
}

// RevokeDevice disconnects one of the user's devices: its token stops
// working at once. devices.ErrNotFound if the user has no such connected
// device. Rows of devices disconnected long ago are dropped meanwhile.
func (db *DB) RevokeDevice(ctx context.Context, userID, deviceID string) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE devices SET revoked_at = now()
			WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`, userID, deviceID)
		if err != nil {
			return fmt.Errorf("revoke device: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return devices.ErrNotFound
		}
		if _, err := tx.Exec(ctx, `DELETE FROM devices
			WHERE user_id = $1 AND revoked_at < now() - interval '`+revokedKept+`'`, userID); err != nil {
			return fmt.Errorf("prune devices: %w", err)
		}
		return nil
	})
}

// CreateDeviceAuthorization stores an app's request to be connected, under
// the hashes of its two codes, and drops expired requests.
func (db *DB) CreateDeviceAuthorization(ctx context.Context, deviceCodeHash, userCodeHash []byte, client devices.Client, expiresAt time.Time) error {
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM device_authorizations WHERE expires_at <= now()`); err != nil {
			return fmt.Errorf("prune device authorizations: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO device_authorizations (device_code_hash, user_code_hash, name, platform, client_version, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			deviceCodeHash, userCodeHash, client.Name, client.Platform, client.ClientVersion, expiresAt,
		); err != nil {
			return fmt.Errorf("store device authorization: %w", err)
		}
		return nil
	})
}

// PendingDeviceAuthorization returns the app waiting under a user code.
// devices.ErrInvalidUserCode if none is waiting (unknown, decided or expired).
func (db *DB) PendingDeviceAuthorization(ctx context.Context, userCodeHash []byte) (devices.Client, error) {
	var c devices.Client
	err := db.pool.QueryRow(ctx, `
		SELECT name, platform, client_version FROM device_authorizations
		WHERE user_code_hash = $1 AND status = 'pending' AND expires_at > now()`, userCodeHash,
	).Scan(&c.Name, &c.Platform, &c.ClientVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return devices.Client{}, devices.ErrInvalidUserCode
	}
	if err != nil {
		return devices.Client{}, fmt.Errorf("find device authorization: %w", err)
	}
	return c, nil
}

// DecideDeviceAuthorization approves (for the user) or denies the app
// waiting under a user code. devices.ErrInvalidUserCode if none is waiting.
func (db *DB) DecideDeviceAuthorization(ctx context.Context, userCodeHash []byte, userID string, approve bool) (devices.Client, error) {
	status := "denied"
	if approve {
		status = "approved"
	}
	var c devices.Client
	err := db.pool.QueryRow(ctx, `
		UPDATE device_authorizations SET status = $2, user_id = $3
		WHERE user_code_hash = $1 AND status = 'pending' AND expires_at > now()
		RETURNING name, platform, client_version`, userCodeHash, status, userID,
	).Scan(&c.Name, &c.Platform, &c.ClientVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return devices.Client{}, devices.ErrInvalidUserCode
	}
	if err != nil {
		return devices.Client{}, fmt.Errorf("decide device authorization: %w", err)
	}
	return c, nil
}

// ExchangeDeviceCode is one poll of an app with its device code. Once the
// owner approved, it connects the device under tokenHash and returns it with
// its user; the code is then used up. Otherwise it returns why not:
// devices.ErrAuthorizationPending, ErrSlowDown (polled sooner than
// devices.Interval after the last poll), ErrAccessDenied or ErrExpiredToken.
func (db *DB) ExchangeDeviceCode(ctx context.Context, deviceCodeHash, tokenHash []byte) (devices.Device, auth.User, error) {
	var device devices.Device
	var user auth.User
	var outcome error
	err := pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		var (
			status   string
			userID   *string
			client   devices.Client
			expired  bool
			tooSoon  bool
			finished = func() error {
				_, err := tx.Exec(ctx, `DELETE FROM device_authorizations WHERE device_code_hash = $1`, deviceCodeHash)
				return err
			}
		)
		// A second of slack: timers in apps are not exact.
		err := tx.QueryRow(ctx, `
			SELECT status, user_id::text, name, platform, client_version, expires_at <= now(),
				coalesce(last_polled_at > now() - make_interval(secs => $2), false)
			FROM device_authorizations WHERE device_code_hash = $1 FOR UPDATE`,
			deviceCodeHash, (devices.Interval-time.Second).Seconds(),
		).Scan(&status, &userID, &client.Name, &client.Platform, &client.ClientVersion, &expired, &tooSoon)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			outcome = devices.ErrExpiredToken
			return nil
		case err != nil:
			return fmt.Errorf("find device authorization: %w", err)
		case expired:
			outcome = devices.ErrExpiredToken
			return finished()
		case status == "denied":
			outcome = devices.ErrAccessDenied
			return finished()
		}
		if _, err := tx.Exec(ctx,
			`UPDATE device_authorizations SET last_polled_at = now() WHERE device_code_hash = $1`, deviceCodeHash,
		); err != nil {
			return fmt.Errorf("record poll: %w", err)
		}
		switch {
		case tooSoon:
			outcome = devices.ErrSlowDown
			return nil
		case status == "pending" || userID == nil:
			outcome = devices.ErrAuthorizationPending
			return nil
		}
		if err := tx.QueryRow(ctx, `SELECT id::text, email FROM users WHERE id = $1`, *userID).Scan(&user.ID, &user.Email); err != nil {
			return fmt.Errorf("find user: %w", err)
		}
		if device, err = insertDevice(ctx, tx, user.ID, tokenHash, client); err != nil {
			return err
		}
		return finished()
	})
	if err != nil {
		return devices.Device{}, auth.User{}, fmt.Errorf("exchange device code: %w", err)
	}
	if outcome != nil {
		return devices.Device{}, auth.User{}, outcome
	}
	return device, user, nil
}
