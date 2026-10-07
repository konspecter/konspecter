import { rememberLocation, restoreLocation } from "./last-location";

const exists = (ids: string[]) => (id: string) => Promise.resolve(ids.includes(id));
const here = () => window.location.pathname + window.location.search;

describe("the last location", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("opens where the app was, when it starts on its start page", async () => {
    rememberLocation("/conspects/java%20notes");
    await restoreLocation(exists(["java notes"]));
    expect(here()).toBe("/conspects/java%20notes");

    window.history.replaceState(null, "", "/");
    rememberLocation("/?q=%23java");
    await restoreLocation(exists([]));
    expect(here()).toBe("/?q=%23java");
  });

  it("reads a location saved under the old /notes/ paths", async () => {
    localStorage.setItem("konspecter.lastLocation", "/notes/java");
    await restoreLocation(exists(["java"]));
    expect(here()).toBe("/conspects/java");
  });

  it("stays on a page the address already names (a link, a reload)", async () => {
    rememberLocation("/conspects/java");
    window.history.replaceState(null, "", "/settings");
    await restoreLocation(exists(["java"]));
    expect(here()).toBe("/settings");
  });

  it("stays on the list when the note is gone, or nothing useful was saved", async () => {
    rememberLocation("/conspects/deleted");
    await restoreLocation(exists([]));
    expect(here()).toBe("/");

    rememberLocation("/conspects/new");
    expect(localStorage.getItem("konspecter.lastLocation")).toBe("/conspects/deleted");

    for (const saved of ["//evil.example/x", "https://evil.example/", "conspects/x"]) {
      localStorage.setItem("konspecter.lastLocation", saved);
      await restoreLocation(exists(["x"]));
      expect(here()).toBe("/");
    }
  });
});
