package entitlements

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client calls the billing service. Both sides authenticate with the same
// token.
type Client struct {
	// BaseURL is the service as the server reaches it ("http://billing:8081").
	BaseURL string
	Token   string
	// HTTP is the client to use (default one with a 10-second timeout).
	HTTP *http.Client
}

var defaultHTTP = &http.Client{Timeout: 10 * time.Second}

// ErrGateway means the billing service could not reach a payment gateway.
var ErrGateway = errors.New("the payment gateway did not answer")

type entitlementJSON struct {
	UserID  string     `json:"user_id"`
	Status  Status     `json:"status"`
	Until   *time.Time `json:"until"`
	Version int64      `json:"version"`
}

// Fetch asks the service for the user's entitlement. With startTrial (the
// account is syncing) an account due a trial starts it.
func (c *Client) Fetch(ctx context.Context, userID string, startTrial bool) (Entitlement, error) {
	path := "/internal/entitlements/" + url.PathEscape(userID)
	if startTrial {
		path += "?start_trial=1"
	}
	res, err := c.do(ctx, http.MethodGet, path)
	if err != nil {
		return Entitlement{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Entitlement{}, failure(res)
	}
	var body entitlementJSON
	if err := json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&body); err != nil {
		return Entitlement{}, fmt.Errorf("read entitlement: %w", err)
	}
	if body.UserID != userID {
		return Entitlement{}, fmt.Errorf("asked for %s's entitlement, got %q's", userID, body.UserID)
	}
	e := Entitlement{UserID: userID, Status: body.Status, Until: body.Until, Version: body.Version}
	if err := e.Check(); err != nil {
		return Entitlement{}, fmt.Errorf("entitlement of %s: %w", userID, err)
	}
	return e, nil
}

// Forget has the service cancel the user's renewing subscription at its
// gateway and delete what it keeps of the user: the account is about to be
// deleted. ErrGateway means the gateway could not be reached.
func (c *Client) Forget(ctx context.Context, userID string) error {
	res, err := c.do(ctx, http.MethodDelete, "/internal/users/"+url.PathEscape(userID))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusNoContent, http.StatusOK:
		return nil
	case http.StatusBadGateway:
		return fmt.Errorf("forget %s: %w", userID, ErrGateway)
	}
	return failure(res)
}

func (c *Client) do(ctx context.Context, method, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimSuffix(c.BaseURL, "/")+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	client := c.HTTP
	if client == nil {
		client = defaultHTTP
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("billing service: %w", err)
	}
	return res, nil
}

func failure(res *http.Response) error {
	answer, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	return fmt.Errorf("billing service: %s %s: %s: %s", res.Request.Method, res.Request.URL.Path, res.Status, strings.TrimSpace(string(answer)))
}
