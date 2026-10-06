import { render, screen } from "@testing-library/react";
import { modulesPath, QrCode } from "./qr-code";

it("draws each run of dark modules as one rectangle", () => {
  expect(
    modulesPath([
      [true, true, false, true],
      [false, false, false, false],
      [false, true, true, true],
    ]),
  ).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z");
});

it("is a labelled picture with a quiet zone", () => {
  render(<QrCode value="https://notes.example.com/connect#ksc_x" label="QR code" />);
  const picture = screen.getByRole("img", { name: "QR code" });
  const size = Number(picture.getAttribute("viewBox")?.split(" ")[2]);
  // Version 3 (29 modules) and four modules of border on each side.
  expect(size).toBe(37);
  expect(picture.querySelector("path")?.getAttribute("d")).toMatch(/^M4 4h7v1h-7z/);
});
