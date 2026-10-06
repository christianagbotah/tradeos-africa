export interface ConsumptionComponent {
  componentProductId: string;
  stockUnitId: string;
  /** Quantity consumed for the definition's declared output quantity. */
  quantityPerOutput: number;
  expectedWastePercent?: number;
}

export interface ConsumptionDefinition {
  id: string;
  outputId: string;
  outputKind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  outputUnitId: string;
  /** Batch yield represented by component quantities. Defaults to one output. */
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

export function planConsumption(definition: ConsumptionDefinition, outputQuantity: number): PlannedConsumption[] {
  assertPositive(outputQuantity, "Output quantity");
  const definedOutputQuantity = definition.outputQuantity ?? 1;
  assertPositive(definedOutputQuantity, "Definition output quantity");
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

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConsumptionError(`${label} must be a positive finite number`);
  }
}
