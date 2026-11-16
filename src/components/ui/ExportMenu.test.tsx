import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ExportMenu } from "@/components/ui/ExportMenu";

const CSV_HREF = "/api/v1/fuel/export?format=csv&from=2026-10-12&to=2026-10-18";
const PDF_HREF = "/api/v1/fuel/export?format=pdf&from=2026-10-12&to=2026-10-18";
const HINT = "12 Oct – 18 Oct 2026 · All vehicles";

describe("ExportMenu", () => {
  it("keeps the downloads hidden until the trigger is opened", () => {
    render(<ExportMenu csvHref={CSV_HREF} pdfHref={PDF_HREF} hint={HINT} />);

    expect(screen.getByRole("button", { name: /export/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("offers both formats as plain links carrying the active filters", async () => {
    const user = userEvent.setup();
    render(<ExportMenu csvHref={CSV_HREF} pdfHref={PDF_HREF} hint={HINT} />);

    await user.click(screen.getByRole("button", { name: /export/i }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /download csv/i })).toHaveAttribute(
      "href",
      CSV_HREF,
    );
    expect(within(menu).getByRole("menuitem", { name: /download pdf/i })).toHaveAttribute(
      "href",
      PDF_HREF,
    );
    expect(within(menu).getByText(HINT)).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ExportMenu csvHref={CSV_HREF} pdfHref={PDF_HREF} hint={HINT} />);

    const trigger = screen.getByRole("button", { name: /export/i });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ExportMenu csvHref={CSV_HREF} pdfHref={PDF_HREF} hint={HINT} />
        <button type="button">elsewhere</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /export/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("exposes the tour hook the guided tour targets", () => {
    render(<ExportMenu csvHref={CSV_HREF} pdfHref={PDF_HREF} dataTour="expense-export" />);
    expect(screen.getByRole("button", { name: /export/i })).toHaveAttribute(
      "data-tour",
      "expense-export",
    );
  });
});
