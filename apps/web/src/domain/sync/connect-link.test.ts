import { parseConnectLink } from "./connect-link";

const code = "ksc_abcdefghijklmnopqrstuvwxyz012345";

describe("parseConnectLink", () => {
  it("reads the server and the code", () => {
    expect(parseConnectLink(`https://notes.example.com/connect#${code}`)).toEqual({
      serverUrl: "https://notes.example.com",
      code,
    });
    expect(parseConnectLink(` http://localhost:5174/connect/#${code}\n`)).toEqual({
      serverUrl: "http://localhost:5174",
      code,
    });
    expect(parseConnectLink(`https://example.com/notes/connect#${code}`)).toEqual({
      serverUrl: "https://example.com/notes",
      code,
    });
  });

  it("refuses anything else", () => {
    for (const text of [
      "",
      "not a link",
      `https://notes.example.com/activate#${code}`,
      `https://notes.example.com/connect`,
      `https://notes.example.com/connect#ksc_short`,
      `https://notes.example.com/connect?code=${code}`,
      `https://notes.example.com/connect?x=1#${code}`,
      `https://ann:pw@notes.example.com/connect#${code}`,
      `javascript:alert(1)//connect#${code}`,
      `ftp://notes.example.com/connect#${code}`,
    ]) {
      expect(parseConnectLink(text)).toBeNull();
    }
  });
});
