/**
 * End-to-end encryption of synced notes, on WebCrypto alone.
 *
 * One random content key K (AES-256-GCM) per account encrypts every note.
 * The server keeps K only wrapped (encrypted) twice:
 *
 * - with a key derived from the owner's passphrase (PBKDF2-SHA256, 600 000
 *   iterations, a 16-byte salt), to unlock K on each device;
 * - with a key derived from a one-time recovery key (160 random bits shown
 *   in base32; being random it needs no slow stretching, so HKDF), to set a
 *   new passphrase when the old one is forgotten.
 *
 * A note travels as the envelope `ksp1.<keyId>.<base64url(iv ‖ ciphertext ‖
 * tag)>`, with the note's id as additional data: the server cannot read it,
 * change it unnoticed, or pass one note off as another.
 *
 * To connect an app without the passphrase, a browser that holds K seals it
 * with a one-time secret (HKDF again, being random) for the server to hand
 * over once; the secret travels only in the connect link's fragment.
 */

/** How the passphrase is stretched; the only method so far. */
export const KDF = "pbkdf2-sha256";
/** PBKDF2 iterations for new keys (OWASP's figure for PBKDF2-SHA256). */
export const ITERATIONS = 600_000;
/** The shortest passphrase the site accepts. */
export const MIN_PASSPHRASE_LENGTH = 10;

const ENVELOPE_VERSION = "ksp1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const KEY_ID_BYTES = 9;
const RECOVERY_BYTES = 20;
const TRANSFER_SECRET_BYTES = 32;
const MAX_ITERATIONS = 10_000_000;

/** The account's key as the server stores it (all binary values base64url). */
export interface KeyRecord {
  readonly keyId: string;
  readonly kdf: string;
  readonly kdfParams: { readonly iterations: number };
  readonly salt: string;
  /** K wrapped with the passphrase's key. */
  readonly wrappedKey: string;
  /** K wrapped with the recovery key's key. */
  readonly recoveryWrappedKey: string;
}

/** The passphrase or recovery key does not open this key (or the key was tampered with). */
export class WrongSecretError extends Error {
  override readonly name = "WrongSecretError";
  constructor() {
    super("The passphrase or recovery key is wrong");
  }
}

/** A note could not be decrypted: another key, another note's envelope, or tampered with. */
export class DecryptionError extends Error {
  override readonly name = "DecryptionError";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function random(bytes: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

// --- base64url and base32 ---------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new DecryptionError("Not base64url");
  }
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

function fromBase32(text: string): Uint8Array<ArrayBuffer> | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// --- The recovery key -------------------------------------------------------

/** A recovery key as people see it: 32 letters and digits in groups of four. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  return (toBase32(bytes).match(/.{1,4}/g) ?? []).join("-");
}

/**
 * The bytes of a typed recovery key: case, spaces and dashes do not matter,
 * and the digits 0, 1 and 8 count as the letters O, I and B they look like.
 * Null if it is not one.
 */
export function parseRecoveryKey(text: string): Uint8Array<ArrayBuffer> | null {
  const cleaned = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B");
  if (cleaned.length !== Math.ceil((RECOVERY_BYTES * 8) / 5)) return null;
  const bytes = fromBase32(cleaned);
  return bytes?.length === RECOVERY_BYTES ? bytes : null;
}

// --- Wrapping keys ----------------------------------------------------------

async function passphraseKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function recoveryKeyKey(recovery: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey("raw", recovery, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode("konspecter/recovery/v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function keyAad(keyId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`konspecter/key/v1|${keyId}`);
}

async function seal(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
) {
  const iv = random(IV_BYTES);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return out;
}

/** Opens what `seal` made; null when the key or the additional data is wrong. */
async function open(key: CryptoKey, data: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>) {
  if (data.length < IV_BYTES + TAG_BYTES) return null;
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: data.subarray(0, IV_BYTES), additionalData: aad },
        key,
        data.subarray(IV_BYTES),
      ),
    );
  } catch {
    return null;
  }
}

async function wrapWithPassphrase(
  raw: Uint8Array<ArrayBuffer>,
  keyId: string,
  passphrase: string,
  iterations: number,
) {
  const salt = random(SALT_BYTES);
  const wrapped = await seal(await passphraseKey(passphrase, salt, iterations), raw, keyAad(keyId));
  return { salt: toBase64Url(salt), wrappedKey: toBase64Url(wrapped) };
}

function checkRecord(record: KeyRecord): number {
  const { iterations } = record.kdfParams;
  if (
    record.kdf !== KDF ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > MAX_ITERATIONS
  ) {
    throw new WrongSecretError();
  }
  return iterations;
}

// --- The account's key ------------------------------------------------------

/**
 * Makes the account's key: a new content key, wrapped with the passphrase
 * and with a new recovery key, which is returned once to show to the owner.
 * `raw` is the content key itself, for the caller to keep (or wipe).
 * `iterations` is for tests only.
 */
export async function createKey(
  passphrase: string,
  iterations: number = ITERATIONS,
): Promise<{ record: KeyRecord; recoveryKey: string; raw: Uint8Array<ArrayBuffer> }> {
  const raw = random(32);
  const keyId = toBase64Url(random(KEY_ID_BYTES));
  const recovery = random(RECOVERY_BYTES);
  const wrapped = await wrapWithPassphrase(raw, keyId, passphrase, iterations);
  const recoveryWrapped = await seal(await recoveryKeyKey(recovery), raw, keyAad(keyId));
  return {
    record: {
      keyId,
      kdf: KDF,
      kdfParams: { iterations },
      ...wrapped,
      recoveryWrappedKey: toBase64Url(recoveryWrapped),
    },
    recoveryKey: formatRecoveryKey(recovery),
    raw,
  };
}

/** The raw content key, opened with the passphrase. Throws WrongSecretError. */
export async function openWithPassphrase(
  record: KeyRecord,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const iterations = checkRecord(record);
  const key = await passphraseKey(passphrase, fromBase64Url(record.salt), iterations);
  const raw = await open(key, fromBase64Url(record.wrappedKey), keyAad(record.keyId));
  if (!raw) throw new WrongSecretError();
  return raw;
}

/** The raw content key, opened with the recovery key. Throws WrongSecretError. */
export async function openWithRecoveryKey(
  record: KeyRecord,
  recoveryKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const recovery = parseRecoveryKey(recoveryKey);
  if (!recovery) throw new WrongSecretError();
  const key = await recoveryKeyKey(recovery);
  const raw = await open(key, fromBase64Url(record.recoveryWrappedKey), keyAad(record.keyId));
  if (!raw) throw new WrongSecretError();
  return raw;
}

/**
 * The record with K wrapped for a new passphrase (and a new salt). The
 * recovery key stays the same. `raw` is K as one of the open functions
 * returned it; it is wiped afterwards.
 */
export async function rewrap(
  record: KeyRecord,
  raw: Uint8Array<ArrayBuffer>,
  passphrase: string,
  iterations: number = ITERATIONS,
): Promise<KeyRecord> {
  try {
    const wrapped = await wrapWithPassphrase(raw, record.keyId, passphrase, iterations);
    return { ...record, kdf: KDF, kdfParams: { iterations }, ...wrapped };
  } finally {
    raw.fill(0);
  }
}

/**
 * The content key for encrypting and decrypting notes, opened with the
 * passphrase. It is not extractable: it can be stored (IndexedDB) and used,
 * but its bytes cannot be read back out.
 */
export async function unlock(record: KeyRecord, passphrase: string): Promise<CryptoKey> {
  const raw = await openWithPassphrase(record, passphrase);
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

// --- Handing the key to a new app -------------------------------------------

/** The content key sealed for one app, and the secret that opens it. */
export interface KeyTransfer {
  /** 32 random bytes (base64url): for the connect link's fragment only. */
  readonly secret: string;
  /** K sealed with the secret's key: for the server to hand over once. */
  readonly sealedKey: string;
}

/** Whether `text` has the form of a transfer secret (32 bytes in base64url). */
export function isTransferSecret(text: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(text);
}

async function transferKey(secret: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode("konspecter/transfer/v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function transferAad(keyId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`konspecter/transfer/v1|${keyId}`);
}

/** Seals the raw content key `raw` (of `keyId`) with a new one-time secret. */
export async function sealKeyForTransfer(
  raw: Uint8Array<ArrayBuffer>,
  keyId: string,
): Promise<KeyTransfer> {
  const secret = random(TRANSFER_SECRET_BYTES);
  const sealed = await seal(await transferKey(secret), raw, transferAad(keyId));
  return { secret: toBase64Url(secret), sealedKey: toBase64Url(sealed) };
}

/**
 * The content key a browser sealed for this app, opened with the secret
 * from the link, as `unlock` returns it (not extractable). Throws
 * WrongSecretError when the secret, the key id or the sealed key is wrong.
 */
export async function openKeyTransfer(
  keyId: string,
  sealedKey: string,
  secret: string,
): Promise<CryptoKey> {
  if (!isTransferSecret(secret)) throw new WrongSecretError();
  let raw: Uint8Array<ArrayBuffer> | null;
  try {
    raw = await open(
      await transferKey(fromBase64Url(secret)),
      fromBase64Url(sealedKey),
      transferAad(keyId),
    );
  } catch (error) {
    if (error instanceof DecryptionError) throw new WrongSecretError();
    throw error;
  }
  if (raw?.length !== 32) throw new WrongSecretError();
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

// --- Notes -------------------------------------------------------------------

function noteAad(noteId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`konspecter/note/v1|${noteId}`);
}

/** The key id an envelope names, or null if the text is not an envelope. */
export function envelopeKeyId(envelope: string): string | null {
  const match = /^ksp1\.([A-Za-z0-9_-]{1,64})\.[A-Za-z0-9_-]+$/.exec(envelope);
  return match?.[1] ?? null;
}

/** Encrypts a note's Markdown into an envelope. */
export async function encryptNote(
  key: CryptoKey,
  keyId: string,
  noteId: string,
  markdown: string,
): Promise<string> {
  const sealed = await seal(key, encoder.encode(markdown), noteAad(noteId));
  return `${ENVELOPE_VERSION}.${keyId}.${toBase64Url(sealed)}`;
}

/**
 * Decrypts a note's envelope. Throws DecryptionError when it is not an
 * envelope of this key for this note, or was changed.
 */
export async function decryptNote(
  key: CryptoKey,
  keyId: string,
  noteId: string,
  envelope: string,
): Promise<string> {
  const named = envelopeKeyId(envelope);
  if (named === null) throw new DecryptionError(`Note ${noteId} is not encrypted`);
  if (named !== keyId) throw new DecryptionError(`Note ${noteId} is encrypted with another key`);
  const payload = envelope.slice(envelope.lastIndexOf(".") + 1);
  const plain = await open(key, fromBase64Url(payload), noteAad(noteId));
  if (!plain) throw new DecryptionError(`Note ${noteId} could not be decrypted`);
  try {
    return decoder.decode(plain);
  } catch {
    throw new DecryptionError(`Note ${noteId} is not text`);
  }
}

// --- The key's JSON form (GET and PUT /api/keys) ------------------------------

/** A key record as the server sends it, with the time it last changed. */
export interface StoredKey extends KeyRecord {
  readonly createdAt: string;
  /** Sent back with a re-wrap, so a change made meanwhile is not overwritten. */
  readonly updatedAt: string;
}

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string") throw new TypeError(`The key has no ${name}`);
  return value;
}

/** Reads the server's JSON of a key. Throws TypeError when it is not one. */
export function keyFromJson(value: unknown): StoredKey {
  if (typeof value !== "object" || value === null) throw new TypeError("The key is not an object");
  const body = value as Record<string, unknown>;
  const params = body.kdf_params;
  const iterations =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>).iterations
      : undefined;
  if (typeof iterations !== "number") throw new TypeError("The key has no iterations");
  return {
    keyId: field(body, "key_id"),
    kdf: field(body, "kdf"),
    kdfParams: { iterations },
    salt: field(body, "salt"),
    wrappedKey: field(body, "wrapped_key"),
    recoveryWrappedKey: field(body, "recovery_wrapped_key"),
    createdAt: field(body, "created_at"),
    updatedAt: field(body, "updated_at"),
  };
}

/** The JSON to PUT: a new key without `updatedAt`, a re-wrap with the one read. */
export function keyToJson(record: KeyRecord, updatedAt?: string): Record<string, unknown> {
  return {
    key_id: record.keyId,
    kdf: record.kdf,
    kdf_params: { iterations: record.kdfParams.iterations },
    salt: record.salt,
    wrapped_key: record.wrappedKey,
    recovery_wrapped_key: record.recoveryWrappedKey,
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
  };
}
