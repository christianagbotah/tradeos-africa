export interface ConsumptionComponent {
  componentProductId: string;
  stockUnitId: string;
  quantityPerOutput: number;
  /** Expected loss/overage as a percentage, e.g. 5 means 5%. */
  expectedWastePercent?: number;
}

export interface ConsumptionDefinition {
  id: string;
  outputId: string;
  outputKind: "PRODUCT" | "SERVICE";
  outputUnitId: string;
  components: ConsumptionComponent[];
}

export interface PlannedConsumption {
  componentProductId: string;
  stockUnitId: string;
  expectedQuantity: number;
  expectedWasteQuantity: number;
  totalPlannedQuantity: number;
}

export class ConsumptionError extends Error {}

/**
 * Used by both recipes and services.
 * Examples:
 * - one medium waakye consumes rice/beans/gari/packaging
 * - one haircut consumes a blade/disinfectant/powder
 * - one SUV wash consumes shampoo/tyre shine
 */
export function planConsumption(
  definition: ConsumptionDefinition,
  outputQuantity: number,
): PlannedConsumption[] {
  if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
    throw new ConsumptionError("Output quantity must be a positive finite number");
  }

  return definition.components.map((component) => {
    if (!Number.isFinite(component.quantityPerOutput) || component.quantityPerOutput < 0) {
      throw new ConsumptionError(`Invalid component quantity for ${component.componentProductId}`);
    }
    const wastePercent = component.expectedWastePercent ?? 0;
    if (!Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent >= 100) {
      throw new ConsumptionError(`Invalid waste percentage for ${component.componentProductId}`);
    }

    const expectedQuantity = component.quantityPerOutput * outputQuantity;
    const expectedWasteQuantity = expectedQuantity * (wastePercent / 100);

    return {
      componentProductId: component.componentProductId,
      stockUnitId: component.stockUnitId,
      expectedQuantity,
      expectedWasteQuantity,
      totalPlannedQuantity: expectedQuantity + expectedWasteQuantity,
    };
  });
}
