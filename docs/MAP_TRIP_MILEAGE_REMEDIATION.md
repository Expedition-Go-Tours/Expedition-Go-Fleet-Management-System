# Map, Trip & Mileage Remediation Log

## Baseline audit — confirmed findings

### Defects confirmed and fixed

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | `RouteMapPreview` uses `setHTML` with unsanitised stop labels/purposes — HTML injection | Fixed |
| 2 | HIGH | `completeTrip()` callback reads stale `routeDistanceM` after async `calculateRoute()` | Fixed |
| 3 | HIGH | `GeoapifyRoutingProvider` fabricates equal per-leg distances when legs missing | Fixed |
| 4 | HIGH | `RouteMapPreview` draws straight lines when geometry unavailable, misrepresenting driving route | Fixed |
| 5 | MEDIUM | `calculate-route` API silently filters stops without coordinates instead of failing clearly | Fixed |
| 6 | MEDIUM | PlaceSearch debounce allows stale responses to overwrite current results | Fixed |
| 7 | MEDIUM | `completeTrip` API writes duplicate audit event (handler + repo both emit) | Fixed |
| 8 | LOW | `reconcileVehicleEstimatedKmInTx` full-recompute capped at 5,000 trips | Fixed (added cursor) |

### Already correct (no fix needed)

| Item | Status |
|---|---|
| Trip creation idempotency via `idempotencyToken` | Already works |
| `completeTrip` idempotency via status check | Already works |
| All reads before writes in transactions | Already fixed in prior commit |
| `getTripDistanceMetres` precedence (actual > manual > route) | Already correct |
| Stop validation (unique IDs, contiguous sequences, origin/dest position) | Already correct |
| Production blocks mock provider | Already correct |
| Geoapify as primary routing provider | Already correct |
| Photon geocoding with Ghana proximity bias | Already correct |

### Missing features (documented, not yet implemented)

| Item | Notes |
|---|---|
| Operations Trips register page | Requires new route + filters + pagination |
| Trip detail page `/trips/[id]` | Requires new route + map view |
| Saved company locations | Requires new collection + UI |
| Route chunking for waypoint limits | Needs documented policy |
| Maintenance forecast integration with estimated km | Engine uses `currentOdometerKm` only |