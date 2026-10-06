package devices

import (
	"regexp"
	"strings"
	"testing"
)

func TestNewCodes(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		device, user, err := NewCodes()
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(device, "ksd_") || len(device) < 40 {
			t.Errorf("device code %q", device)
		}
		if !regexp.MustCompile(`^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$`).MatchString(user) {
			t.Errorf("user code %q", user)
		}
		if seen[user] {
			t.Errorf("user code %q repeated", user)
		}
		seen[user] = true
	}
}

func TestNormalizeUserCode(t *testing.T) {
	for input, want := range map[string]string{
		"BCDF-GHJK":   "BCDFGHJK",
		" bcdf ghjk ": "BCDFGHJK",
		"bcdfghjk":    "BCDFGHJK",
		"BCDF-GHJ":    "",
		"BCDF-GHJKL":  "",
		"ABCD-EFGH":   "", // vowels are not in the alphabet
		"BCDF/GHJK":   "",
		"":            "",
	} {
		if got := NormalizeUserCode(input); got != want {
			t.Errorf("NormalizeUserCode(%q) = %q, want %q", input, got, want)
		}
	}
	if FormatUserCode("BCDFGHJK") != "BCDF-GHJK" {
		t.Error("FormatUserCode")
	}
}

func TestNormalizeClient(t *testing.T) {
	got := NormalizeClient(Client{Name: "  Firefox\x00 on\nLinux ", Platform: " Linux", ClientVersion: "1.2.3"})
	if got != (Client{Name: "Firefox onLinux", Platform: "linux", ClientVersion: "1.2.3"}) {
		t.Errorf("NormalizeClient = %+v", got)
	}
	got = NormalizeClient(Client{Platform: "beos", ClientVersion: strings.Repeat("9", 100)})
	if got.Name != "Konspecter" || got.Platform != "other" || len(got.ClientVersion) != maxVersionLength {
		t.Errorf("NormalizeClient defaults = %+v", got)
	}
	long := NormalizeClient(Client{Name: strings.Repeat("я", 300)})
	if n := len([]rune(long.Name)); n != maxNameLength {
		t.Errorf("name kept %d characters", n)
	}
}

func TestHashCodeSeparatesCodes(t *testing.T) {
	if string(HashCode("BCDFGHJK")) == string(HashCode("BCDFGHJL")) || len(HashCode("x")) != 32 {
		t.Error("HashCode")
	}
}

func TestConnectCodes(t *testing.T) {
	a, err := NewConnectCode()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewConnectCode()
	if a == b || !ValidConnectCode(a) || !strings.HasPrefix(a, "ksc_") {
		t.Errorf("codes = %q, %q", a, b)
	}
	for _, bad := range []string{"", "ksc_short", "ksd_" + a[4:], a + "x", "ksc_" + strings.Repeat("!", 32)} {
		if ValidConnectCode(bad) {
			t.Errorf("ValidConnectCode(%q) = true", bad)
		}
	}
}
