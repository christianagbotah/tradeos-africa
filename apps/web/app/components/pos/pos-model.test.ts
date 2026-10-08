import { describe, expect, it } from "vitest";

async function loadModel() {
  const modulePath = "./pos-model";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

const bottle = {
  itemId: "malt",
  name: "Malt",
  saleUnitCode: "bottle",
  saleUnitLabel: "Bottle",
  priceMinor: 1200,
};
const crate = {
  itemId: "malt",
  name: "Malt",
  saleUnitCode: "crate",
  saleUnitLabel: "Crate",
  priceMinor: 28800,
};
const haircut = {
  itemId: "haircut",
  name: "Haircut",
  saleUnitCode: "service",
  saleUnitLabel: "Service",
  priceMinor: 3500,
};

describe("POS cart model", () => {
  it("increments the same item and sale unit but keeps different units as distinct lines", async () => {
    const model = await loadModel();
    expect(model?.addCartItem).toBeTypeOf("function");
    if (!model?.addCartItem) return;

    let cart = model.addCartItem([], bottle);
    cart = model.addCartItem(cart, bottle);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ itemId: "malt", saleUnitCode: "bottle", quantity: 2 });

    cart = model.addCartItem(cart, crate);
    expect(cart).toHaveLength(2);
    expect(cart.map((line: { key: string }) => line.key)).toEqual(["malt:bottle", "malt:crate"]);
  });

  it("supports direct and fractional quantity changes but rejects zero and negative values", async () => {
    const model = await loadModel();
    expect(model?.setCartQuantity).toBeTypeOf("function");
    if (!model?.addCartItem || !model?.setCartQuantity) return;

    const cart = model.addCartItem([], bottle);
    expect(model.setCartQuantity(cart, "malt:bottle", 3)[0]?.quantity).toBe(3);
    expect(model.setCartQuantity(cart, "malt:bottle", 0.5)[0]?.quantity).toBe(0.5);
    expect(() => model.setCartQuantity(cart, "malt:bottle", 0)).toThrow(/greater than zero|positive/i);
    expect(() => model.setCartQuantity(cart, "malt:bottle", -2)).toThrow(/greater than zero|positive/i);
    expect(() => model.setCartQuantity(cart, "malt:bottle", Number.NaN)).toThrow(/valid|finite|number/i);
  });

  it("removes only the selected cart line", async () => {
    const model = await loadModel();
    expect(model?.removeCartLine).toBeTypeOf("function");
    if (!model?.addCartItem || !model?.removeCartLine) return;

    let cart = model.addCartItem([], bottle);
    cart = model.addCartItem(cart, haircut);
    const next = model.removeCartLine(cart, "malt:bottle");
    expect(next).toHaveLength(1);
    expect(next[0]?.key).toBe("haircut:service");
  });

  it("changes a line unit and merges quantity when the target item/unit line already exists", async () => {
    const model = await loadModel();
    expect(model?.changeCartUnit).toBeTypeOf("function");
    if (!model?.addCartItem || !model?.setCartQuantity || !model?.changeCartUnit) return;

    let cart = model.addCartItem([], bottle);
    cart = model.setCartQuantity(cart, "malt:bottle", 2);
    cart = model.addCartItem(cart, crate);
    const merged = model.changeCartUnit(cart, "malt:bottle", crate);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ key: "malt:crate", saleUnitCode: "crate", quantity: 3, priceMinor: 28800 });
  });

  it("changes a line unit without changing quantity when no target line exists", async () => {
    const model = await loadModel();
    expect(model?.changeCartUnit).toBeTypeOf("function");
    if (!model?.addCartItem || !model?.setCartQuantity || !model?.changeCartUnit) return;

    let cart = model.addCartItem([], bottle);
    cart = model.setCartQuantity(cart, "malt:bottle", 2.5);
    const changed = model.changeCartUnit(cart, "malt:bottle", crate);

    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ key: "malt:crate", quantity: 2.5, priceMinor: 28800 });
  });
});

describe("POS customer/payment normalization", () => {
  it("defaults Walk-in state away from customer credit while preserving immediate payment methods", async () => {
    const model = await loadModel();
    expect(model?.normalizeCustomerPayment).toBeTypeOf("function");
    if (!model?.normalizeCustomerPayment) return;

    expect(model.normalizeCustomerPayment(null, "CASH")).toBe("CASH");
    expect(model.normalizeCustomerPayment(null, "MOMO")).toBe("MOMO");
    expect(model.normalizeCustomerPayment(null, "CUSTOMER_CREDIT")).toBe("CASH");
  });

  it("allows active named customers to remain selected for immediate methods and valid credit", async () => {
    const model = await loadModel();
    expect(model?.normalizeCustomerPayment).toBeTypeOf("function");
    if (!model?.normalizeCustomerPayment) return;

    const customer = { id: "c1", name: "Ama Mensah", active: true, creditEnabled: true };
    expect(model.normalizeCustomerPayment(customer, "CARD")).toBe("CARD");
    expect(model.normalizeCustomerPayment(customer, "CUSTOMER_CREDIT")).toBe("CUSTOMER_CREDIT");
  });

  it("treats inactive customer state like Walk-in for new credit selection", async () => {
    const model = await loadModel();
    expect(model?.normalizeCustomerPayment).toBeTypeOf("function");
    if (!model?.normalizeCustomerPayment) return;

    const customer = { id: "c2", name: "Inactive", active: false, creditEnabled: true };
    expect(model.normalizeCustomerPayment(customer, "CUSTOMER_CREDIT")).toBe("CASH");
  });
});
