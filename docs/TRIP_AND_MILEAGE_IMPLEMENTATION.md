# Trip and Mileage Implementation

## Status

**Implemented** — domain model, routing provider abstraction, API routes, driver workspace integration, vehicle profile extension, and comprehensive unit tests.

## Domain model

### Collections

| Collection | Purpose |
|---|---|
| `trips` | Canonical trip records (one journey per doc) |
| `vehicles` | Extended with `estimatedKm`, `estimatedKmUpdatedAt`, `estimatedKmTripCount` |
| `odometerReadings` | Unchanged — authoritative verified odometer ledger |
| `assignments` | Unchanged — driver-vehicle responsibility periods |

### Trip lifecycle

```
DRAFT → COMPLETED  (via POST /api/v1/trips/[id]/complete)
DRAFT → CANCELLED  (via PATCH status)
```

### Key types

- **Trip**: vehicleId, driverUserId, assignmentId, tripDate, purpose, stops[], routeDistanceM, actualDistanceKm, distanceBasis, status
- **TripStop**: id, sequence, type (ORIGIN/INTERMEDIATE/DESTINATION), label, coordinates, purpose
- **RouteLeg**: fromStopId, toStopId, sequence, distanceM, durationS

### Distance representation

- **Canonical storage**: integer metres (`routeDistanceM`)
- **Display**: `routeDistanceM / 1000` with 2 decimal places
- **Distance basis**: `ROUTE_ESTIMATE`, `ACTUAL_ODOMETER`, or `MANUAL_OVERRIDE`
- Never sum individually rounded km values

## Two separate kilometre metrics

### A. Verified odometer (`vehicle.odometerKm`)

The existing odometer ledger. `max(accepted readings)`. Only advanced by permitted odometer-recording workflows. Never overwritten by route estimates.

### B. Estimated operational kilometres (`vehicle.estimatedKm`)

```
estimatedKm = latestVerifiedOdometerKm + SUM(routeDistanceM for eligible trips) / 1000
```

**Eligible trips**: status=COMPLETED, completedAt > verifiedBaselineAt.

**Reconciliation**: When a new verified odometer reading is recorded, `reconcileVehicleEstimatedKm()` recomputes eligible trips from the new baseline.

## Routing provider

### Interface (`src/lib/routing/provider.ts`)

```typescript
interface RoutingProvider {
  readonly name: string;
  calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult>;
}
```

### Implementations

- **MapboxRoutingProvider** (`src/lib/routing/mapbox.ts`) — Mapbox Directions API, server-side only
- **MockRoutingProvider** (`src/lib/routing/mock.ts`) — Haversine × 1.3 road factor, for dev/test

### Factory (`src/lib/routing/index.ts`)

Returns Mapbox if `MAPBOX_ACCESS_TOKEN` is set, otherwise Mock with a console warning in production.

## API routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/trips` | GET, POST | List/create trips |
| `/api/v1/trips/[id]` | GET, PATCH | Get/update draft trip |
| `/api/v1/trips/[id]/complete` | POST | Complete a trip (idempotent) |
| `/api/v1/trips/calculate-route` | POST | Calculate route distance |
| `/api/v1/trips/daily` | GET | Trips for a specific date |

## Permissions

| Permission | Who has it |
|---|---|
| `trip:create` | DRIVER, OPERATIONS, ADMIN |
| `trip:read` | DRIVER (own), OPERATIONS, MAINTENANCE, MANAGER, ADMIN |
| `trip:read:all` | OPERATIONS, MAINTENANCE, MANAGER, ADMIN |
| `trip:update` | DRIVER (own drafts), OPERATIONS, ADMIN |
| `trip:complete` | DRIVER, OPERATIONS, ADMIN |

## Configuration

### Mapbox (production)

```
MAPBOX_ACCESS_TOKEN=pk.xxx  # Server-side routing token
```

- Waypoint limit: 25 per request (Mapbox Directions)
- Timeout: 30 seconds
- Only called when user requests route calculation

### Mock (development/testing)

No configuration needed. Returns Haversine × 1.3 distances.

## Driver workspace integration

The driver workspace now includes:
- "Today's trips" card showing trips recorded for the current date (Africa/Accra)
- "Record Trip" button opening the multi-stop route builder dialog
- Pre-fills vehicle and driver from active assignment

## Vehicle profile extension

- `estimatedKm` displayed in the summary strip when > 0
- `estimatedKmTripCount` shown as context hint

## Test coverage

### Unit tests (43 new)

- Stop validation (valid, invalid coords, missing label)
- Trip validation (required fields, stops, manual distance)
- Completion validation (status gates)
- Idempotency key generation (deterministic, sorted)
- Route staleness marking
- Actual distance computation
- Origin/destination derivation
- Estimated projection (baseline, filtering, rounding, multiple trips)

### Routing tests (11 new)

- Haversine distance accuracy
- Mock provider (2-stop, multi-stop, return journey)
- Waypoint validation
- Road factor application
- Duplicate coordinates
- RoutingError codes

## Remaining work

- **UI polish**: location search/geocoding integration (currently manual coordinate entry)
- **Map preview**: Mapbox GL integration for route visualization
- **Vehicle profile trips tab**: full paginated trip history
- **Maintenance integration**: use estimatedKm in schedule evaluation with clear "estimated" labels
- **E2E browser tests**: full trip workflow via Playwright
- **Firestore composite indexes**: `trips` collection queries may need indexes for production scale