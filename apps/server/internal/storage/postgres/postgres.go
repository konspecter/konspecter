// Package postgres stores users, tokens and notes in PostgreSQL.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"konspecter/server/migrations"
)

// DB is the PostgreSQL storage. It is safe for concurrent use.
type DB struct {
	pool *pgxpool.Pool
}

// Open connects to the database at url.
func Open(ctx context.Context, url string) (*DB, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	return OpenConfig(ctx, config)
}

// OpenConfig connects with an explicit pool configuration.
func OpenConfig(ctx context.Context, config *pgxpool.Config) (*DB, error) {
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	return &DB{pool: pool}, nil
}

// Close releases all connections.
func (db *DB) Close() { db.pool.Close() }

// Migrate applies the migrations that have not been applied yet, each in its
// own transaction, in file-name order.
func (db *DB) Migrate(ctx context.Context) error {
	if _, err := db.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		name       text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	names, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(names)
	for _, name := range names {
		if err := db.applyMigration(ctx, name); err != nil {
			return err
		}
	}
	return nil
}

func (db *DB) applyMigration(ctx context.Context, name string) error {
	sql, err := fs.ReadFile(migrations.FS, name)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", name, err)
	}
	return pgx.BeginFunc(ctx, db.pool, func(tx pgx.Tx) error {
		// Serialize concurrent migrators (e.g. two server instances starting).
		if _, err := tx.Exec(ctx, `LOCK TABLE schema_migrations IN EXCLUSIVE MODE`); err != nil {
			return fmt.Errorf("lock schema_migrations: %w", err)
		}
		var applied bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name,
		).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			return nil
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		return nil
	})
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// migrationNames is used by tests to check what was applied.
func (db *DB) migrationNames(ctx context.Context) ([]string, error) {
	rows, err := db.pool.Query(ctx, `SELECT name FROM schema_migrations ORDER BY name`)
	if err != nil {
		return nil, err
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	return names, err
}
