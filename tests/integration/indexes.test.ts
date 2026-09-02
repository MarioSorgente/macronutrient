import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Composite index coverage.
 *
 * A multi-field query with no matching index works fine in the emulator and
 * then fails in production with FAILED_PRECONDITION — the one failure mode
 * that the rest of this suite cannot catch. So each composite query the app
 * issues is declared here alongside where it lives, and checked against
 * firestore.indexes.json.
 *
 * Firestore creates single-field indexes automatically, so only multi-field
 * queries belong in this list.
 */

interface IndexField {
  fieldPath: string;
  order?: string;
  arrayConfig?: string;
}
interface CompositeIndex {
  collectionGroup: string;
  queryScope: string;
  fields: IndexField[];
}

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../firestore.indexes.json", import.meta.url)),
    "utf8"
  )
) as { indexes: CompositeIndex[] };

/**
 * Every composite query the app runs, as (collection, equality filters,
 * ordering) — which is exactly what Firestore needs an index for.
 *
 * This list is the load-bearing half of the check below, and it had gone stale:
 * it still declared a duplicate-submit query citing `functions/src/submitOrder.ts`,
 * a file that no longer exists in a directory that is no longer deployed, plus
 * two status-filtered queries that are now filtered in memory. Three indexes
 * were being kept alive by their own guard rail. Anything added here has to be
 * a `where()` you can point at in `src/`.
 */
const QUERIES = [
  {
    where: "src/lib/storage/orders.ts listOrdersByUser — one person's orders (customer's own, and the admin customer page)",
    collectionGroup: "orders",
    equality: ["userId"],
    orderBy: [{ fieldPath: "submittedAt", order: "DESCENDING" }],
  },
  {
    where: "src/lib/storage/orders.ts listPrepTasks / watchPrepTasks — one day's board",
    collectionGroup: "prepTasks",
    equality: ["date"],
    orderBy: [{ fieldPath: "readyBy", order: "ASCENDING" }],
  },
] as const;

/**
 * A composite index serves a query when its leading fields are exactly the
 * equality filters (in any order — Firestore does not care) followed by the
 * ordering fields in sequence.
 */
function servesQuery(index: CompositeIndex, q: (typeof QUERIES)[number]): boolean {
  const expectedLength = q.equality.length + q.orderBy.length;
  if (index.fields.length !== expectedLength) return false;

  const equalityPart = index.fields.slice(0, q.equality.length);
  const sameEqualityFields =
    [...equalityPart.map((f) => f.fieldPath)].sort().join() ===
    [...q.equality].sort().join();
  if (!sameEqualityFields) return false;

  return q.orderBy.every((want, i) => {
    const got = index.fields[q.equality.length + i];
    return got?.fieldPath === want.fieldPath && got?.order === want.order;
  });
}

describe("composite index coverage", () => {
  it.each(QUERIES)("has an index for $collectionGroup — $where", (q) => {
    const candidates = config.indexes.filter(
      (i) => i.collectionGroup === q.collectionGroup
    );
    const match = candidates.find((i) => servesQuery(i, q));
    expect(
      match,
      `No composite index serves this query.\n` +
        `  collection: ${q.collectionGroup}\n` +
        `  equality:   ${q.equality.join(", ") || "(none)"}\n` +
        `  order by:   ${q.orderBy.map((o) => `${o.fieldPath} ${o.order}`).join(", ") || "(none)"}\n` +
        `Add it to firestore.indexes.json and deploy with:\n` +
        `  firebase deploy --only firestore:indexes`
    ).toBeDefined();
  });
});

describe("the index file itself", () => {
  it("exactly declares the listOrdersByUser query index", () => {
    const index = config.indexes.find(
      (candidate) => candidate.collectionGroup === "orders" &&
        candidate.fields.some((field) => field.fieldPath === "userId") &&
        candidate.fields.some((field) => field.fieldPath === "submittedAt")
    );
    expect(index?.queryScope).toBe("COLLECTION");
    expect(index?.fields).toEqual([
      { fieldPath: "userId", order: "ASCENDING" },
      { fieldPath: "submittedAt", order: "DESCENDING" },
    ]);
  });

  it("declares COLLECTION scope for every index", () => {
    // A COLLECTION_GROUP index is a different (and more expensive) thing; none
    // of these queries is a collection-group query.
    expect(config.indexes.every((i) => i.queryScope === "COLLECTION")).toBe(true);
  });

  it("has no duplicate index definitions", () => {
    const shapes = config.indexes.map(
      (i) =>
        `${i.collectionGroup}:${i.fields.map((f) => `${f.fieldPath}/${f.order ?? f.arrayConfig}`).join(",")}`
    );
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("carries no index that no declared query uses", () => {
    // An unused index is a write-amplification cost on every document.
    const unused = config.indexes.filter(
      (i) => !QUERIES.some((q) => servesQuery(i, q))
    );
    expect(
      unused.map(
        (i) => `${i.collectionGroup}: ${i.fields.map((f) => f.fieldPath).join(", ")}`
      )
    ).toEqual([]);
  });
});
