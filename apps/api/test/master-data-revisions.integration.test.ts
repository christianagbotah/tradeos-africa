import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

afterAll(async () => {
  await pool.end();
});

describe("master-data revision foundation", () => {
  it("exposes revision timestamps for expense categories and money-account defaults", async () => {
    const columns = async (tableName: string) => {
      const result = await pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [tableName],
      );
      return result.rows.map((row) => row.column_name);
    };

    expect(await columns("expense_categories")).toEqual(
      expect.arrayContaining(["created_at", "updated_at"]),
    );
    expect(await columns("money_account_defaults")).toContain("updated_at");
  });

  it("pins shared revision-safe master-data mutation contracts", async () => {
    const source = await readFile(
      new URL("../../../packages/contracts/src/master-data.ts", import.meta.url),
      "utf8",
    );

    for (const contract of [
      "CustomerCreateInput",
      "CustomerUpdateInput",
      "SupplierCreateInput",
      "SupplierUpdateInput",
      "ExpenseCategoryUpdateInput",
      "MoneyAccountUpdateInput",
      "MoneyAccountDefaultUpdateInput",
    ]) {
      expect(source).toContain(`type ${contract}`);
    }

    expect(source).toContain("expectedUpdatedAt");
    for (const mutationType of [
      "CUSTOMER_CREATE",
      "CUSTOMER_UPDATE",
      "SUPPLIER_CREATE",
      "SUPPLIER_UPDATE",
    ]) {
      expect(source).toContain(`\"${mutationType}\"`);
    }
  });
});
