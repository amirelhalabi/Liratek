/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DrawerConfig from "../DrawerConfig";

describe("DrawerConfig", () => {
  beforeEach(() => {
    (window as any).api = {
      settings: {
        getAll: jest.fn().mockResolvedValue([
          { key_name: "drawer_limit_general", value: "1000" },
          { key_name: "drawer_limit_omt", value: "500" },
          { key_name: "closing_variance_threshold_pct", value: "7.5" },
        ]),
        update: jest.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("loads existing values and saves updated threshold", async () => {
    render(<DrawerConfig />);

    // loaded values
    await waitFor(() => {
      expect(screen.getByLabelText(/General Drawer Limit/i)).toHaveValue(1000);
    });

    expect(screen.getByLabelText(/OMT Drawer Limit/i)).toHaveValue(500);
    expect(screen.getByLabelText(/Closing Variance Threshold/i)).toHaveValue(7.5);

    fireEvent.change(screen.getByLabelText(/Closing Variance Threshold/i), {
      target: { value: "10" },
    });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect((window as any).api.settings.update).toHaveBeenCalledWith(
        "closing_variance_threshold_pct",
        "10",
      );
    });
  });
});
