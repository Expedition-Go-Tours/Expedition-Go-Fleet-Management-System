# Trip and Mileage Implementation

## Status

**Implemented and verified** — domain model, routing providers, API routes, driver workspace integration, vehicle profile trips tab, map preview, and comprehensive unit + E2E tests.

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

**Distance precedence** per trip:
1. `actualDistanceKm` when valid start/end odometer readings exist
2. `manualDistanceKm` when explicitly authorized (`distanceBasis = MANUAL_OVERRIDE`)
3. `routeDistanceM` as a fallback from the routing provider

**Reconciliation**: When a new verified odometer reading is recorded, `reconcileVehicleEstimatedKm()` recomputes eligible trips from the new baseline.

**Incremental update**: `completeTrip()` computes the just-completed trip's contribution from the vehicle snapshot already read in the transaction — no re-query of all trips.

## Routing providers

### Interface (`src/lib/routing/provider.ts`)

```typescript
interface RoutingProvider {
  readonly name: string;
  calculateRoute(waypoints: RouteWaypoint[]): Promise<RouteResult>;
}
```

`RouteResult` includes optional `geometry: GeoJsonLineString` for map rendering.

### Implementations (priority order)

| Provider | File | Config | Notes |
|---|---|---|---|
| **Geoapify** | `src/lib/routing/geoapify.ts` | `GEOAPIFY_API_KEY` | Free tier: 3,000 req/day. Primary. |
| **Mapbox** | `src/lib/routing/mapbox.ts` | `MAPBOX_ACCESS_TOKEN` | Secondary fallback. Server-side only. |
| **Mock** | `src/lib/routing/mock.ts` | — | Haversine × 1.3 straight-line estimate. Results are flagged `approximate: true`. |

### Factory (`src/lib/routing/index.ts`)

Returns Geoapify if `GEOAPIFY_API_KEY` is set, then Mapbox, then the mock.

**This never throws.** A missing routing key must not take down trip recording, so
with no provider configured the app keeps working on approximate distances and
the UI says so ("Approximate distance — no routing service is configured").
`isRoutingConfigured()` reports whether a real service is in use. The warning is
logged once per process, not on every calculation.

## Geocoding

### Photon (`src/lib/routing/photon.ts`)

Free OpenStreetMap-based geocoding via `photon.komoot.io`. Server-side only. Ghana proximity bias when coordinates are provided.

### API: `GET /api/v1/trips/search-places?q=...&lat=...&lng=...`

Requires `trip:read` permission. Debounced on the client (300ms). Returns `{ places: GeocodingResult[] }`.

## Map preview

### MapLibre GL + OpenFreeMap (`src/components/trips/RouteMapPreview.tsx`)

- **MapLibre GL JS**: open-source map renderer, loaded via dynamic import (no SSR issues)
- **OpenFreeMap tiles**: `tiles.openfreemap.org/styles/liberty` — free, no API key needed
- Route line in brand accent color (`#f15a24`)
- Numbered markers with popups showing stop labels
- Accepts `routeGeometry` prop for accurate route line (falls back to straight-line)
- Graceful fallback when tiles or JS fail to load

## API routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/trips` | GET, POST | List/create trips |
| `/api/v1/trips/[id]` | GET, PATCH | Get/update draft trip |
| `/api/v1/trips/[id]/complete` | POST | Complete a trip (idempotent) |
| `/api/v1/trips/calculate-route` | POST | Calculate route distance |
| `/api/v1/trips/search-places` | GET | Photon geocoding search |
| `/api/v1/trips/daily` | GET | Trips for a specific date |

### Authorization

- `calculate-route` with `tripId`: checks ownership (drivers can only update their own drafts), DRAFT-only status, stop fingerprint before saving
- `POST /trips`: validates vehicle ACTIVE, driver exists, assignment matches
- `PATCH /trips/[id]`: DRAFT-only, ownership check
- `complete`: idempotent (returns existing result if already completed)

### Idempotency

- `createTrip` accepts `idempotencyToken` as the Firestore document ID for deterministic dedup
- `completeTrip` returns existing result for already-completed trips
- No duplicate audit events (single canonical write in repo)

## Driver workspace integration

The driver workspace (`/workspace`) now includes:
- "Today's trips" card with count and trip list
- "Record Trip" button opening the multi-stop route builder dialog
- Pre-fills vehicle from the first ACTIVE vehicle

## Vehicle profile

- `estimatedKm` displayed in the summary strip when > 0
- `estimatedKmTripCount` shown as context hint
- **Trips tab** in `VehicleDetailTabs` with paginated history
- Each row shows: driver, purpose, origin→destination, stop count, route distance, actual distance, distance basis, status

## Record Trip dialog

### Features
- Vehicle selector (prefilled from active assignment)
- Trip date, purpose, booking/tour reference
- **Location search** via Photon geocoding (debounced, Ghana-biased)
- Manual coordinate fallback (pencil icon)
- Add/remove/reorder stops
- Return to origin shortcut
- Route calculation with distance and duration
- **Map preview** with MapLibre + OpenFreeMap
- Per-leg distance display
- Route-stale warning when stops change
- Save draft / Complete trip
- Notes

### Completion flow
1. Save draft (creates or updates trip) → returns trip ID
2. If route stale or missing → recalculate
3. Complete trip (idempotent) → reconciles vehicle estimated km
4. Server validates: vehicle ACTIVE, driver exists, route not stale

## Configuration

### Environment variables

```
# Primary routing (free)
GEOAPIFY_API_KEY=

# Secondary routing (optional)
MAPBOX_ACCESS_TOKEN=

# Map rendering: OpenFreeMap + MapLibre (no token needed)
```

### Vercel deployment

- `GEOAPIFY_API_KEY` — server-side only, never exposed in client bundles
- `MAPBOX_ACCESS_TOKEN` — server-side only (optional fallback)
- No client-side map token required (OpenFreeMap is free)

### Firestore indexes

Trip queries may need composite indexes at production scale:
- `trips` where `vehicleId == X` and `status == Y`
- `trips` where `driverUserId == X` and `tripDate == Y`

## Maintenance integration

The vehicle profile shows:
- Verified odometer (unchanged by trips)
- Estimated operational km (from completed trips)
- Trip count since last reconciliation

The maintenance engine (`computeScheduleStatus`) continues to use `vehicle.odometerKm` as the authoritative reading. Estimated km is displayed as a clearly labeled forecast.

## Test coverage

### Unit tests (237 passed)
- Trip domain: validation, projection, idempotency, staleness, distance
- Routing: Haversine accuracy, mock provider, Geoapify interface, error codes

### E2E tests (`e2e/trips.spec.ts`)
- 7 tests covering: dialog open, location search, route calculation, save/complete, vehicle page, mobile overflow
- Self-skipping when credentials not configured

### Playwright verification (live)
- ✅ Photon geocoding returns real Accra/Cape Coast/Kotoka results
- ✅ Route: 178.7km Accra→Kotoka→Cape Coast (real road distances)
- ✅ MapLibre map renders with route line and markers
- ✅ Trip completion: estimated km = 120,328.68 (verified 120,150 + 178.7)
- ✅ Verified odometer unchanged (120,150)
- ✅ Idempotent: retry returns same result, no double-count
- ✅ Vehicle profile shows estimated km and trips tab
- ✅ Daily trip list and vehicle trips query work

## Remaining work

- **Full interactive map with route editing**: drag-to-reorder on the map itself
- **Saved company locations**: frequently used origins/destinations
- **Trip detail page** (`/trips/[id]`): full view with map, legs, correction history
- **Operations trip register**: `/trips` page with filters, pagination, export
- **Route chunking**: for trips exceeding provider waypoint limits
- **Actual odometer reconciliation**: flag route-vs-actual discrepancies
- **Full E2E workflow**: authenticated end-to-end test with real Firebase

---

## Completed features (final release)

### Trip detail page (`/trips/[id]`)
- Full trip metadata: vehicle, driver, recorder, dates, purpose, reference
- Route map with MapLibre GL + OpenFreeMap tiles
- Ordered stop list with per-leg distances and durations
- Odometer readings, distance basis, reconciliation status
- Navigation links to vehicle profile and back to trip register

### Operations trip register (`/trips`)
- Full pagination (25 per page) with page controls
- Filters: search text, date, status, purpose, vehicle, driver (read-all)
- Summary metrics: total trips, total distance, stale routes, missing distance
- Server-side filtering with permission-scoped access
- Navigable trip rows with distance and status indicators

### Saved company locations
- New `savedLocations` Firestore collection
- Full CRUD API: `GET/POST /api/v1/saved-locations`
- Categories: OFFICE, AIRPORT, HOTEL, TOUR_ATTRACTION, WORKSHOP, FUEL_STATION, PICKUP_POINT, DROPOFF_POINT, OTHER
- `savedLocationToStop()` converts to TripStop for quick selection
- Audit events: `savedLocation.created`, `savedLocation.updated`

### Route chunking (Geoapify)
- Trips with >25 waypoints automatically split into provider-sized chunks
- Boundary stops shared between chunks (no double-counting)
- Geometry merged across chunks with deduplication at boundaries
- Total distance and duration summed correctly

### Odometer reconciliation flagging
- `checkReconciliation(trip)`: flags trips where route estimate diverges >20% from actual
- Minimum distance threshold: 500m (short trips not flagged)
- `findReconciliationFlags(trips)`: batch check for vehicle profiles
- Shown in vehicle Trips tab with warning indicator

### Mileage reconciliation reminders
- `deriveMileageReminders()`: generates `MILEAGE_STALE` and `MILEAGE_RECONCILIATION` notifications
- Stale warning: no verified odometer reading in 30+ days
- Reconciliation warning: estimated vs verified km differs >5% or >500km
- Idempotent deduplication keys (day-bucketed)

### Navigation
- "Trips" added to Fleet navigation group (permission-gated: `trip:read`)

## Test results

| Suite | Count | Status |
|---|---|---|
| Unit tests | 266 | ✅ All passing |
| Lint | — | ✅ 0 errors |
| Typecheck | — | ✅ Clean (source) |
| Build | — | ✅ Successful |
| E2E (Playwright) | — | ✅ Self-skipping without credentials |

### New tests added
- `checkReconciliation`: 6 tests (flagging, thresholds, edge cases)
- `findReconciliationFlags`: batch filtering
- `validateSavedLocation`: 8 tests (validation rules)
- `savedLocationToStop`: conversion
- Route chunking: Geoapify provider validation
- Route geometry: GeoJSON structure validation
- `deriveMileageReminders`: 5 tests (stale, reconciliation, dedup)
