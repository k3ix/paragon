import { describe, expect, it, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetTestDb, db, schema } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { getCategoryTreeBreakdown } from "../src/services/summary";

beforeEach(() => {
  resetTestDb();
});

function expense(month: string, total: string, category?: string) {
  addTransactions([
    {
      date: `${month}-15`,
      total,
      merchant: `Shop ${month} ${total} ${category ?? "none"}`,
      ...(category ? { lineItems: [{ amount: total, category }] } : {}),
    },
  ]);
}

describe("category tree breakdown", () => {
  it("rolls children up into their parent", () => {
    const food = createCategory({ name: "Еда" });
    createCategory({ name: "Продукты", parentId: food.id });
    createCategory({ name: "Алкоголь", parentId: food.id });
    expense("2026-08", "400.00", "Еда/Продукты");
    expense("2026-08", "100.00", "Еда/Алкоголь");

    const tree = getCategoryTreeBreakdown("2026-08");
    const foodNode = tree.find((n) => n.name === "Еда")!;

    expect(foodNode.totalMinor).toBe(50000);
    expect(foodNode.children).toHaveLength(2);
    expect(foodNode.children.find((c) => c.name === "Алкоголь")!.totalMinor).toBe(10000);
  });

  it("keeps spending filed directly against a parent", () => {
    const food = createCategory({ name: "Еда" });
    createCategory({ name: "Продукты", parentId: food.id });
    expense("2026-08", "300.00", "Еда");
    expense("2026-08", "200.00", "Еда/Продукты");

    expect(getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!.totalMinor).toBe(
      50000,
    );
  });

  it("compares against the previous month", () => {
    createCategory({ name: "Еда" });
    expense("2026-07", "300.00", "Еда");
    expense("2026-08", "500.00", "Еда");

    const foodNode = getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!;

    expect(foodNode.previousMinor).toBe(30000);
    expect(foodNode.deltaMinor).toBe(20000);
  });

  it("rolls a child's previous month up to its parent too", () => {
    const food = createCategory({ name: "Еда" });
    createCategory({ name: "Продукты", parentId: food.id });
    expense("2026-07", "300.00", "Еда/Продукты");
    expense("2026-08", "500.00", "Еда/Продукты");

    expect(getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!.previousMinor).toBe(
      30000,
    );
  });

  it("shows uncategorized spending as its own node", () => {
    expense("2026-08", "123.45");

    const node = getCategoryTreeBreakdown("2026-08").find((n) => n.categoryId === null)!;

    expect(node.totalMinor).toBe(12345);
    // An empty path, so the purchase filter selects "no category" rather than a branch.
    expect(node.path).toBe("");
  });

  it("names a child's whole branch in its path", () => {
    const food = createCategory({ name: "Еда" });
    createCategory({ name: "Продукты", parentId: food.id });
    expense("2026-08", "100.00", "Еда/Продукты");

    const foodNode = getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!;

    expect(foodNode.path).toBe("Еда");
    expect(foodNode.children[0]!.path).toBe("Еда/Продукты");
  });

  it("sorts by spending, biggest first", () => {
    createCategory({ name: "Еда" });
    createCategory({ name: "Транспорт" });
    expense("2026-08", "100.00", "Транспорт");
    expense("2026-08", "900.00", "Еда");

    expect(getCategoryTreeBreakdown("2026-08")[0]!.name).toBe("Еда");
  });

  it("omits a category with no spending in either month", () => {
    createCategory({ name: "Еда" });
    createCategory({ name: "Подарки" });
    expense("2026-08", "100.00", "Еда");

    expect(getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Подарки")).toBeUndefined();
  });

  it("expresses shares as percentages of the month total", () => {
    createCategory({ name: "Еда" });
    createCategory({ name: "Транспорт" });
    expense("2026-08", "750.00", "Еда");
    expense("2026-08", "250.00", "Транспорт");

    expect(getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!.share).toBe(75);
  });

  it("returns nothing for a month with no spending", () => {
    createCategory({ name: "Еда" });

    expect(getCategoryTreeBreakdown("2026-08")).toEqual([]);
  });

  it("does not hang on a cycle in the category tree", () => {
    // A cycle cannot be created through the service, which rejects it — but data
    // edited outside the app could carry one, and an unguarded walk would never stop.
    const a = createCategory({ name: "A" });
    const b = createCategory({ name: "B", parentId: a.id });
    db.update(schema.categories)
      .set({ parentId: b.id })
      .where(eq(schema.categories.id, a.id))
      .run();
    expense("2026-08", "100.00");

    expect(() => getCategoryTreeBreakdown("2026-08")).not.toThrow();
  });
});
