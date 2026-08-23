import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import {
  RID,
  claims,
  orderDoc,
  prepTaskDoc,
  testEnvironment,
  userDoc,
} from "./helpers";

/**
 * firestore.rules, exercised against the real emulator.
 *
 * The rules file names four load-bearing protections. Each gets a test that
 * fails the moment it is weakened:
 *   1. deny by default
 *   2. a plan is readable only by its owner — the restaurant never sees one
 *   3. nobody can write their own `role`
 *   4. orders and prep tasks are created only by the submitOrder function
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await testEnvironment();
});

afterEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env?.cleanup();
});

/** Writes a document past the rules, the way the Admin SDK does in production. */
async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const db = (uid: string | null, token?: Record<string, unknown>) =>
  uid === null
    ? env.unauthenticatedContext().firestore()
    : env.authenticatedContext(uid, token).firestore();

// ---------------------------------------------------------------------------

describe("1. deny by default", () => {
  it("denies an unmatched path to a guest", async () => {
    await assertFails(getDoc(doc(db(null), "somewhere/else")));
  });

  it("denies an unmatched path to a signed-in admin too", async () => {
    await assertFails(
      getDoc(doc(db("admin", claims.admin), "somewhere/else"))
    );
    await assertFails(
      setDoc(doc(db("admin", claims.admin), "somewhere/else"), { x: 1 })
    );
  });
});

describe("2. a plan is private to its owner", () => {
  const path = "users/owner/plans/p1";
  const plan = { id: "p1", ownerUid: "owner", title: "My week" };

  it("lets the owner read and write their own plan", async () => {
    await seed(path, plan);
    await assertSucceeds(getDoc(doc(db("owner", claims.client), path)));
    await assertSucceeds(
      setDoc(doc(db("owner", claims.client), path), { ...plan, title: "Edited" })
    );
  });

  it("denies another customer", async () => {
    await seed(path, plan);
    await assertFails(getDoc(doc(db("someone-else", claims.client), path)));
  });

  it("denies the restaurant — a submitted order carries its own copy", async () => {
    await seed(path, plan);
    await assertFails(
      getDoc(doc(db("staff", claims.restaurant), path))
    );
  });

  it("denies a guest", async () => {
    await seed(path, plan);
    await assertFails(getDoc(doc(db(null), path)));
  });

  it("allows an admin, who supports customers", async () => {
    await seed(path, plan);
    await assertSucceeds(getDoc(doc(db("admin", claims.admin), path)));
  });

  it("applies the same rule to saved dishes", async () => {
    await seed("users/owner/dishes/d1", { id: "d1", name: "Dish" });
    await assertSucceeds(
      getDoc(doc(db("owner", claims.client), "users/owner/dishes/d1"))
    );
    await assertFails(
      getDoc(doc(db("staff", claims.restaurant), "users/owner/dishes/d1"))
    );
  });
});

describe("3. nobody can write their own role", () => {
  it("denies a self-promotion to admin", async () => {
    await seed("users/u1", userDoc("u1"));
    await assertFails(
      updateDoc(doc(db("u1", claims.client), "users/u1"), { role: "admin" })
    );
  });

  it.each(["role", "rid", "uid", "createdAt", "roleUpdatedAt"])(
    "denies a user editing their own %s",
    async (field) => {
      await seed("users/u1", userDoc("u1"));
      await assertFails(
        updateDoc(doc(db("u1", claims.client), "users/u1"), {
          [field]: "tampered",
        })
      );
    }
  );

  it("allows a user to edit their own profile fields", async () => {
    await seed("users/u1", userDoc("u1"));
    await assertSucceeds(
      updateDoc(doc(db("u1", claims.client), "users/u1"), {
        displayName: "Mario",
        phone: "+62 812 0000 0000",
        defaultAddress: "Jl. Raya Canggu 1",
        updatedAt: "2026-08-22T00:00:00.000Z",
      })
    );
  });

  it("denies creating a profile that names someone else as its owner", async () => {
    await assertFails(
      setDoc(doc(db("u1", claims.client), "users/u1"), userDoc("someone-else"))
    );
  });

  it("denies creating a profile that carries a role", async () => {
    await assertFails(
      setDoc(doc(db("u1", claims.noRole), "users/u1"), userDoc("u1"))
    );
  });

  it("allows creating a roleless profile for yourself", async () => {
    const profile = userDoc("u1");
    delete (profile as Record<string, unknown>).role;
    await assertSucceeds(
      setDoc(doc(db("u1", claims.noRole), "users/u1"), profile)
    );
  });

  it("lets an admin change someone's role", async () => {
    await seed("users/u1", userDoc("u1"));
    await assertSucceeds(
      updateDoc(doc(db("admin", claims.admin), "users/u1"), { role: "restaurant" })
    );
  });

  it("denies a customer listing all users; allows an admin", async () => {
    await seed("users/u1", userDoc("u1"));
    await assertFails(getDocs(collection(db("u1", claims.client), "users")));
    await assertSucceeds(getDocs(collection(db("admin", claims.admin), "users")));
  });

  it("denies one customer reading another's profile", async () => {
    await seed("users/u2", userDoc("u2"));
    await assertFails(getDoc(doc(db("u1", claims.client), "users/u2")));
  });
});

describe("4. orders are created only by the Cloud Function", () => {
  const path = `restaurants/${RID}/orders/o1`;

  it("denies a client creating an order outright", async () => {
    // This is what stops a browser forging a price or dodging the cutoff.
    await assertFails(
      setDoc(doc(db("customer", claims.client), path), orderDoc())
    );
  });

  it("denies even an admin creating one from a browser", async () => {
    await assertFails(setDoc(doc(db("admin", claims.admin), path), orderDoc()));
  });

  it("lets a customer read their own order", async () => {
    await seed(path, orderDoc());
    await assertSucceeds(getDoc(doc(db("customer", claims.client), path)));
  });

  it("denies a customer reading someone else's order", async () => {
    await seed(path, orderDoc({ userId: "another" }));
    await assertFails(getDoc(doc(db("customer", claims.client), path)));
  });

  it("lets staff read any order", async () => {
    await seed(path, orderDoc());
    await assertSucceeds(getDoc(doc(db("staff", claims.restaurant), path)));
  });

  it("denies an unconstrained list, but allows one scoped to the caller", async () => {
    await seed(path, orderDoc());
    const mine = db("customer", claims.client);
    await assertFails(getDocs(collection(mine, `restaurants/${RID}/orders`)));
    await assertSucceeds(
      getDocs(
        query(
          collection(mine, `restaurants/${RID}/orders`),
          where("userId", "==", "customer")
        )
      )
    );
  });

  it("denies a list scoped to somebody else", async () => {
    await seed(path, orderDoc());
    await assertFails(
      getDocs(
        query(
          collection(db("customer", claims.client), `restaurants/${RID}/orders`),
          where("userId", "==", "another")
        )
      )
    );
  });
});

describe("4b. an order cannot be written from a browser at all", () => {
  /**
   * Cancelling used to be a direct write, cleaned up afterwards by a Firestore
   * trigger. The trigger is gone — the cascade runs inside /api/orders/status
   * now — so a direct write would cancel an order and leave its prep tasks on
   * the kitchen board forever. These make that impossible rather than merely
   * unlikely.
   */
  const path = `restaurants/${RID}/orders/o1`;

  it("denies a customer cancelling their own week directly", async () => {
    await seed(path, orderDoc({ status: "submitted" }));
    await assertFails(
      updateDoc(doc(db("customer", claims.client), path), { status: "cancelled" })
    );
  });

  it("denies staff moving an order directly", async () => {
    await seed(path, orderDoc());
    await assertFails(
      updateDoc(doc(db("staff", claims.restaurant), path), { status: "accepted" })
    );
  });

  it("denies even an admin", async () => {
    await seed(path, orderDoc());
    await assertFails(
      updateDoc(doc(db("admin", claims.admin), path), { status: "accepted" })
    );
  });

  it("denies deleting an order, which would orphan its prep tasks", async () => {
    await seed(path, orderDoc());
    await assertFails(deleteDoc(doc(db("staff", claims.restaurant), path)));
  });

  it("still lets the customer and staff READ it", async () => {
    // The receipt and the order book are browser screens; only writing moved.
    await seed(path, orderDoc());
    await assertSucceeds(getDoc(doc(db("customer", claims.client), path)));
    await assertSucceeds(getDoc(doc(db("staff", claims.restaurant), path)));
  });
});

describe("4c. prep tasks are the kitchen's, and the meal is not theirs to rewrite", () => {
  const path = `restaurants/${RID}/prepTasks/t1`;

  it("denies a customer reading the board", async () => {
    await seed(path, prepTaskDoc());
    await assertFails(getDoc(doc(db("customer", claims.client), path)));
  });

  it("denies creating a task from a browser", async () => {
    await assertFails(
      setDoc(doc(db("staff", claims.restaurant), path), prepTaskDoc())
    );
  });

  it("lets staff read and advance a task", async () => {
    await seed(path, prepTaskDoc());
    await assertSucceeds(getDoc(doc(db("staff", claims.restaurant), path)));
    await assertSucceeds(
      updateDoc(doc(db("staff", claims.restaurant), path), { status: "done" })
    );
  });

  it.each(["orderId", "userId", "items", "servings", "date", "mealName", "restaurantId"])(
    "denies staff rewriting %s on a task",
    async (field) => {
      await seed(path, prepTaskDoc());
      const tampered: Record<string, unknown> = {
        orderId: "other", userId: "other", items: [{ x: 1 }], servings: 99,
        date: "2030-01-01", mealName: "Something else", restaurantId: "elsewhere",
      };
      await assertFails(
        updateDoc(doc(db("staff", claims.restaurant), path), {
          [field]: tampered[field],
        })
      );
    }
  );

  it("lets staff delete a task", async () => {
    await seed(path, prepTaskDoc());
    await assertSucceeds(deleteDoc(doc(db("staff", claims.restaurant), path)));
  });
});

describe("5. staff access is scoped to their own restaurant", () => {
  it("denies a restaurant claim carrying a different rid", async () => {
    // The multi-tenant promise in the README depends on this holding.
    await seed(`restaurants/${RID}/prepTasks/t1`, prepTaskDoc());
    await assertFails(
      getDoc(
        doc(db("outsider", claims.otherRestaurant), `restaurants/${RID}/prepTasks/t1`)
      )
    );
  });

  it("denies an outside restaurant writing Negrita's settings", async () => {
    await assertFails(
      setDoc(doc(db("outsider", claims.otherRestaurant), `restaurants/${RID}`), {
        acceptingOrders: false,
      })
    );
  });

  it("denies a signed-in user with no role at all", async () => {
    await seed(`restaurants/${RID}/prepTasks/t1`, prepTaskDoc());
    await assertFails(
      getDoc(doc(db("nobody", claims.noRole), `restaurants/${RID}/prepTasks/t1`))
    );
  });
});

describe("6. public restaurant data", () => {
  it("lets a guest read the settings, since the cutoff is shown before sign-in", async () => {
    await seed(`restaurants/${RID}`, { id: RID, acceptingOrders: true });
    await assertSucceeds(getDoc(doc(db(null), `restaurants/${RID}`)));
  });

  it("lets a guest read house recipes, which correct everyone's macros", async () => {
    await seed(`restaurants/${RID}/houseRecipes/h1`, { id: "h1", yieldGrams: 500 });
    await assertSucceeds(
      getDoc(doc(db(null), `restaurants/${RID}/houseRecipes/h1`))
    );
  });

  it("denies a guest or a customer writing them", async () => {
    await assertFails(
      setDoc(doc(db(null), `restaurants/${RID}/houseRecipes/h1`), { id: "h1" })
    );
    await assertFails(
      setDoc(
        doc(db("customer", claims.client), `restaurants/${RID}/houseRecipes/h1`),
        { id: "h1" }
      )
    );
  });

  it("lets staff write them", async () => {
    await assertSucceeds(
      setDoc(
        doc(db("staff", claims.restaurant), `restaurants/${RID}/houseRecipes/h1`),
        { id: "h1", yieldGrams: 500 }
      )
    );
  });
});
