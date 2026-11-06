# ADR-029: Disconnecting and wiping a device

Status: accepted (2026-11-06). Extends [ADR-016](ADR-016-device-authorization.md), where
disconnecting is "a state of the app, not a wipe".

## Context

The site disconnects a device: its token stops working and its app keeps every note. That
suits a device the owner still has. For one that is lost, stolen, sold or left with someone
else, the owner wants the notes off it too, and only the site can still reach it.

## Decision

1. **Two actions on the site.** Settings → Connected devices offers **Disconnect** (as before)
   and **Disconnect and wipe**. Wipe asks first in a dialog that names the device and says what
   goes: the conspects it holds, on a computer the files sync covers (for good, not to the
   trash), and any change it has not synced. The dialog is a `?wipe=<id>` link, so it also
   works without JavaScript.
2. **The server carries the request.** `DELETE /api/devices/{id}?wipe=true` disconnects the
   device and sets `devices.wipe_requested_at`. Its token then gets `401 device_wiped` instead
   of `device_revoked`. Its event streams end at once, so an app that is online hears it
   within seconds; one that is offline hears it the next time it reaches the server.
3. **The app erases first, then tells the server.** The sync engine stops for good on
   `device_wiped` (state `wiping`: Settings → Sync says the device is being wiped and offers
   nothing to do) and hands `onWiped` a receipt: the server's address and the device's token.
   `wipe` in `presentation/app/factory-reset.ts` then erases, in this order:
   - on the desktop, every file sync covers, for good (`FolderSync.wipeFiles`, the Rust
     `folder_delete`). The files are the ones sync links to notes: every Markdown file it
     follows, synced or not yet. Files that `.konspecterignore` skips and other files in the
     folder stay. A file that cannot be deleted is reported and does not stop the rest;
   - the database: the app library and its indexes, settings, reading positions, the content
     key, the connection and sync's own records;
   - the chosen folder, then `localStorage`, which then keeps only the receipt and a flag
     for the notice;
   - last, the token kept outside the database (the desktop's keychain).

   If the database cannot be erased, nothing is confirmed and the token stays, so the next
   start hears `device_wiped` and wipes again. The app then reloads, and says once that it
   was wiped from the site.

4. **The receipt says the wipe is done.** At each start the app sends a receipt it keeps:
   `DELETE /api/tokens/current` with that token. The server takes it for a token that was
   asked to wipe, even from an address blocked for failed sign-ins, and deletes the row. The
   app tries a few more times while it runs (after 5 s, 30 s, 2 and 10 min), then at the
   next start, and forgets the receipt once the server has heard it, or no longer knows the
   token. Until then the row stays, however long ago it was disconnected (other revoked rows
   go after 30 days). The site lists the device as waiting to be wiped. A waiting device
   does not count as connected.
5. **A waiting device can be removed from the list.** Its only action on the site is
   **Remove from list**, for a device that never comes online again or could not send its
   receipt: `DELETE /api/devices/{id}/wipe` deletes the row, which withdraws the wipe. If
   that device goes online again, its token is unknown and it only disconnects. This is a
   separate route so that a **Disconnect** clicked in a stale tab cannot withdraw a wipe.
6. **Without `onWiped`, a wipe is a disconnect.** An app that does not know `device_wiped`,
   such as one from before this change, treats it as any `401` and keeps its notes.

## Consequences

- A server can now make an app erase what it holds. The server could already delete the
  account's notes through sync. A wipe also reaches what never synced, and only the server
  of the device's own connection can send it. See [security](../../security.md).
- Deleting the account removes the device rows: a device still waiting to be wiped then hears
  `unauthorized` and only disconnects.
- The wipe happens only when the device runs the app and reaches the server. Nothing erases
  a device that never comes online again.
- Until the server has heard it, the receipt keeps a token in `localStorage`. The server
  takes that token for nothing but signing out.
