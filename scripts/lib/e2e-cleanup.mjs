/**
 * Shared E2E teardown.
 *
 * E2E runs create fixtures and then drive the API, which writes child records
 * (work orders, issues, inspections, readings, join rows, reservations) that
 * reference the test vehicles and users. Deleting the vehicle/user first leaves
 * those children orphaned, which is what previously polluted the board with
 * "vehicle not found" rows. This sweeps dependents BEFORE the caller removes
 * the parent vehicle/user docs.
 *
 * `vehicleIds` is the set of vehicle doc ids and `userIds` the set of
 * users-collection doc ids that appear on the records.
 */

const MAX_IN = 30;

async function deleteWhereIn(db, collection, field, values) {
  const ids = [...values];
  if (ids.length === 0) return [];
  const found = [];
  for (let i = 0; i < ids.length; i += MAX_IN) {
    const chunk = ids.slice(i, i + MAX_IN);
    const snap = await db.collection(collection).where(field, "in", chunk).get();
    found.push(...snap.docs);
  }
  await Promise.all(found.map((d) => d.ref.delete()));
  return found.map((d) => d.id);
}

export async function sweepE2eFixtures(db, { vehicleIds = [], userIds = [] } = {}) {
  const vehicles = new Set(vehicleIds);
  const users = new Set(userIds);

  // Parents whose dependents must go first.
  const deletedWorkOrders = new Set(await deleteWhereIn(db, "workOrders", "vehicleId", vehicles));
  const deletedIssues = new Set(
    await deleteWhereIn(db, "maintenanceReports", "vehicleId", vehicles),
  );
  const deletedAssignments = new Set([
    ...(await deleteWhereIn(db, "assignments", "vehicleId", vehicles)),
    ...(await deleteWhereIn(db, "assignments", "driverUserId", users)),
  ]);

  // Join rows between work orders and issues (no vehicleId on these).
  const joinIds = new Set();
  for (const [field, values] of [
    ["workOrderId", deletedWorkOrders],
    ["issueId", deletedIssues],
  ]) {
    for (const id of await deleteWhereIn(db, "workOrderIssues", field, values)) joinIds.add(id);
  }

  // Remaining vehicle-scoped records.
  for (const collection of [
    "incidentReports",
    "expenses",
    "odometerReadings",
    "maintenanceSchedules",
    "serviceRecords",
    "vehicleDocuments",
    "fuelEntries",
    "inspections",
  ]) {
    await deleteWhereIn(db, collection, "vehicleId", vehicles);
  }

  // Reservations are keyed by `vehicle:<id>` / `driver:<id>` (plus assignment).
  for (const id of [...vehicles].map((v) => `vehicle:${v}`)) {
    await db
      .collection("assignmentReservations")
      .doc(id)
      .delete()
      .catch(() => {});
  }
  for (const id of [...users].map((u) => `driver:${u}`)) {
    await db
      .collection("assignmentReservations")
      .doc(id)
      .delete()
      .catch(() => {});
  }
  await deleteWhereIn(db, "assignmentReservations", "assignmentId", deletedAssignments);

  // Session + audit artifacts for the test users.
  await deleteWhereIn(db, "sessions", "userId", users);
  await deleteWhereIn(db, "auditLogs", "actorId", users);

  return { deletedWorkOrders, deletedIssues, deletedAssignments, joinIds };
}
