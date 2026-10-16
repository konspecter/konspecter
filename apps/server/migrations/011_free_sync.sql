-- Paid sync: the billing service may also give an account free sync, for a
-- while ('granted') or for life ('lifetime'); both have a time they work until.

ALTER TABLE entitlements DROP CONSTRAINT entitlements_status_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'granted', 'lifetime'));
