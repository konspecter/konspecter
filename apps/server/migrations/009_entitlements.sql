-- Paid sync: each account's latest entitlement from the billing service.
-- The account may sync while the status is not 'expired' and "until" has
-- not passed.

CREATE TABLE entitlements (
    user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    status     text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
    until      timestamptz,
    -- The billing service's version: a push older than the one kept is ignored.
    version    bigint NOT NULL CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (until IS NOT NULL OR status = 'expired')
);
