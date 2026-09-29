import { Activity } from "./activity";

describe("Activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is active while work runs and lingers briefly after it ends", () => {
    const activity = new Activity({ linger: 100 });
    const listener = vi.fn();
    activity.subscribe(listener);

    const end = activity.begin();
    expect(activity.getSnapshot()).toBe(true);
    end();
    expect(activity.getSnapshot()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(activity.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stays active until the last of overlapping work ends", () => {
    const activity = new Activity({ linger: 0 });
    const first = activity.begin();
    const second = activity.begin();

    first();
    first();
    vi.runAllTimers();
    expect(activity.getSnapshot()).toBe(true);
    second();
    vi.runAllTimers();
    expect(activity.getSnapshot()).toBe(false);
  });

  it("keeps one pulse when new work starts during the linger", () => {
    const activity = new Activity({ linger: 100 });
    const listener = vi.fn();
    activity.subscribe(listener);

    activity.begin()();
    vi.advanceTimersByTime(50);
    const end = activity.begin();
    vi.advanceTimersByTime(100);
    expect(activity.getSnapshot()).toBe(true);
    end();
    vi.advanceTimersByTime(100);
    expect(activity.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
