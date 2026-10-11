# Trip and Mileage Implementation Design

> **Application:** Expedition Go Tours Fleet Management System
> **Date:** 2026-10-10

---

## Domain model

### Assignment (existing — no schema change)

An assignment represents a driver's responsibility for a vehicle during a period.
An assignment can contain multiple trips. The existing `distanceKm` field
(end odometer − start odometer) remains the authoritative measured distance
for the assignment period as a whole.

### Trip (new: `trips` collection)

One journey within an assignment. A driver may complete several trips against
the same assignment in one day.

```
trips/{tripId}
  id: string
  vehicleId: string
  driverUserId: string
  assignmentId: string | null
  recordedByUserId: string            // who entered the record
  tripDate: string                    // ISO date in Africa/Accra
  purpose: TripPurpose
  externalReference: string | null    // booking/tour reference
  notes: string | null

  status: "DRAFT" | "COMPLETED" | "CANCELLED"

  // Route
  origin: TripStop                    // first stop
  destination: TripStop               // last stop
  stops: TripStop[]                   // all stops including origin/destination

  // Route calculation
  routeDistanceM: number | null       // canonical metres (null = not calculated)
  routeDistanceKm: number | null      // display km (derived)
  routeDurationS: number | null       // estimated seconds
  routingProvider: string | null      // "mapbox" | "mock" | etc.
  routeCalculatedAt: string | null    // ISO timestamp
  routeProviderMeta: unknown | null   // audit/debug data

  // Actual odometer (when both readings exist)
  startOdometerKm: number | null
  endOdometerKm: number | null
  actualDistanceKm: number | null     // end - start when both verified

  // Distance basis
  distanceBasis: "ROUTE_ESTIMATE" | "ACTUAL_ODOMETER" | "MANUAL_OVERRIDE"
  manualDistanceKm: number | null
  manualDistanceReason: string | null

  // Staleness
  routeStale: boolean                 // true when stops changed after calculation

  // Completion
  startedAt: string | null            // ISO — actual journey start
  completedAt: string | null          // ISO — when marked complete
  idempotencyKey: string              // deterministic for dedup

  createdAt: string
  updatedAt: string
  createdBy: string
```

### TripStop

```
{
  id: string                          // stable UUID
  sequence: number                    // 0-based
  type: "ORIGIN" | "INTERMEDIATE" | "DESTINATION"
  label: string                       // user-facing name
  address: string | null
  latitude: number | null
  longitude: number | null
  placeId: string | null              // provider place identifier
  purpose: string | null              // pickup, drop-off, fuel, etc.
  notes: string | null
  arrivedAt: string | null
  departedAt: string | null
}
```

### RouteLeg (stored on trip document)

```
{
  fromStopId: string
  toStopId: string
  sequence: number
  distanceM: number
  durationS: number | null
}
```

### Vehicle extensions

Add to vehicle document (alongside existing `odometerKm`):

```
  estimatedKm: number | null          // projection from trips
  estimatedKmUpdatedAt: string | null
  lastTripAt: string | null
  lastReconciledAt: string | null     // when a verified reading reconciled
  mileageReconciled: boolean          // true if estimated is within threshold
```

### Projection formula

```
estimatedKm = latestVerifiedOdometerKm
            + SUM(routeDistanceKm for completed trips where completedAt > latestVerifiedAt)
```

When a new verified reading is recorded:
1. It becomes the new `latestVerifiedOdometerKm` baseline.
2. Recompute `estimatedKm` using only trips completed after the new reading's effectiveAt.
3. Historical trips are preserved but not re-counted.

### Distance representation

- Canonical storage: integer metres (`routeDistanceM`)
- Display: kilometres with 1 decimal (`routeDistanceM / 1000`)
- Never sum rounded km values — always sum metres, convert at display boundary
- Actual trip distance from odometer: `endOdometerKm - startOdometerKm` (integer km, matches existing ledger)

### Collections

- `trips` — new collection
- `vehicles` — extend with estimated km fields
- No changes to `assignments`, `odometerReadings`, `maintenanceSchedules`

### Routing provider abstraction

```typescript
interface RouteWaypoint {
  latitude: number;
  longitude: number;
  label?: string;
}

interface RouteLegResult {
  distanceM: number;
  durationS: number;
}

interface RouteResult {
  totalDistanceM: number;
  totalDurationS: number;
  legs: RouteLegResult[];
  provider: string;
  calculatedAt: string;
  providerMeta?: unknown;
}

interface RoutingProvider {
  name: string;
  calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult>;
}
```

Implementations:
- `MapboxRoutingProvider` — Mapbox Directions API (production)
- `MockRoutingProvider` — deterministic for tests

### Permissions

Reuse existing permissions:
- `assignment:start` / `assignment:create` — to create trips
- `assignment:read` — to view trips
- New: `trip:create`, `trip:read:own`, `trip:read:all`, `trip:update`, `trip:complete`

Actually, let's keep it simpler and add just:
- `TRIP_CREATE: "trip:create"` — DRIVER, OPERATIONS, ADMIN
- `TRIP_READ: "trip:read"` — DRIVER (own), OPERATIONS, MAINTENANCE, MANAGER, ADMIN
- `TRIP_UPDATE: "trip:update"` — DRIVER (own drafts), OPERATIONS, ADMIN
- `TRIP_COMPLETE: "trip:complete"` — DRIVER, OPERATIONS, ADMIN

### Firestore indexes

- `trips` where `vehicleId == X` and `status == Y` (list by vehicle)
- `trips` where `driverUserId == X` and `tripDate == Y` (daily trips)
- `trips` where `assignmentId == X` (trips for assignment)

### Mileage reconciliation rules

1. A completed trip's route distance contributes to `estimatedKm` exactly once.
2. The key is `completedAt > latestVerifiedOdometerEffectiveAt`.
3. If a trip is completed retroactively (past date) and a newer verified reading exists, the trip is excluded from the current projection.
4. If a trip is edited/voided, recompute the projection.
5. If estimated vs verified diverge by more than 10%, flag for reconciliation.
6. Never overwrite verified odometer with route estimates.
7. A trip with actual odometer readings has `distanceBasis = "ACTUAL_ODOMETER"` and its `actualDistanceKm` is preserved separately.