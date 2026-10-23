import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Modal } from "@/components/ui/Modal";

function ControlledModal() {
  const [value, setValue] = useState("");

  return (
    <Modal open onClose={() => {}} title="Edit record" description="Regression harness">
      <label htmlFor="focused-field">Name</label>
      <input id="focused-field" value={value} onChange={(event) => setValue(event.target.value)} />
    </Modal>
  );
}

describe("Modal", () => {
  it("keeps focus in a controlled input while the parent re-renders", async () => {
    const user = userEvent.setup();
    render(<ControlledModal />);

    const input = screen.getByLabelText("Name");
    await user.click(input);
    await user.keyboard("abc");

    expect(input).toHaveFocus();
    expect(input).toHaveValue("abc");
  });
});
