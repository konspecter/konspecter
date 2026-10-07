import { createKey, keyToJson, openWithPassphrase, type KeyRecord } from "@konspecter/crypto";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { Encryption } from "./encryption";
import { forgetKey, rememberKey, sealRememberedKey } from "./remembered-key";

const ACCOUNT = "ann@example.com";

/** /api/keys in memory: the stored key's JSON, or none. Each call is recorded. */
function stubKeys(initial: Record<string, unknown> | null) {
  let stored = initial;
  const calls: { method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      expect(url).toBe("/api/keys");
      const method = init.method ?? "GET";
      const body =
        typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, body });
      if (method === "DELETE") {
        stored = null;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === "PUT" && body) {
        stored = {
          ...body,
          created_at: "2026-10-05T10:00:00Z",
          updated_at: "2026-10-05T11:00:00Z",
        };
      }
      return Promise.resolve(
        stored
          ? Response.json(stored)
          : Response.json({ error: { code: "no_key", message: "" } }, { status: 404 }),
      );
    }),
  );
  return { calls };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await forgetKey();
});

/** The id of the key this browser remembers for the account, or null. */
async function rememberedKeyId() {
  return (await sealRememberedKey(ACCOUNT))?.keyId ?? null;
}

function renderSection() {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ locale: "en" }),
      Component: () => <Encryption account={ACCOUNT} />,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

/** A stored key made with light stretching (the record says so), and its secrets. */
async function storedKey() {
  const { record, recoveryKey, raw } = await createKey("first long passphrase", 1_000);
  const json = {
    ...keyToJson(record),
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00.123456Z",
  };
  return { record, recoveryKey, raw, json };
}

/** Opens a disclosure and returns queries within it. */
async function open(user: ReturnType<typeof userEvent.setup>, summary: string) {
  const toggle = await screen.findByText(summary);
  await user.click(toggle);
  const details = toggle.closest("details");
  if (!details) throw new Error(`no disclosure ${summary}`);
  return within(details);
}

function asRecord(json: Record<string, unknown>): KeyRecord {
  return {
    keyId: json.key_id as string,
    kdf: json.kdf as string,
    kdfParams: json.kdf_params as { iterations: number },
    salt: json.salt as string,
    wrappedKey: json.wrapped_key as string,
    recoveryWrappedKey: json.recovery_wrapped_key as string,
  };
}

it("sets encryption up: a passphrase, then the recovery key typed back", async () => {
  const server = stubKeys(null);
  renderSection();
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("New passphrase"), "short");
  await user.type(screen.getByLabelText("Repeat the passphrase"), "short");
  await user.click(screen.getByRole("button", { name: "Set up encryption" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Use a longer passphrase.");

  await user.clear(screen.getByLabelText("New passphrase"));
  await user.clear(screen.getByLabelText("Repeat the passphrase"));
  await user.type(screen.getByLabelText("New passphrase"), "a long passphrase");
  await user.type(screen.getByLabelText("Repeat the passphrase"), "a long passphrase");
  await user.click(screen.getByRole("button", { name: "Set up encryption" }));

  const shown = (await screen.findByLabelText("Recovery key", {}, { timeout: 5000 })).textContent;
  expect(shown).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  expect(server.calls.map((c) => c.method)).toEqual(["GET"]); // Nothing stored yet.

  const confirm = screen.getByLabelText("Type the recovery key to confirm you saved it");
  await user.type(confirm, "AAAA-AAAA");
  await user.click(screen.getByRole("button", { name: "Finish setting up" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not the recovery key shown above");

  await user.clear(confirm);
  await user.type(confirm, shown.toLowerCase().replace(/-/g, " "));
  await user.click(screen.getByRole("button", { name: "Finish setting up" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Encryption is set up.");
  expect(screen.getByText(/Encryption is on, since/)).toBeInTheDocument();

  const put = server.calls.find((c) => c.method === "PUT")?.body ?? {};
  expect(put).not.toHaveProperty("updated_at");
  expect(put).toMatchObject({ kdf: "pbkdf2-sha256", kdf_params: { iterations: 600_000 } });
  // The server got the key wrapped; the passphrase opens it.
  expect(await openWithPassphrase(asRecord(put), "a long passphrase")).toHaveLength(32);
  // This browser remembers it, to hand to the apps it connects.
  expect(await rememberedKeyId()).toBe(put.key_id);
  expect(await screen.findByText(/This browser remembers the key/)).toBeInTheDocument();
}, 20_000);

it("changes the passphrase with the current one, based on the key as read", async () => {
  const { json, record } = await storedKey();
  const server = stubKeys(json);
  renderSection();
  const user = userEvent.setup();
  const change = await open(user, "Change the passphrase");

  await user.type(change.getByLabelText("Current passphrase"), "not the passphrase");
  await user.type(change.getByLabelText("New passphrase"), "second long passphrase");
  await user.type(change.getByLabelText("Repeat the passphrase"), "second long passphrase");
  await user.click(change.getByRole("button", { name: "Change passphrase" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The current passphrase is wrong.");

  await user.clear(change.getByLabelText("Current passphrase"));
  await user.type(change.getByLabelText("Current passphrase"), "first long passphrase");
  await user.click(change.getByRole("button", { name: "Change passphrase" }));
  expect(await screen.findByRole("status", {}, { timeout: 5000 })).toHaveTextContent(
    "The passphrase is changed.",
  );

  const put: Record<string, unknown> = server.calls.find((c) => c.method === "PUT")?.body ?? {};
  expect(put.key_id).toBe(record.keyId);
  expect(put.updated_at).toBe("2026-09-01T10:00:00.123456Z"); // The key as it was read.
  expect(put.recovery_wrapped_key).toBe(record.recoveryWrappedKey);
  expect(await openWithPassphrase(asRecord(put), "second long passphrase")).toHaveLength(32);
  expect(await rememberedKeyId()).toBe(record.keyId);
}, 20_000);

it("sets a new passphrase with the recovery key", async () => {
  const { json, recoveryKey } = await storedKey();
  const server = stubKeys(json);
  renderSection();
  const user = userEvent.setup();
  const recover = await open(user, "Forgot the passphrase?");
  await user.type(recover.getByLabelText("Recovery key"), recoveryKey);
  await user.type(recover.getByLabelText("New passphrase"), "recovered passphrase");
  await user.type(recover.getByLabelText("Repeat the passphrase"), "recovered passphrase");
  await user.click(recover.getByRole("button", { name: "Set new passphrase" }));
  expect(await screen.findByRole("status", {}, { timeout: 5000 })).toHaveTextContent(
    "The passphrase is changed.",
  );
  const put = server.calls.find((c) => c.method === "PUT")?.body ?? {};
  expect(await openWithPassphrase(asRecord(put), "recovered passphrase")).toHaveLength(32);
  expect(await rememberedKeyId()).toBe(put.key_id);
}, 20_000);

it("remembers the key on this browser with the passphrase, and forgets it", async () => {
  const { json, record } = await storedKey();
  stubKeys(json);
  renderSection();
  const user = userEvent.setup();
  const remember = await open(user, "Connect apps without the passphrase");

  await user.type(remember.getByLabelText("Passphrase"), "not the passphrase");
  await user.click(remember.getByRole("button", { name: "Remember on this browser" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That passphrase does not open this account's key.",
  );
  expect(await rememberedKeyId()).toBeNull();

  await user.clear(remember.getByLabelText("Passphrase"));
  await user.type(remember.getByLabelText("Passphrase"), "first long passphrase");
  await user.click(remember.getByRole("button", { name: "Remember on this browser" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "This browser remembers the key now.",
  );
  expect(await rememberedKeyId()).toBe(record.keyId);

  await user.click(await screen.findByRole("button", { name: "Forget on this browser" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "This browser no longer remembers the key.",
  );
  expect(await rememberedKeyId()).toBeNull();
  expect(await screen.findByText("Connect apps without the passphrase")).toBeInTheDocument();
});

it("forgets a remembered key the server no longer has", async () => {
  const old = await createKey("old long passphrase", 1_000);
  await rememberKey(ACCOUNT, old.record.keyId, old.raw);
  const { json } = await storedKey();
  stubKeys(json);
  renderSection();
  expect(await screen.findByText("Connect apps without the passphrase")).toBeInTheDocument();
  expect(await rememberedKeyId()).toBeNull();
});

it("resets encryption only once the loss is acknowledged", async () => {
  const { json, record, raw } = await storedKey();
  await rememberKey(ACCOUNT, record.keyId, raw);
  const server = stubKeys(json);
  renderSection();
  const user = userEvent.setup();
  const resetting = await open(user, "Reset encryption");
  const reset = resetting.getByRole("button", { name: "Delete server copies and reset" });
  expect(resetting.getByRole("checkbox")).toBeRequired();

  await user.click(resetting.getByRole("checkbox"));
  await user.click(reset);
  expect(await screen.findByRole("status")).toHaveTextContent("Encryption is reset");
  expect(server.calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  expect(await rememberedKeyId()).toBeNull();
  expect(screen.getByRole("button", { name: "Set up encryption" })).toBeInTheDocument();
});

it("says when the key changed elsewhere meanwhile", async () => {
  const { json } = await storedKey();
  stubKeys(json);
  renderSection();
  const user = userEvent.setup();
  const change = await open(user, "Change the passphrase");
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({ error: { code: "key_conflict", message: "" } }, { status: 409 }),
      ),
    ),
  );
  await user.type(change.getByLabelText("Current passphrase"), "first long passphrase");
  await user.type(change.getByLabelText("New passphrase"), "second long passphrase");
  await user.type(change.getByLabelText("Repeat the passphrase"), "second long passphrase");
  await user.click(change.getByRole("button", { name: "Change passphrase" }));
  expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
    "changed in another window or device",
  );
}, 20_000);
