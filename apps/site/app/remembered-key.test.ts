import { createKey, openKeyTransfer } from "@konspecter/crypto";
import { forgetKey, forgetKeyUnless, rememberKey, sealRememberedKey } from "./remembered-key";

afterEach(async () => {
  await forgetKey();
});

it("remembers the key for one account and seals it for an app", async () => {
  const { record, raw } = await createKey("a long passphrase", 1_000);
  await rememberKey("ann@example.com", record.keyId, raw);

  expect(await sealRememberedKey("bob@example.com")).toBeNull();
  const sealed = await sealRememberedKey("ann@example.com");
  if (!sealed) throw new Error("not remembered");
  expect(sealed.keyId).toBe(record.keyId);
  const opened = await openKeyTransfer(sealed.keyId, sealed.sealedKey, sealed.secret);
  expect(opened.extractable).toBe(false);
  // A new secret each time.
  expect((await sealRememberedKey("ann@example.com"))?.secret).not.toBe(sealed.secret);
});

it("forgets a key that is not the account's current one", async () => {
  const { record, raw } = await createKey("a long passphrase", 1_000);
  await rememberKey("ann@example.com", record.keyId, raw);
  await forgetKeyUnless("ann@example.com", record.keyId);
  expect(await sealRememberedKey("ann@example.com")).not.toBeNull();

  await forgetKeyUnless("ann@example.com", "another-key");
  expect(await sealRememberedKey("ann@example.com")).toBeNull();

  await rememberKey("ann@example.com", record.keyId, raw);
  await forgetKeyUnless("ann@example.com", null);
  expect(await sealRememberedKey("ann@example.com")).toBeNull();
});
