import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { SPECIMENS } from "./specimen";
import { SLIDE_EVERY_MS, SpecimenSlider } from "./specimen-slider";

function renderSlider() {
  const Stub = createRoutesStub([
    {
      id: "root",
      path: "/",
      loader: () => ({ locale: "en" }),
      Component: () => <SpecimenSlider specimens={SPECIMENS.en} />,
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

/** The file on show: the one slide not hidden. */
function shown() {
  return screen.getByRole("group", { name: /, \d of 4$/ }).getAttribute("aria-label");
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows one conspect at a time, the others hidden", async () => {
  renderSlider();
  await screen.findByRole("group", { name: "Examples" });
  expect(shown()).toBe("Recipe, 1 of 4");
  expect(screen.getByRole("button", { name: "Recipe" })).toHaveAttribute("aria-current", "true");
  expect(document.querySelectorAll(".specimen-slide[aria-hidden='true']")).toHaveLength(3);
});

it("moves on by itself, round and round", async () => {
  renderSlider();
  await screen.findByRole("group", { name: "Examples" });
  await wait(SLIDE_EVERY_MS);
  expect(shown()).toBe("DevOps, 2 of 4");
  expect(document.querySelector(".is-leaving")).toHaveTextContent("grandmas-apple-pie.md");
  await wait(SLIDE_EVERY_MS);
  await wait(SLIDE_EVERY_MS);
  expect(shown()).toBe("Books, 4 of 4");
  await wait(SLIDE_EVERY_MS);
  expect(shown()).toBe("Recipe, 1 of 4");
});

it("waits while the pointer is on it, and a dot chooses a file", async () => {
  renderSlider();
  const dots = await screen.findByRole("group", { name: "Examples" });
  fireEvent.mouseEnter(dots.closest("figure") as HTMLElement);
  await wait(SLIDE_EVERY_MS * 2);
  expect(shown()).toBe("Recipe, 1 of 4");

  fireEvent.click(screen.getByRole("button", { name: "Books" }));
  expect(shown()).toBe("Books, 4 of 4");
  expect(screen.getByRole("button", { name: "Books" })).toHaveAttribute("aria-current", "true");
});

it("stands still for people who prefer less motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  renderSlider();
  await screen.findByRole("group", { name: "Examples" });
  await wait(SLIDE_EVERY_MS * 2);
  expect(shown()).toBe("Recipe, 1 of 4");
});
