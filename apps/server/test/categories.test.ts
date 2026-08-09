import { describe, expect, it, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetTestDb, db, schema } from "./helpers/db";
import { listCategories, createCategory, findCategoryByPath } from "../src/services/categories";

beforeEach(() => {
  resetTestDb();
});

describe("createCategory", () => {
  it("creates a root category", () => {
    const cat = createCategory({ name: "Food" });
    expect(cat.id).toBeGreaterThan(0);
    expect(cat.name).toBe("Food");
  });

  it("creates a child category", () => {
    const parent = createCategory({ name: "Food" });
    const child = createCategory({ name: "Groceries", parentId: parent.id });
    expect(child.id).not.toBe(parent.id);
  });

  it("records the fixed flag", () => {
    createCategory({ name: "Rent", isFixed: true });
    const tree = listCategories();
    expect(tree.find((c) => c.name === "Rent")?.isFixed).toBe(true);
  });

  it("defaults the fixed flag to false", () => {
    createCategory({ name: "Coffee" });
    const tree = listCategories();
    expect(tree.find((c) => c.name === "Coffee")?.isFixed).toBe(false);
  });
});

describe("listCategories", () => {
  it("returns an empty array when there are none", () => {
    expect(listCategories()).toEqual([]);
  });

  it("nests children under their parent", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Groceries", parentId: food.id });
    createCategory({ name: "Restaurants", parentId: food.id });

    const tree = listCategories();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Food");
    expect(tree[0]!.children.map((c) => c.name).sort()).toEqual(["Groceries", "Restaurants"]);
  });

  it("nests to four levels, since depth is unlimited", () => {
    const l1 = createCategory({ name: "Home" });
    const l2 = createCategory({ name: "Household", parentId: l1.id });
    const l3 = createCategory({ name: "Cleaning", parentId: l2.id });
    createCategory({ name: "Detergent", parentId: l3.id });

    const tree = listCategories();
    expect(tree[0]!.children[0]!.children[0]!.children[0]!.name).toBe("Detergent");
  });

  it("excludes archived categories", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Obsolete", parentId: food.id });
    db.update(schema.categories)
      .set({ archivedAt: 1786230000 })
      .where(eq(schema.categories.name, "Obsolete"))
      .run();

    const tree = listCategories();
    expect(tree[0]!.children).toHaveLength(0);
  });
});

describe("findCategoryByPath", () => {
  it("resolves a root category by name", () => {
    const food = createCategory({ name: "Food" });
    expect(findCategoryByPath("Food")).toBe(food.id);
  });

  it("resolves a nested path", () => {
    const food = createCategory({ name: "Food" });
    const groceries = createCategory({ name: "Groceries", parentId: food.id });
    expect(findCategoryByPath("Food/Groceries")).toBe(groceries.id);
  });

  it("is case-insensitive", () => {
    const food = createCategory({ name: "Food" });
    expect(findCategoryByPath("food")).toBe(food.id);
  });

  it("returns null for an unknown path", () => {
    expect(findCategoryByPath("Nonexistent")).toBeNull();
  });

  it("returns null when an intermediate segment is missing", () => {
    createCategory({ name: "Food" });
    expect(findCategoryByPath("Food/Missing/Deeper")).toBeNull();
  });

  it("does not match a child as if it were a root", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Groceries", parentId: food.id });
    expect(findCategoryByPath("Groceries")).toBeNull();
  });
});
