import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, readConfig } from "./config.server";

describe("readConfig", () => {
  it("uses defaults when nothing is set", () => {
    expect(readConfig({})).toEqual({
      publicOrigin: null,
      apiUrl: "http://localhost:8080",
      downloads: {},
      operator: { name: "", id: "", address: "", email: "" },
    });
  });

  it("reads the public origin, the API and the downloads that are set", () => {
    const config = readConfig({
      KONSPECTER_PUBLIC_URL: "https://notes.example.com/some/path",
      KONSPECTER_API_URL: "http://server:8080/",
      KONSPECTER_DOWNLOAD_MACOS_URL: " https://example.com/k.dmg ",
      KONSPECTER_DOWNLOAD_WEB_URL: "https://app.example.com",
      KONSPECTER_DOWNLOAD_LINUX_URL: "",
      KONSPECTER_LEGAL_NAME: " Ivan Petrov, sole proprietor ",
      KONSPECTER_LEGAL_ID: "123456789012",
      KONSPECTER_LEGAL_ADDRESS: "Moscow",
      KONSPECTER_LEGAL_EMAIL: "support@example.com",
    });
    expect(config).toEqual({
      publicOrigin: "https://notes.example.com",
      apiUrl: "http://server:8080",
      downloads: { macos: "https://example.com/k.dmg", web: "https://app.example.com/" },
      operator: {
        name: "Ivan Petrov, sole proprietor",
        id: "123456789012",
        address: "Moscow",
        email: "support@example.com",
      },
    });
  });

  it("rejects values that are not http(s) URLs", () => {
    expect(() => readConfig({ KONSPECTER_PUBLIC_URL: "notes.example.com" })).toThrow(
      /KONSPECTER_PUBLIC_URL/,
    );
    expect(() => readConfig({ KONSPECTER_DOWNLOAD_ANDROID_URL: "javascript:alert(1)" })).toThrow(
      /KONSPECTER_DOWNLOAD_ANDROID_URL/,
    );
  });
});

describe("loadEnvFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "konspecter-site-"));

  afterEach(() => {
    delete process.env.KONSPECTER_SITE_TEST_A;
    delete process.env.KONSPECTER_SITE_TEST_B;
  });

  it("fills in variables without overriding the real environment", () => {
    const file = join(dir, "site.env");
    writeFileSync(file, "KONSPECTER_SITE_TEST_A=file\nKONSPECTER_SITE_TEST_B=file\n");
    process.env.KONSPECTER_SITE_TEST_A = "real";
    loadEnvFile({ KONSPECTER_ENV_FILE: file });
    expect(process.env.KONSPECTER_SITE_TEST_A).toBe("real");
    expect(process.env.KONSPECTER_SITE_TEST_B).toBe("file");
  });

  it("ignores a missing default file but not a missing named one", () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => {
        loadEnvFile({});
      }).not.toThrow();
    } finally {
      process.chdir(cwd);
    }
    expect(() => {
      loadEnvFile({ KONSPECTER_ENV_FILE: join(dir, "missing.env") });
    }).toThrow();
  });
});
