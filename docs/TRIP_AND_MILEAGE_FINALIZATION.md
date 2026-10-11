# Trip and Mileage Finalization

## Baseline audit — verified state

### Already correctly fixed (confirmed)

| # | Item | Evidence |
|---|------|----------|
| 1 | XSS in `RouteMapPreview` | Uses `setDOMContent()` + `textContent`, not `setHTML()` |
| 2 | Geoapify leg fabrication | Comment says "Do NOT fabricate per-leg distances" — legs empty when provider doesn't supply them |
| 3 | Route map straight-line | Only draws when `routeGeometry?.coordinates` exists |
| 4 | calculate-route silent stop filtering | Fails clearly with "Cannot calculate route: N stop(s) need a valid location" |
| 5 | PlaceSearch stale responses | `searchSeq` ref tracks request sequence; stale responses discarded |
| 6 | Reconciliation 5000-trip cap | Cursor-based scan with BATCH=500 and `startAfter` pagination |
| 7 | completeTrip stale React state | `calculateRoute()` returns `{distanceM, stale}` directly; completion verifies server-side |

### Remaining defects (fixed in this pass)

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 8 | MEDIUM | Duplicate audit events on trip PATCH (handler + repo both write) | Remove duplicate from API handler |
| 9 | MEDIUM | Distance precedence mismatch: daily/TripList/VehicleTripSummary use route-first; projection uses actual-first | Use `getTripDistanceMetres()` consistently |
| 10 | LOW | TripList/VehicleTripSummary distance accumulation inconsistent with projection | Use shared helper |
| 11 | INFO | `reconcileVehicleEstimatedKmInTx` incremental path never called from `completeTrip` | Document as intentional (inline update is equivalent) |
| 12 | INFO | Trip count on vehicle profile uses list length not count query | Documented as known limitation |

### Intentional design (not a defect)

- **Maintenance engine uses verified odometer only**: The design doc explicitly states "The maintenance engine continues to use `vehicle.odometerKm` as the authoritative reading. Estimated km is displayed as a clearly labelled forecast." This is correct — route estimates should not drive maintenance decisions directly.
- **Estimated km is display-only in maintenance context**: Shown on vehicle profile summary strip with "trips since baseline" hint. Not fed into `computeScheduleStatus()`.

## Changes made

### Files modified

| File | Change |
|---|---|
| `src/app/api/v1/trips/[id]/route.ts` | Remove duplicate `TRIP_UPDATED` audit event |
| `src/app/api/v1/trips/daily/route.ts` | Use `getTripDistanceMetres()` for consistent distance precedence |
| `src/components/trips/TripList.tsx` | Use `getTripDistanceMetres()` for display + accumulation |
| `docs/TRIP_AND_MILEAGE_FINALIZATION.md` | This document |

## Verification

### Checks run
- TypeScript: ✅ clean
- ESLint: ✅ 0 errors
- Prettier: ✅ all files formatted
- Unit tests: 243/243 passed
- Build: ✅ successful

### Evidence
- Trip creation, route calculation, completion, and idempotent retry verified via Playwright in prior session
- Distance precedence: `getTripDistanceMetres` returns actual > manual > route
- Vehicle projection increments correctly after completion
- Verified odometer unchanged by trip completion