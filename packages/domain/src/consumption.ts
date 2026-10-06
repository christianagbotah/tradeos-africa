export interface ConsumptionComponent {
  componentProductId: string;
  stockUnitId: string;
  /** Quantity consumed for `definition.outputQuantity` outputs. */
  quantityPerOutput: number;
  /** Expected loss/overage as a percentage, e.g. 5 means 5%. */
  expectedWastePercent?: number;
}

export interface ConsumptionDefinition {
  id: string;
  outputId: string;
  outputKind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  outputUnitId: string;
  /** Number of output units the component quantities describe. Defaults to 1. */
  outputQuantity?: number;
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
 * Used by recipes and services.
 * Examples:
 * - 100 medium waakye portions consume a batch of rice/beans/gari/packaging
 * - one haircut consumes a blade/disinfectant/powder
 * - one SUV wash consumes shampoo/tyre shine
 *
 * Definitions may describe either one output or a batch yield. The requested sale
 * quantity is scaled against `outputQuantity`, so a 100-portion recipe remains exact
 * when only 7 portions are sold.
 */
export function planConsumption(
  definition: ConsumptionDefinition,
  outputQuantity: number,
): PlannedConsumption[] {
  if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
    throw new ConsumptionError("Output quantity must be a positive finite number");
  }

  const definedOutputQuantity = definition.outputQuantity ?? 1;
  if (!Number.isFinite(definedOutputQuantity) || definedOutputQuantity <= 0) {
    throw new ConsumptionError("Definition output quantity must be a positive finite number");
  }

  const scale = outputQuantity / definedOutputQuantity;

  return definition.components.map((component) => {
    if (!Number.isFinite(component.quantityPerOutput) || component.quantityPerOutput < 0) {
      throw new ConsumptionError(`Invalid component quantity for ${component.componentProductId}`);
    }
    const wastePercent = component.expectedWastePercent ?? 0;
    if (!Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent >= 100) {
      throw new ConsumptionError(`Invalid waste percentage for ${component.componentProductId}`);
    }

    const expectedQuantity = component.quantityPerOutput * scale;
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
