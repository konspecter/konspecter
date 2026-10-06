package entitlements

import (
	"testing"
	"time"
)

func at(t time.Time) *time.Time { return &t }

func TestAllowed(t *testing.T) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	later, earlier := at(now.Add(time.Hour)), at(now.Add(-time.Hour))
	cases := []struct {
		e              Entitlement
		allowed, stale bool
	}{
		{Entitlement{Status: Trialing, Until: later}, true, false},
		{Entitlement{Status: Active, Until: later}, true, false},
		{Entitlement{Status: PastDue, Until: later}, true, false},
		{Entitlement{Status: Canceled, Until: later}, true, false},
		{Entitlement{Status: Active, Until: earlier}, false, true},
		{Entitlement{Status: Canceled, Until: at(now)}, false, true},
		{Entitlement{Status: Expired, Until: later}, false, false},
		{Entitlement{Status: Expired}, false, false},
		{Entitlement{Status: Active}, false, true},
	}
	for _, c := range cases {
		if got := c.e.Allowed(now); got != c.allowed {
			t.Errorf("%s until %v: allowed = %v", c.e.Status, c.e.Until, got)
		}
		if got := c.e.Stale(now); got != c.stale {
			t.Errorf("%s until %v: stale = %v", c.e.Status, c.e.Until, got)
		}
	}
}

func TestCheck(t *testing.T) {
	until := at(time.Now())
	for _, ok := range []Entitlement{
		{Status: Active, Until: until, Version: 1},
		{Status: Expired, Version: 2},
		{Status: Expired, Until: until, Version: 3},
	} {
		if err := ok.Check(); err != nil {
			t.Errorf("%+v: %v", ok, err)
		}
	}
	for _, bad := range []Entitlement{
		{Status: "paused", Until: until, Version: 1},
		{Status: Active, Until: until},
		{Status: Trialing, Version: 1},
	} {
		if err := bad.Check(); err == nil {
			t.Errorf("%+v passed", bad)
		}
	}
}
