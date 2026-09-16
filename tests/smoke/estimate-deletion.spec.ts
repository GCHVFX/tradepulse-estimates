import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import {
  deleteOwnedEstimate,
  ESTIMATE_NOT_FOUND_OR_DENIED,
  type EstimateDeletionDependencies,
} from "../../lib/estimate-deletion";

/**
 * B3: `DELETE /api/estimates?id=` must prove ownership before it deletes
 * anything (HANDOFF.md, Phase 1 slice 5B security foundation).
 *
 * The route used to remove an estimate's Storage photos, photo rows, change log
 * and payment reminders by the supplied id alone, then check ownership only on
 * the parent delete, so any signed-in user holding another business's estimate
 * id could wipe that estimate's children and still get `success: true`.
 *
 * No database: an in-memory world with two businesses, and dependencies that
 * record every call in order.
 */

const root = path.join(__dirname, "../..");

const OWNER_BUSINESS = "business-owner";
const FOREIGN_BUSINESS = "business-foreign";
const OWN_ESTIMATE = "estimate-own";
const FOREIGN_ESTIMATE = "estimate-foreign";

function makeWorld() {
  const world = {
    estimates: new Map<string, { businessId: string }>([
      [OWN_ESTIMATE, { businessId: OWNER_BUSINESS }],
      [FOREIGN_ESTIMATE, { businessId: FOREIGN_BUSINESS }],
    ]),
    photoRows: [
      { estimateId: OWN_ESTIMATE, storagePath: `owner-uid/${OWN_ESTIMATE}/a.jpg` },
      { estimateId: FOREIGN_ESTIMATE, storagePath: `foreign-uid/${FOREIGN_ESTIMATE}/b.jpg` },
    ],
    storageObjects: new Set<string>([`owner-uid/${OWN_ESTIMATE}/a.jpg`, `foreign-uid/${FOREIGN_ESTIMATE}/b.jpg`]),
    changes: [{ estimateId: OWN_ESTIMATE }, { estimateId: FOREIGN_ESTIMATE }],
    reminders: [{ estimateId: OWN_ESTIMATE }, { estimateId: FOREIGN_ESTIMATE }],
    calls: [] as string[],
  };

  const deps: EstimateDeletionDependencies = {
    async findOwnedEstimate(estimateId, businessId) {
      world.calls.push(`findOwnedEstimate:${estimateId}:${businessId}`);
      const estimate = world.estimates.get(estimateId);
      return estimate && estimate.businessId === businessId ? { id: estimateId } : null;
    },
    async listPhotoStoragePaths(estimateId) {
      world.calls.push(`listPhotoStoragePaths:${estimateId}`);
      return world.photoRows.filter((row) => row.estimateId === estimateId).map((row) => row.storagePath);
    },
    async removePhotoObjects(storagePaths) {
      world.calls.push(`removePhotoObjects:${storagePaths.join(",")}`);
      for (const storagePath of storagePaths) world.storageObjects.delete(storagePath);
    },
    async deletePhotoRows(estimateId) {
      world.calls.push(`deletePhotoRows:${estimateId}`);
      world.photoRows = world.photoRows.filter((row) => row.estimateId !== estimateId);
    },
    async deleteEstimateChanges(estimateId) {
      world.calls.push(`deleteEstimateChanges:${estimateId}`);
      world.changes = world.changes.filter((row) => row.estimateId !== estimateId);
    },
    async deletePaymentReminders(estimateId) {
      world.calls.push(`deletePaymentReminders:${estimateId}`);
      world.reminders = world.reminders.filter((row) => row.estimateId !== estimateId);
    },
    async deleteEstimate(estimateId, businessId) {
      world.calls.push(`deleteEstimate:${estimateId}:${businessId}`);
      const estimate = world.estimates.get(estimateId);
      if (estimate && estimate.businessId === businessId) world.estimates.delete(estimateId);
      return null;
    },
  };

  return { world, deps };
}

test("the owner can still delete their own estimate and all of its children", async () => {
  const { world, deps } = makeWorld();

  const result = await deleteOwnedEstimate(OWN_ESTIMATE, OWNER_BUSINESS, deps);

  expect(result).toEqual({ ok: true });
  expect(world.estimates.has(OWN_ESTIMATE)).toBe(false);
  expect(world.photoRows.some((row) => row.estimateId === OWN_ESTIMATE)).toBe(false);
  expect(world.storageObjects.has(`owner-uid/${OWN_ESTIMATE}/a.jpg`)).toBe(false);
  expect(world.changes.some((row) => row.estimateId === OWN_ESTIMATE)).toBe(false);
  expect(world.reminders.some((row) => row.estimateId === OWN_ESTIMATE)).toBe(false);

  // Children go before the parent, which the NO ACTION foreign keys require.
  expect(world.calls).toEqual([
    `findOwnedEstimate:${OWN_ESTIMATE}:${OWNER_BUSINESS}`,
    `listPhotoStoragePaths:${OWN_ESTIMATE}`,
    `removePhotoObjects:owner-uid/${OWN_ESTIMATE}/a.jpg`,
    `deletePhotoRows:${OWN_ESTIMATE}`,
    `deleteEstimateChanges:${OWN_ESTIMATE}`,
    `deletePaymentReminders:${OWN_ESTIMATE}`,
    `deleteEstimate:${OWN_ESTIMATE}:${OWNER_BUSINESS}`,
  ]);

  // The other business is untouched.
  expect(world.estimates.has(FOREIGN_ESTIMATE)).toBe(true);
  expect(world.storageObjects.has(`foreign-uid/${FOREIGN_ESTIMATE}/b.jpg`)).toBe(true);
});

test("another business's estimate id is refused with 404, and nothing of it is deleted", async () => {
  const { world, deps } = makeWorld();

  const result = await deleteOwnedEstimate(FOREIGN_ESTIMATE, OWNER_BUSINESS, deps);

  // The intended response: not found or access denied, not success.
  expect(result).toEqual({ ok: false, status: 404, error: ESTIMATE_NOT_FOUND_OR_DENIED });

  // The foreign estimate and every child survive.
  expect(world.estimates.has(FOREIGN_ESTIMATE)).toBe(true);
  expect(world.photoRows).toContainEqual({
    estimateId: FOREIGN_ESTIMATE,
    storagePath: `foreign-uid/${FOREIGN_ESTIMATE}/b.jpg`,
  });
  expect(world.storageObjects.has(`foreign-uid/${FOREIGN_ESTIMATE}/b.jpg`)).toBe(true);
  expect(world.changes).toContainEqual({ estimateId: FOREIGN_ESTIMATE });
  expect(world.reminders).toContainEqual({ estimateId: FOREIGN_ESTIMATE });
});

test("the ownership check is the only thing that runs when ownership fails", async () => {
  const { world, deps } = makeWorld();

  await deleteOwnedEstimate(FOREIGN_ESTIMATE, OWNER_BUSINESS, deps);

  // Not a single child lookup or deletion happens before, or after, the refusal.
  expect(world.calls).toEqual([`findOwnedEstimate:${FOREIGN_ESTIMATE}:${OWNER_BUSINESS}`]);
});

test("an id that does not exist at all is refused the same way", async () => {
  const { world, deps } = makeWorld();

  const result = await deleteOwnedEstimate("estimate-missing", OWNER_BUSINESS, deps);

  expect(result).toEqual({ ok: false, status: 404, error: ESTIMATE_NOT_FOUND_OR_DENIED });
  expect(world.calls).toEqual([`findOwnedEstimate:estimate-missing:${OWNER_BUSINESS}`]);
  expect(world.estimates.size).toBe(2);
  expect(world.storageObjects.size).toBe(2);
});

test("a failed ownership lookup deletes nothing and reports 500", async () => {
  const { world, deps } = makeWorld();
  deps.findOwnedEstimate = async () => {
    world.calls.push("findOwnedEstimate:threw");
    throw new Error("database unavailable");
  };

  const result = await deleteOwnedEstimate(OWN_ESTIMATE, OWNER_BUSINESS, deps);

  expect(result).toEqual({ ok: false, status: 500, error: "database unavailable" });
  expect(world.calls).toEqual(["findOwnedEstimate:threw"]);
  expect(world.estimates.size).toBe(2);
  expect(world.storageObjects.size).toBe(2);
});

test("children are deleted by the authorized estimate's id, and a failed parent delete is still an error", async () => {
  const { world, deps } = makeWorld();
  deps.deleteEstimate = async (estimateId, businessId) => {
    world.calls.push(`deleteEstimate:${estimateId}:${businessId}`);
    return "foreign key violation";
  };

  const result = await deleteOwnedEstimate(OWN_ESTIMATE, OWNER_BUSINESS, deps);

  expect(result).toEqual({ ok: false, status: 500, error: "foreign key violation" });
  // Every child call carries the id that passed the ownership check.
  for (const call of world.calls.slice(1)) {
    expect(call).toContain(OWN_ESTIMATE);
    expect(call).not.toContain(FOREIGN_ESTIMATE);
  }
});

test("the route delegates to the ownership-first helper and deletes nothing itself", () => {
  const route = readFileSync(path.join(root, "app/api/estimates/route.ts"), "utf8");
  const handler = route.slice(route.indexOf("export async function DELETE("));

  expect(handler).toContain("const result = await deleteOwnedEstimate(id, business.id, {");
  expect(handler).toContain('.eq("business_id", businessId)');
  expect(handler).toContain("{ error: result.error }, { status: result.status }");

  // No child or parent deletion runs before the helper is called: everything
  // between the id check and the helper is the helper call itself.
  const beforeHelper = handler.slice(0, handler.indexOf("deleteOwnedEstimate("));
  expect(beforeHelper).not.toMatch(/\.delete\(\)/);
  expect(beforeHelper).not.toMatch(/\.remove\(/);
  expect(beforeHelper).not.toContain('from("tpe_estimate_photos")');
});
