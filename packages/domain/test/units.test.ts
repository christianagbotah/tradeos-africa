import { describe, expect, it } from "vitest";
import { UnitConverter, UnitConversionError } from "../src/units.js";

describe("UnitConverter", () => {
  it("chains bulk-to-unit conversions", () => {
    const converter = new UnitConverter([
      { from: "crate", to: "bottle", factor: 24 },
      { from: "bottle", to: "glass", factor: 15 },
    ]);

    expect(converter.convert(1, "crate", "glass")).toBe(360);
    expect(converter.convert(30, "glass", "bottle")).toBeCloseTo(2);
  });

  it("supports SKU-specific weight-to-piece conversion", () => {
    const converter = new UnitConverter([
      { from: "tonne", to: "piece", factor: 83.3333333333 },
    ]);

    expect(converter.convert(0.5, "tonne", "piece")).toBeCloseTo(41.66666666665);
  });

  it("rejects missing conversion paths", () => {
    const converter = new UnitConverter([{ from: "coil", to: "yard", factor: 100 }]);
    expect(() => converter.convert(1, "coil", "kg")).toThrow(UnitConversionError);
  });
});
