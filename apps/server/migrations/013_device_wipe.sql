-- Disconnect and wipe. The owner may ask, as they disconnect a device, that
-- its app erase what it holds of the account. The app hears so on its next
-- request (401 device_wiped) and signs out once it has, which deletes the
-- row. Until then the row stays, however long ago it was disconnected.

ALTER TABLE devices ADD COLUMN wipe_requested_at timestamptz;
