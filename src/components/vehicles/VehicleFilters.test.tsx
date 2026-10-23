import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VehicleFilters } from "@/components/vehicles/VehicleFilters";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}));

describe("VehicleFilters", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.searchParams = new URLSearchParams();
  });

  it("keeps focus while typing and updates the URL once after a pause", async () => {
    const user = userEvent.setup();
    render(<VehicleFilters />);

    const input = screen.getByLabelText("Search vehicles");
    await user.click(input);
    await user.keyboard("AB");

    expect(input).toHaveFocus();
    expect(input).toHaveValue("AB");
    expect(mocks.replace).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/vehicles?q=AB");
  });
});
