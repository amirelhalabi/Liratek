/**
 * LIRA-296 P3 (T047, FR-015) — what a unit's serial is called: the
 * category's own `serial_label`; for an old payload or a hand-built schema
 * without it, "IMEI" when the category tracks units (the phone categories
 * that were the only tracked ones before P3), else "Serial".
 */
import { serialLabelFor } from "../serialLabel";

it("uses the category's own label", () => {
  expect(serialLabelFor({ serial_label: "Serial", tracks_imei_units: 1 })).toBe(
    "Serial",
  );
  expect(serialLabelFor({ serial_label: "IMEI", tracks_imei_units: 0 })).toBe(
    "IMEI",
  );
});

it("falls back on the tracking flag when the label is missing or unknown", () => {
  expect(serialLabelFor({ tracks_imei_units: 1 })).toBe("IMEI");
  expect(serialLabelFor({ tracks_imei_units: true })).toBe("IMEI");
  expect(serialLabelFor({ tracks_imei_units: 0 })).toBe("Serial");
  expect(serialLabelFor({ serial_label: "Barcode", tracks_imei_units: 1 })).toBe(
    "IMEI",
  );
  expect(serialLabelFor(null)).toBe("Serial");
  expect(serialLabelFor(undefined)).toBe("Serial");
});
