// Package oauth signs people in with their accounts at other services: the
// OAuth 2.0 authorization code flow with state and, where the provider takes
// it, PKCE, followed by one call to the provider's user info endpoint to
// learn who signed in. Providers are rows in a table; no ID tokens are parsed.
package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

// IDs lists the providers this server knows, in the order the site shows them.
var IDs = []string{"google", "linkedin", "x", "yandex", "vk"}

// Profile is what a provider says about the account that signed in.
type Profile struct {
	// Subject is the provider's stable id for the account.
	Subject string
	// Email is the account's address, "" when the provider gave none.
	Email string
	// EmailVerified says the provider vouches that the account owns Email.
	EmailVerified bool
}

// Provider is one configured provider. Its fields are exported so tests can
// point it at a fake provider.
type Provider struct {
	ID     string
	Config oauth2.Config
	// PKCE sends a code challenge (RFC 7636) with the authorization request.
	PKCE bool
	// UserInfoURL is where the profile is read with the access token.
	UserInfoURL string
	// Client makes the token and user info requests.
	Client *http.Client
	spec   spec
}

// spec is a provider's row in the table.
type spec struct {
	authURL, tokenURL, userInfoURL string
	scopes                         []string
	pkce                           bool
	authStyle                      oauth2.AuthStyle
	// exchange adds provider-specific parameters to the token request.
	exchange func(callback url.Values) []oauth2.AuthCodeOption
	// profile reads the user info endpoint.
	profile func(ctx context.Context, p *Provider, token *oauth2.Token) (Profile, error)
}

var specs = map[string]spec{
	// OpenID Connect user info; email_verified is reliable.
	"google": {
		authURL:     "https://accounts.google.com/o/oauth2/v2/auth",
		tokenURL:    "https://oauth2.googleapis.com/token",
		userInfoURL: "https://openidconnect.googleapis.com/v1/userinfo",
		scopes:      []string{"openid", "email"},
		pkce:        true,
		authStyle:   oauth2.AuthStyleInParams,
		profile:     openIDProfile,
	},
	// Sign In with LinkedIn using OpenID Connect. LinkedIn takes PKCE from
	// native apps only; the client secret and state protect the web flow.
	"linkedin": {
		authURL:     "https://www.linkedin.com/oauth/v2/authorization",
		tokenURL:    "https://www.linkedin.com/oauth/v2/accessToken",
		userInfoURL: "https://api.linkedin.com/v2/userinfo",
		scopes:      []string{"openid", "email"},
		authStyle:   oauth2.AuthStyleInParams,
		profile:     openIDProfile,
	},
	// X gives no email address: the person proves one on the site.
	"x": {
		authURL:     "https://x.com/i/oauth2/authorize",
		tokenURL:    "https://api.x.com/2/oauth2/token",
		userInfoURL: "https://api.x.com/2/users/me",
		scopes:      []string{"users.read", "tweet.read"},
		pkce:        true,
		authStyle:   oauth2.AuthStyleInHeader,
		profile:     xProfile,
	},
	// Yandex ID. The app needs the "access to email address" permission.
	"yandex": {
		authURL:     "https://oauth.yandex.ru/authorize",
		tokenURL:    "https://oauth.yandex.ru/token",
		userInfoURL: "https://login.yandex.ru/info?format=json",
		scopes:      []string{"login:email"},
		pkce:        true,
		authStyle:   oauth2.AuthStyleInParams,
		profile:     yandexProfile,
	},
	// VK ID (OAuth 2.1): the token request repeats the device id and state
	// from the callback. VK does not say whether the address is confirmed.
	"vk": {
		authURL:     "https://id.vk.com/authorize",
		tokenURL:    "https://id.vk.com/oauth2/auth",
		userInfoURL: "https://id.vk.com/oauth2/user_info",
		scopes:      []string{"email"},
		pkce:        true,
		authStyle:   oauth2.AuthStyleInParams,
		exchange: func(callback url.Values) []oauth2.AuthCodeOption {
			return []oauth2.AuthCodeOption{
				oauth2.SetAuthURLParam("device_id", callback.Get("device_id")),
				oauth2.SetAuthURLParam("state", callback.Get("state")),
			}
		},
		profile: vkProfile,
	},
}

const requestTimeout = 10 * time.Second

// maxResponseBytes bounds what is read from a user info endpoint.
const maxResponseBytes = 1 << 20

// New returns the provider with an id from IDs. redirectURL is this server's
// callback, registered with the provider.
func New(id, clientID, clientSecret, redirectURL string) (*Provider, error) {
	s, ok := specs[id]
	if !ok {
		return nil, fmt.Errorf("unknown sign-in provider %q", id)
	}
	return &Provider{
		ID: id,
		Config: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     oauth2.Endpoint{AuthURL: s.authURL, TokenURL: s.tokenURL, AuthStyle: s.authStyle},
			RedirectURL:  redirectURL,
			Scopes:       s.scopes,
		},
		PKCE:        s.pkce,
		UserInfoURL: s.userInfoURL,
		Client:      &http.Client{Timeout: requestTimeout},
		spec:        s,
	}, nil
}

// NewSecret returns a random value for a state or a PKCE verifier.
func NewSecret() string { return oauth2.GenerateVerifier() }

// AuthCodeURL is where the browser goes to sign in at the provider.
func (p *Provider) AuthCodeURL(state, verifier string) string {
	var options []oauth2.AuthCodeOption
	if p.PKCE {
		options = append(options, oauth2.S256ChallengeOption(verifier))
	}
	return p.Config.AuthCodeURL(state, options...)
}

// Profile trades the callback's code for a token and reads who signed in.
// The caller has checked the callback's state.
func (p *Provider) Profile(ctx context.Context, callback url.Values, verifier string) (Profile, error) {
	code := callback.Get("code")
	if code == "" {
		return Profile{}, errors.New("the callback has no code")
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, p.Client)
	var options []oauth2.AuthCodeOption
	if p.PKCE {
		options = append(options, oauth2.VerifierOption(verifier))
	}
	if p.spec.exchange != nil {
		options = append(options, p.spec.exchange(callback)...)
	}
	token, err := p.Config.Exchange(ctx, code, options...)
	if err != nil {
		return Profile{}, fmt.Errorf("%s: exchange the code: %w", p.ID, err)
	}
	profile, err := p.spec.profile(ctx, p, token)
	if err != nil {
		return Profile{}, fmt.Errorf("%s: read the profile: %w", p.ID, err)
	}
	if profile.Subject == "" {
		return Profile{}, fmt.Errorf("%s: the profile has no account id", p.ID)
	}
	if profile.Email == "" {
		profile.EmailVerified = false
	}
	return profile, nil
}

func openIDProfile(ctx context.Context, p *Provider, token *oauth2.Token) (Profile, error) {
	var body struct {
		Subject       string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified any    `json:"email_verified"`
	}
	if err := p.getJSON(ctx, p.UserInfoURL, "Bearer "+token.AccessToken, &body); err != nil {
		return Profile{}, err
	}
	// Some providers send the flag as a string.
	verified := body.EmailVerified == true || body.EmailVerified == "true"
	return Profile{Subject: body.Subject, Email: body.Email, EmailVerified: verified}, nil
}

func xProfile(ctx context.Context, p *Provider, token *oauth2.Token) (Profile, error) {
	var body struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, p.UserInfoURL, "Bearer "+token.AccessToken, &body); err != nil {
		return Profile{}, err
	}
	return Profile{Subject: body.Data.ID}, nil
}

func yandexProfile(ctx context.Context, p *Provider, token *oauth2.Token) (Profile, error) {
	var body struct {
		ID           flexibleString `json:"id"`
		DefaultEmail string         `json:"default_email"`
	}
	if err := p.getJSON(ctx, p.UserInfoURL, "OAuth "+token.AccessToken, &body); err != nil {
		return Profile{}, err
	}
	// Yandex ID returns only addresses the account has confirmed.
	return Profile{Subject: string(body.ID), Email: body.DefaultEmail, EmailVerified: true}, nil
}

func vkProfile(ctx context.Context, p *Provider, token *oauth2.Token) (Profile, error) {
	form := url.Values{"client_id": {p.Config.ClientID}, "access_token": {token.AccessToken}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.UserInfoURL, strings.NewReader(form.Encode()))
	if err != nil {
		return Profile{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var body struct {
		User struct {
			ID    flexibleString `json:"user_id"`
			Email string         `json:"email"`
		} `json:"user"`
		Error string `json:"error"`
	}
	if err := p.doJSON(req, &body); err != nil {
		return Profile{}, err
	}
	if body.Error != "" {
		return Profile{}, fmt.Errorf("user info: %s", body.Error)
	}
	return Profile{Subject: string(body.User.ID), Email: body.User.Email}, nil
}

func (p *Provider) getJSON(ctx context.Context, address, authorization string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", authorization)
	return p.doJSON(req, into)
}

func (p *Provider) doJSON(req *http.Request, into any) error {
	req.Header.Set("Accept", "application/json")
	res, err := p.Client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return err
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("user info answered %d", res.StatusCode)
	}
	if err := json.Unmarshal(data, into); err != nil {
		return fmt.Errorf("user info: %w", err)
	}
	return nil
}

// flexibleString takes an id sent as a JSON string or number.
type flexibleString string

func (s *flexibleString) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		*s = flexibleString(text)
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(data, &number); err != nil {
		return err
	}
	if _, err := strconv.ParseInt(number.String(), 10, 64); err != nil {
		return fmt.Errorf("id %s is not a whole number", number)
	}
	*s = flexibleString(number.String())
	return nil
}
