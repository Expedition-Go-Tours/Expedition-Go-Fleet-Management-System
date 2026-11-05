import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { formatDateRangeLabel, toDateKey } from "@/lib/domain/date-range";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

describe("DateRangePicker", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.searchParams = new URLSearchParams();
  });

  it("applies a single day as both ends and keeps other filters", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("vehicleId=veh-1");
    render(<DateRangePicker basePath="/fuel" />);

    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Today, / }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    const today = toDateKey(new Date());
    expect(mocks.replace).toHaveBeenCalledWith(`/fuel?vehicleId=veh-1&from=${today}&to=${today}`);
  });

  it("applies a preset as an inclusive multi-day range", async () => {
    const user = userEvent.setup();
    render(<DateRangePicker basePath="/expenses" />);

    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(mocks.replace).toHaveBeenCalledWith(
      `/expenses?from=${toDateKey(daysAgo(6))}&to=${toDateKey(new Date())}`,
    );
  });

  it("opens on the applied range and clears only the date params", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("category=FUEL&from=2026-10-01&to=2026-10-05");
    render(<DateRangePicker basePath="/expenses" />);

    await user.click(screen.getByRole("button", { name: /Filter by date: 01 Oct – 05 Oct 2026/ }));
    expect(
      within(screen.getByRole("dialog")).getByText("01 Oct – 05 Oct 2026"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Clear dates/ }));

    expect(mocks.replace).toHaveBeenCalledWith("/expenses?category=FUEL");
  });

  it("restarts the range on a fresh click after a complete selection", async () => {
    const user = userEvent.setup();
    mocks.searchParams = new URLSearchParams("from=2026-10-01&to=2026-10-05");
    render(<DateRangePicker basePath="/fuel" />);

    await user.click(screen.getByRole("button", { name: /Filter by date/ }));
    await user.click(screen.getByRole("button", { name: /^Today, / }));

    // A new anchor wins immediately; the summary shows the freshly clicked day.
    const today = toDateKey(new Date());
    expect(screen.getByText(formatDateRangeLabel({ from: today, to: today }))).toBeInTheDocument();
    expect(screen.getByText("Now choose an end date")).toBeInTheDocument();
  });
});
