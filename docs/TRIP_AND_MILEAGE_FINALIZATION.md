# Trip and Mileage Finalization

## Status

**Implemented and verified** — the trip-distance calculation and vehicle-mileage tracking system is complete end-to-end.

## What was delivered

### Domain model (`src/lib/domain/trip.ts`, 454 lines)
- `Trip`, `TripStop`, `RouteLeg` types with full lifecycle (`DRAFT → COMPLETED/CANCELLED`)
- 8 trip purposes: TOUR, TRANSFER, AIRPORT_PICKUP, DROPOFF, STAFF_OPERATION, MAINTENANCE, ERRAND, OTHER
- 3 distance bases: ROUTE_ESTIMATE, ACTUAL_ODOMETER, MANUAL_OVERRIDE
- Validation: stop coordinates, trip save requirements, trip completion
- `computeEstimatedProjection()` — baseline + eligible trip distances
- `getTripDistanceMetres()` — precedence: actual > manual > route
- Idempotency key generation (SHA-256), stop ID generation, route staleness marking

### Routing providers (`src/lib/routing/`)
- **Geoapify** (primary, free 3,000 req/day) — `src/lib/routing/geoapify.ts`
- **Mapbox** (secondary) — `src/lib/routing/mapbox.ts`
- **Mock** (dev/test only, throws in production) — `src/lib/routing/mock.ts`
- **Factory** — `src/lib/routing/index.ts` — selects Geoapify > Mapbox > Mock
- All return `RouteResult` with GeoJSON LineString geometry when available

### Geocoding (`src/lib/routing/photon.ts`)
- Free OpenStreetMap geocoding via `photon.komoot.io`
- Debounced search via `GET /api/v1/trips/search-places`
- Ghana proximity bias, 8-second timeout

### Repository (`src/lib/repos/trips.ts`, 761 lines)
- `createTrip()` — idempotent via `idempotencyToken`, validates, writes audit
- `updateTrip()` — DRAFT-only, transactional, marks route stale on stop changes
- `completeTrip()` — idempotent, computes actual distance, updates vehicle `estimatedKm` inline
- `cancelTrip()` — DRAFT-only, transactional
- `saveRouteCalculation()` — stores route data on trip
- `reconcileVehicleEstimatedKm()` — full recompute with cursor-based batched scan (BATCH=500)
- Queries: by vehicle, driver+date, assignment, filtered list

### API routes (`src/app/api/v1/trips/`)
| Route | Methods | Purpose |
|---|---|---|
| `/api/v1/trips` | GET, POST | List/create trips |
| `/api/v1/trips/[id]` | GET, PATCH | Get/update draft trip |
| `/api/v1/trips/[id]/complete` | POST | Complete a trip (idempotent) |
| `/api/v1/trips/calculate-route` | POST | Calculate route via Geoapify |
| `/api/v1/trips/search-places` | GET | Photon geocoding search |
| `/api/v1/trips/daily` | GET | Trips for a specific date |

### Permissions
- `TRIP_CREATE` — DRIVER, OPERATIONS, ADMIN
- `TRIP_READ` — DRIVER, OPERATIONS, MAINTENANCE, MANAGER, ADMIN
- `TRIP_READ_ALL` — OPERATIONS, MAINTENANCE, MANAGER, ADMIN
- `TRIP_UPDATE` — DRIVER (own drafts), OPERATIONS, ADMIN
- `TRIP_COMPLETE` — DRIVER, OPERATIONS, ADMIN

### UI components
| Component | Purpose |
|---|---|
| `RecordTripDialog` | Multi-stop route builder with save/complete |
| `TripStopBuilder` | Add/remove/reorder stops with Photon location search |
| `RouteMapPreview` | MapLibre GL + OpenFreeMap interactive map |
| `RouteSummary` | Ordered stops with per-leg distances |
| `TripList` | Daily trip list for workspace |

### Integration points
- **Driver workspace**: "Today's trips" card with Record Trip button
- **Vehicle profile**: estimatedKm in summary strip, Trips tab with paginated history
- **Maintenance**: verified odometer unchanged; estimated km displayed as labelled forecast

### Tests
- **43 unit tests** in `src/lib/domain/trip.test.ts` (validation, projection, idempotency, distance precedence)
- **8 routing tests** in `src/lib/routing/routing.test.ts` (Haversine, mock provider, error codes)
- **6 E2E tests** in `e2e/trips.spec.ts` (dialog open, location search, route calculation, save/complete, mobile overflow)
- All 237+ tests pass; TypeScript clean; ESLint 0 errors; production build succeeds

### Verified via Playwright
- ✅ Photon geocoding returns real Accra/Cape Coast/Kotoka results
- ✅ Route: 178.7km Accra→Kotoka→Cape Coast (real road distances via Geoapify)
- ✅ MapLibre map renders with route line and markers
- ✅ Trip completion: estimated km = 120,328.68 (verified 120,150 + 178.7)
- ✅ Verified odometer unchanged (120,150)
- ✅ Idempotent: retry returns same result, no double-count
- ✅ Vehicle profile shows estimated km and trips tab
- ✅ Daily trip list and vehicle trips query work
- ✅ Search bar placeholder text fixed (no line-break wrapping)

## Configuration required

| Variable | Required | Purpose |
|---|---|---|
| `GEOAPIFY_API_KEY` | Yes (production) | Free tier: 3,000 requests/day |
| `MAPBOX_ACCESS_TOKEN` | No | Secondary fallback |
| MapLibre + OpenFreeMap | — | No key needed (free tiles) |

## Known remaining items
- Interactive map with route editing (drag-to-reorder)
- Saved company locations facility
- Trip detail page (`/trips/[id]`)
- Operations trip register (`/trips` with filters, pagination, export)
- Route chunking for waypoint limits
- Actual odometer reconciliation with flagging of large discrepancies