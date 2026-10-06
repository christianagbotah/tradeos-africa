export type UnitId = string;

export interface UnitRule {
  from: UnitId;
  to: UnitId;
  /** Multiply a quantity in `from` by this factor to get quantity in `to`. */
  factor: number;
}

export class UnitConversionError extends Error {}

/**
 * Product-specific unit conversion graph.
 *
 * Examples:
 * - 1 crate -> 24 bottles
 * - 1 bottle -> 15 glasses
 * - 1 coil -> 50 yards
 * - 1 tonne -> 83.333 pieces for a given iron-rod SKU
 *
 * Rules are deliberately product-specific because conversions such as tonne ->
 * piece depend on the exact SKU, diameter, length and material density.
 */
export class UnitConverter {
  private readonly graph = new Map<UnitId, Map<UnitId, number>>();

  constructor(rules: UnitRule[]) {
    for (const rule of rules) this.addRule(rule);
  }

  addRule(rule: UnitRule): void {
    if (!rule.from || !rule.to) {
      throw new UnitConversionError("Unit ids are required");
    }
    if (!Number.isFinite(rule.factor) || rule.factor <= 0) {
      throw new UnitConversionError("Conversion factor must be a positive finite number");
    }

    this.setEdge(rule.from, rule.to, rule.factor);
    this.setEdge(rule.to, rule.from, 1 / rule.factor);
  }

  convert(quantity: number, from: UnitId, to: UnitId): number {
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new UnitConversionError("Quantity must be a non-negative finite number");
    }
    if (from === to) return quantity;

    const factor = this.findFactor(from, to);
    if (factor === null) {
      throw new UnitConversionError(`No conversion path from ${from} to ${to}`);
    }
    return quantity * factor;
  }

  private setEdge(from: UnitId, to: UnitId, factor: number): void {
    const edges = this.graph.get(from) ?? new Map<UnitId, number>();
    edges.set(to, factor);
    this.graph.set(from, edges);
  }

  private findFactor(from: UnitId, to: UnitId): number | null {
    const queue: Array<{ unit: UnitId; factor: number }> = [{ unit: from, factor: 1 }];
    const visited = new Set<UnitId>([from]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      const edges = this.graph.get(current.unit);
      if (!edges) continue;

      for (const [next, edgeFactor] of edges.entries()) {
        if (visited.has(next)) continue;
        const factor = current.factor * edgeFactor;
        if (next === to) return factor;
        visited.add(next);
        queue.push({ unit: next, factor });
      }
    }

    return null;
  }
}
