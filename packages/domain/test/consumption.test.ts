import { describe, expect, it } from "vitest";
import { planConsumption } from "../src/index.js";

describe("planConsumption", () => {
  it("plans ingredients for food portions", () => {
    const plan = planConsumption(
      {
        id: "waakye-medium",
        outputId: "menu-waakye-medium",
        outputKind: "PRODUCT",
        outputUnitId: "plate",
        components: [
          { componentProductId: "rice", stockUnitId: "kg", quantityPerOutput: 0.25, expectedWastePercent: 4 },
          { componentProductId: "beans", stockUnitId: "kg", quantityPerOutput: 0.08 },
          { componentProductId: "pack", stockUnitId: "piece", quantityPerOutput: 1 },
        ],
      },
      100,
    );

    expect(plan[0]?.expectedQuantity).toBe(25);
    expect(plan[0]?.expectedWasteQuantity).toBe(1);
    expect(plan[0]?.totalPlannedQuantity).toBe(26);
    expect(plan[2]?.totalPlannedQuantity).toBe(100);
  });

  it("plans consumables for services", () => {
    const plan = planConsumption(
      {
        id: "haircut-standard",
        outputId: "haircut-standard",
        outputKind: "SERVICE",
        outputUnitId: "job",
        components: [
          { componentProductId: "blade", stockUnitId: "piece", quantityPerOutput: 1 },
          { componentProductId: "disinfectant", stockUnitId: "ml", quantityPerOutput: 8 },
        ],
      },
      12,
    );

    expect(plan).toEqual([
      {
        componentProductId: "blade",
        stockUnitId: "piece",
        expectedQuantity: 12,
        expectedWasteQuantity: 0,
        totalPlannedQuantity: 12,
      },
      {
        componentProductId: "disinfectant",
        stockUnitId: "ml",
        expectedQuantity: 96,
        expectedWasteQuantity: 0,
        totalPlannedQuantity: 96,
      },
    ]);
  });
});
