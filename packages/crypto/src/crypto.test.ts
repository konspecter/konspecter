import { describe, expect, it } from "vitest";
import {
  createKey,
  decryptNote,
  DecryptionError,
  encryptNote,
  envelopeKeyId,
  formatRecoveryKey,
  fromBase64Url,
  isTransferSecret,
  ITERATIONS,
  keyFromJson,
  keyToJson,
  KDF,
  openKeyTransfer,
  openWithPassphrase,
  openWithRecoveryKey,
  parseRecoveryKey,
  rewrap,
  sealKeyForTransfer,
  toBase64Url,
  unlock,
  WrongSecretError,
  type KeyRecord,
} from "./crypto";

/** Tests stretch passphrases lightly; the record says how much, so this changes nothing else. */
const FAST = 1_000;

describe("the account's key", () => {
  it("opens with the passphrase and the recovery key, to the same content key", async () => {
    const { record, recoveryKey } = await createKey("correct horse battery", FAST);
    expect(record).toMatchObject({ kdf: KDF, kdfParams: { iterations: FAST } });
    expect(record.keyId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(fromBase64Url(record.salt)).toHaveLength(16);
    expect(recoveryKey).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);

    const byPassphrase = await openWithPassphrase(record, "correct horse battery");
    const byRecovery = await openWithRecoveryKey(record, recoveryKey.toLowerCase());
    expect(byPassphrase).toHaveLength(32);
    expect(byRecovery).toEqual(byPassphrase);
  });

  it("refuses a wrong passphrase or recovery key", async () => {
    const { record } = await createKey("correct horse battery", FAST);
    await expect(openWithPassphrase(record, "wrong horse battery")).rejects.toBeInstanceOf(
      WrongSecretError,
    );
    const other = formatRecoveryKey(new Uint8Array(20).fill(7));
    await expect(openWithRecoveryKey(record, other)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(openWithRecoveryKey(record, "not a key")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("will not open a wrapped key moved to another key id", async () => {
    const { record } = await createKey("correct horse battery", FAST);
    const moved: KeyRecord = { ...record, keyId: "another-key-" };
    await expect(openWithPassphrase(moved, "correct horse battery")).rejects.toBeInstanceOf(
      WrongSecretError,
    );
  });

  it("re-wraps for a new passphrase with a new salt, keeping the recovery key", async () => {
    const { record, recoveryKey } = await createKey("first passphrase", FAST);
    const raw = await openWithPassphrase(record, "first passphrase");
    const copy = new Uint8Array(raw);
    const next = await rewrap(record, raw, "second passphrase", FAST);

    expect(raw.every((byte) => byte === 0)).toBe(true); // Wiped.
    expect(next.keyId).toBe(record.keyId);
    expect(next.salt).not.toBe(record.salt);
    expect(next.recoveryWrappedKey).toBe(record.recoveryWrappedKey);
    expect(await openWithPassphrase(next, "second passphrase")).toEqual(copy);
    await expect(openWithPassphrase(next, "first passphrase")).rejects.toBeInstanceOf(
      WrongSecretError,
    );
    expect(await openWithRecoveryKey(next, recoveryKey)).toEqual(copy);
  });

  it("treats look-alike digits as letters in a typed recovery key", () => {
    const bytes = new Uint8Array(20).map((_, i) => i * 13);
    const key = formatRecoveryKey(bytes);
    const typed = key.replace(/O/g, "0").replace(/I/g, "1").replace(/-/g, " ");
    expect(parseRecoveryKey(typed)).toEqual(bytes);
    expect(parseRecoveryKey(key.slice(0, -1))).toBeNull();
  });

  it("refuses records it does not know how to open", async () => {
    const { record } = await createKey("correct horse battery", FAST);
    for (const broken of [
      { ...record, kdf: "scrypt" },
      { ...record, kdfParams: { iterations: 0 } },
      { ...record, kdfParams: { iterations: 1e9 } },
    ]) {
      await expect(openWithPassphrase(broken, "correct horse battery")).rejects.toBeInstanceOf(
        WrongSecretError,
      );
    }
  });

  it("uses 600 000 iterations for new keys by default", () => {
    expect(ITERATIONS).toBe(600_000);
  });
});

describe("handing the key to a new app", () => {
  it("opens with the one-time secret, to the account's content key", async () => {
    const { record, raw } = await createKey("correct horse battery", FAST);
    expect(raw).toEqual(await openWithPassphrase(record, "correct horse battery"));
    const transfer = await sealKeyForTransfer(raw, record.keyId);
    expect(isTransferSecret(transfer.secret)).toBe(true);
    expect(transfer.sealedKey).not.toContain(toBase64Url(raw));

    const handed = await openKeyTransfer(record.keyId, transfer.sealedKey, transfer.secret);
    expect(handed.extractable).toBe(false);
    const unlocked = await unlock(record, "correct horse battery");
    const envelope = await encryptNote(unlocked, record.keyId, "n1", "# Hello");
    expect(await decryptNote(handed, record.keyId, "n1", envelope)).toBe("# Hello");
  });

  it("refuses another secret, another key id, a tampered or malformed key", async () => {
    const { record, raw } = await createKey("correct horse battery", FAST);
    const { secret, sealedKey } = await sealKeyForTransfer(raw, record.keyId);
    const other = await sealKeyForTransfer(raw, record.keyId);
    const flipped = fromBase64Url(sealedKey);
    flipped[20] = (flipped[20] ?? 0) ^ 1;
    for (const [keyId, sealed, key] of [
      [record.keyId, sealedKey, other.secret],
      ["another-key-", sealedKey, secret],
      [record.keyId, toBase64Url(flipped), secret],
      [record.keyId, "not*base64", secret],
      [record.keyId, sealedKey, "short"],
    ] as const) {
      await expect(openKeyTransfer(keyId, sealed, key)).rejects.toBeInstanceOf(WrongSecretError);
    }
  });
});

describe("notes", () => {
  async function key() {
    const { record } = await createKey("correct horse battery", FAST);
    return { keyId: record.keyId, key: await unlock(record, "correct horse battery") };
  }

  it("round-trips a note through an envelope of its key", async () => {
    const { key: k, keyId } = await key();
    const markdown = "---\ntitle: Ключи\n---\n\n# Ключи 🔑\n\nВсё зашифровано.";
    const envelope = await encryptNote(k, keyId, "n1", markdown);
    expect(envelope.startsWith(`ksp1.${keyId}.`)).toBe(true);
    expect(envelope).not.toContain("Ключи");
    expect(envelopeKeyId(envelope)).toBe(keyId);
    expect(await decryptNote(k, keyId, "n1", envelope)).toBe(markdown);
    // A new IV each time.
    expect(await encryptNote(k, keyId, "n1", markdown)).not.toBe(envelope);
  });

  it("keeps the content key out of reach", async () => {
    const { key: k } = await key();
    expect(k.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", k)).rejects.toThrow();
  });

  it("refuses an envelope moved to another note", async () => {
    const { key: k, keyId } = await key();
    const envelope = await encryptNote(k, keyId, "n1", "secret");
    await expect(decryptNote(k, keyId, "n2", envelope)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("refuses tampering, another key, and plain text", async () => {
    const { key: k, keyId } = await key();
    const envelope = await encryptNote(k, keyId, "n1", "secret");
    const payload = fromBase64Url(envelope.split(".")[2] ?? "");
    payload[payload.length - 1] = (payload[payload.length - 1] ?? 0) ^ 1;
    const tampered = `ksp1.${keyId}.${toBase64Url(payload)}`;
    await expect(decryptNote(k, keyId, "n1", tampered)).rejects.toBeInstanceOf(DecryptionError);

    const other = await key();
    await expect(decryptNote(other.key, keyId, "n1", envelope)).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await expect(decryptNote(k, other.keyId, "n1", envelope)).rejects.toThrow("another key");
    await expect(decryptNote(k, keyId, "n1", "# Plain Markdown")).rejects.toThrow("not encrypted");
    expect(envelopeKeyId("# Plain")).toBeNull();
  });

  it("handles notes of several megabytes", async () => {
    const { key: k, keyId } = await key();
    const markdown = "x".repeat(5 * 1024 * 1024);
    const envelope = await encryptNote(k, keyId, "big", markdown);
    // Within the server's limit for 5 MiB of text (notes.MaxContentBytes, 7 MiB).
    expect(envelope.length).toBeLessThan(7 * 1024 * 1024);
    expect(await decryptNote(k, keyId, "big", envelope)).toBe(markdown);
  });
});

describe("the key's JSON", () => {
  it("round-trips through the server's form", async () => {
    const { record } = await createKey("correct horse battery", FAST);
    const json = keyToJson(record, "2026-10-05T10:00:00.123456Z");
    expect(json).toMatchObject({ key_id: record.keyId, kdf_params: { iterations: FAST } });
    const read = keyFromJson({ ...json, created_at: "2026-10-05T10:00:00Z" });
    expect(read).toEqual({
      ...record,
      createdAt: "2026-10-05T10:00:00Z",
      updatedAt: "2026-10-05T10:00:00.123456Z",
    });
    expect(keyToJson(record)).not.toHaveProperty("updated_at");
    expect(() => keyFromJson({ key_id: "k" })).toThrow(TypeError);
  });
});
