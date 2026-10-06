// Package entitlements decides whether an account may sync when a billing
// service sells sync. The service owns subscriptions and payments; the
// server only keeps each account's latest entitlement, a status and the time
// sync works until, and enforces it.
package entitlements

import (
	"errors"
	"fmt"
	"time"
)

// Status is how an account's sync stands with the billing service.
type Status string

const (
	// Trialing: the free trial.
	Trialing Status = "trialing"
	// Active: paid, and renews.
	Active Status = "active"
	// PastDue: a renewal failed; sync works while it is retried.
	PastDue Status = "past_due"
	// Canceled: does not renew; sync works until the paid time is over.
	Canceled Status = "canceled"
	// Expired: no time left; sync waits for a payment.
	Expired Status = "expired"
)

// Valid reports whether s is one of the statuses.
func (s Status) Valid() bool {
	switch s {
	case Trialing, Active, PastDue, Canceled, Expired:
		return true
	}
	return false
}

// Entitlement is what the billing service last said of an account.
type Entitlement struct {
	UserID string
	Status Status
	// Until is when sync stops by itself, if nothing else happens. It is nil
	// only for an expired account that never had any time.
	Until *time.Time
	// Version orders an account's entitlements: the highest one is kept.
	Version int64
}

// ErrNone means the server holds no entitlement for the account yet.
var ErrNone = errors.New("no entitlement")

// Allowed reports whether the account may sync at now: the status is not
// expired, and its time has not run out. The time is the server's to
// enforce, so an account stops syncing on time even if no word comes.
func (e Entitlement) Allowed(now time.Time) bool {
	return e.Status != Expired && e.Until != nil && now.Before(*e.Until)
}

// Stale reports whether the entitlement says sync works but its time has
// run out: the billing service has news (a renewal, most likely) that did
// not reach the server, or it is truly over.
func (e Entitlement) Stale(now time.Time) bool {
	return e.Status != Expired && !e.Allowed(now)
}

// Check reports what is wrong with an entitlement from the billing service.
func (e Entitlement) Check() error {
	switch {
	case !e.Status.Valid():
		return fmt.Errorf("unknown status %q", e.Status)
	case e.Version <= 0:
		return errors.New("the version must be positive")
	case e.Until == nil && e.Status != Expired:
		return fmt.Errorf("%s needs a time it works until", e.Status)
	}
	return nil
}
