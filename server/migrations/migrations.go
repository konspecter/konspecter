// Package migrations holds the PostgreSQL schema as ordered SQL files.
package migrations

import "embed"

// FS contains the migrations, applied in file-name order.
//
//go:embed *.sql
var FS embed.FS
