"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { RouteMapPreview } from "@/components/trips/RouteMapPreview";
import { RouteSummary } from "@/components/trips/RouteSummary";
import { makeStop, TripStopBuilder } from "@/components/trips/TripStopBuilder";
import { api } from "@/lib/client/api";
import {
  buildTripDraft,
  planQuickTrip,
  parseOdometerReading,
  TRIP_PURPOSES,
  type RouteLeg,
  type Trip,
  type TripDraftErrors,
  type TripStop,
} from "@/lib/domain/trip";
import type { GeoJsonLineString } from "@/lib/routing/provider";

/*
 * Record Trip dialog.
 *
 * The default path is three answers: where you went, and the start/end
 * odometer. The odometer pair gives the distance (ACTUAL_ODOMETER), so no
 * routing provider is needed and the trip can be completed in one step.
 *
 * Route planning — ordered stops, coordinates, map and booking reference —
 * lives behind "More details" for the trips that need it; both paths persist
 * the same trip record.
 */

interface RecordTripDialogProps {
  /** Vehicle options for the dropdown; odometerKm prefills the start reading. */
  vehicles: { id: string; label: string; odometerKm?: number }[];
  /** Default vehicle (from active assignment). */
  defaultVehicleId?: string;
  /** Default driver user id (from auth). */
  driverUserId: string;
  /** Default date (today in Africa/Accra). */
  defaultDate: string;
  /** Assignment id, if the driver has an active assignment. */
  assignmentId?: string;
  /** Pre-built button trigger. If omitted, renders a default button. */
  trigger?: React.ReactNode;
}

function seededStops(): TripStop[] {
  return [makeStop(0, "ORIGIN"), makeStop(1, "DESTINATION")];
}

export function RecordTripDialog({
  vehicles,
  defaultVehicleId,
  driverUserId,
  defaultDate,
  assignmentId,
  trigger,
}: RecordTripDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TripDraftErrors & { odometers?: string }>({});
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  // Form state
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? vehicles[0]?.id ?? "");
  const [tripDate, setTripDate] = useState(defaultDate);
  const [purpose, setPurpose] = useState<string>("OTHER");
  const [externalReference, setExternalReference] = useState("");
  const [notes, setNotes] = useState("");
  const [stops, setStops] = useState<TripStop[]>(seededStops);
  const [startOdometerKm, setStartOdometerKm] = useState("");
  const [endOdometerKm, setEndOdometerKm] = useState("");
  // Once the driver edits the start reading, changing vehicle must not
  // overwrite it — their reading wins over the vehicle's last known value.
  const [startOdometerTouched, setStartOdometerTouched] = useState(false);
  const [routeLegs, setRouteLegs] = useState<RouteLeg[]>([]);
  const [routeDistanceM, setRouteDistanceM] = useState<number | null>(null);
  const [routeDurationS, setRouteDurationS] = useState<number | null>(null);
  const [routeProvider, setRouteProvider] = useState<string | null>(null);
  const [routeCalculatedAt, setRouteCalculatedAt] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<GeoJsonLineString | null>(null);
  const [routeStale, setRouteStale] = useState(false);
  const [routeApproximate, setRouteApproximate] = useState(false);
  const [savedTripId, setSavedTripId] = useState<string | null>(null);

  // Track stop changes to mark route stale.
  const prevStopsRef = useRef<string>("");
  const handleStopsChange = useCallback(
    (newStops: TripStop[]) => {
      setStops(newStops);
      const serialized = JSON.stringify(
        newStops.map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude })),
      );
      if (prevStopsRef.current && serialized !== prevStopsRef.current && routeDistanceM !== null) {
        setRouteStale(true);
      }
      prevStopsRef.current = serialized;
    },
    [routeDistanceM],
  );

  const vehicleOdometer = useCallback(
    (id: string) => vehicles.find((v) => v.id === id)?.odometerKm ?? null,
    [vehicles],
  );

  const resetForm = useCallback(() => {
    const firstVehicleId = defaultVehicleId ?? vehicles[0]?.id ?? "";
    setError(null);
    setCalcError(null);
    setFieldErrors({});
    setAdvanced(false);
    setVehicleId(firstVehicleId);
    setTripDate(defaultDate);
    setPurpose("OTHER");
    setExternalReference("");
    setNotes("");
    setStops(seededStops());
    const seededOdometer = vehicleOdometer(firstVehicleId);
    setStartOdometerKm(seededOdometer === null ? "" : String(seededOdometer));
    setStartOdometerTouched(false);
    setEndOdometerKm("");
    setRouteLegs([]);
    setRouteDistanceM(null);
    setRouteDurationS(null);
    setRouteProvider(null);
    setRouteCalculatedAt(null);
    setRouteGeometry(null);
    setRouteStale(false);
    setRouteApproximate(false);
    setSavedTripId(null);
    prevStopsRef.current = "";
  }, [defaultVehicleId, defaultDate, vehicles, vehicleOdometer]);

  const handleOpen = useCallback(() => {
    resetForm();
    setOpen(true);
  }, [resetForm]);

  const handleClose = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  const changeVehicle = useCallback(
    (nextVehicleId: string) => {
      setVehicleId(nextVehicleId);
      if (startOdometerTouched) return;
      const km = vehicleOdometer(nextVehicleId);
      setStartOdometerKm(km === null ? "" : String(km));
    },
    [startOdometerTouched, vehicleOdometer],
  );

  const origin = stops.find((s) => s.type === "ORIGIN") ?? null;
  const destination = stops.find((s) => s.type === "DESTINATION") ?? null;

  const setStopLabel = useCallback((type: "ORIGIN" | "DESTINATION", label: string) => {
    setStops((prev) => prev.map((s) => (s.type === type ? { ...s, label } : s)));
  }, []);

  // Live distance from the odometer pair — the number the trip will be
  // credited with. Invalid or reversed pairs show no value (and an error on
  // submit), never a misleading one.
  const quickPlan = useMemo(
    () =>
      planQuickTrip({
        vehicleId,
        driverUserId,
        tripDate,
        purpose,
        stops,
        startOdometerKm,
        endOdometerKm,
        assignmentId,
        externalReference,
        notes,
      }),
    [
      vehicleId,
      driverUserId,
      tripDate,
      purpose,
      stops,
      startOdometerKm,
      endOdometerKm,
      assignmentId,
      externalReference,
      notes,
    ],
  );
  const hasOdometerPair =
    parseOdometerReading(startOdometerKm) !== null && parseOdometerReading(endOdometerKm) !== null;
  const distancePreview = hasOdometerPair ? quickPlan.distanceKm : null;

  // Persist the draft (shared by "Save draft" and the route flow).
  const saveDraft = useCallback(
    async (existingId: string | null): Promise<string | null> => {
      setBusy(true);
      setError(null);
      try {
        const built = buildTripDraft({
          vehicleId,
          driverUserId,
          tripDate,
          purpose,
          stops,
          assignmentId,
          externalReference,
          notes,
        });
        if (!built.ok) {
          setFieldErrors(built.errors);
          setError(Object.values(built.errors)[0] ?? "Complete the required fields.");
          return null;
        }

        let tripId: string;
        if (existingId) {
          await api.patch(`/api/v1/trips/${existingId}`, built.draft);
          tripId = existingId;
        } else {
          const result = await api.post<{ trip: Trip }>("/api/v1/trips", built.draft);
          tripId = result.trip.id;
          setSavedTripId(tripId);
        }

        router.refresh();
        return tripId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save trip");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [
      vehicleId,
      driverUserId,
      tripDate,
      purpose,
      stops,
      assignmentId,
      externalReference,
      notes,
      router,
    ],
  );

  // Calculate route — returns the result so callers can use it without waiting
  // for React state to propagate (avoids stale-closure bugs in async flows).
  const calculateRoute = useCallback(async (): Promise<{
    distanceM: number | null;
    stale: boolean;
  }> => {
    setCalculating(true);
    setCalcError(null);
    setError(null);

    // Validate stops have coordinates before saving
    const coordStops = stops.filter((s) => s.latitude != null && s.longitude != null);
    if (coordStops.length < 2) {
      setCalcError("Add coordinates to at least 2 stops to calculate a route.");
      setCalculating(false);
      return { distanceM: null, stale: true };
    }

    // Always save first so the server calculates against persisted stops.
    // This ensures the calculated route matches exactly what will be completed.
    // For new trips this creates the draft; for edited drafts it persists changes.
    const tripId = await saveDraft(savedTripId);
    if (!tripId) {
      setCalcError("Save the trip before calculating the route.");
      setCalculating(false);
      return { distanceM: null, stale: true };
    }

    try {
      // Always use tripId so the server persists the route against the trip.
      const result = await api.post<{
        route: {
          totalDistanceM: number;
          totalDurationS: number;
          legs: Array<{ distanceM: number; durationS: number }>;
          provider: string;
          calculatedAt: string;
          geometry?: { type: string; coordinates: [number, number][] };
          approximate?: boolean;
        };
        legs: RouteLeg[];
      }>("/api/v1/trips/calculate-route", { tripId });

      setRouteDistanceM(result.route.totalDistanceM);
      setRouteDurationS(result.route.totalDurationS);
      setRouteProvider(result.route.provider);
      setRouteCalculatedAt(result.route.calculatedAt);
      setRouteApproximate(result.route.approximate === true);
      setRouteLegs(result.legs);
      setRouteGeometry(
        result.route.geometry && result.route.geometry.type === "LineString"
          ? { type: "LineString", coordinates: result.route.geometry.coordinates }
          : null,
      );
      setRouteStale(false);
      return { distanceM: result.route.totalDistanceM, stale: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Route calculation failed";
      setCalcError(msg);
      return { distanceM: null, stale: true };
    } finally {
      setCalculating(false);
    }
  }, [stops, saveDraft, savedTripId]);

  const finish = useCallback(() => {
    setOpen(false);
    resetForm();
    router.refresh();
  }, [resetForm, router]);

  const showPlanErrors = useCallback((errors: TripDraftErrors & { odometers?: string }) => {
    setFieldErrors(errors);
    setError(Object.values(errors)[0] ?? "Complete the required fields.");
  }, []);

  // Fast path: save the draft, then complete with the odometer pair.
  const completeQuickTrip = useCallback(async () => {
    if (!quickPlan.ok || !quickPlan.completion) {
      showPlanErrors(quickPlan.errors);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let tripId = savedTripId;
      if (tripId) {
        await api.patch(`/api/v1/trips/${tripId}`, quickPlan.draft);
      } else {
        const result = await api.post<{ trip: Trip }>("/api/v1/trips", quickPlan.draft);
        tripId = result.trip.id;
        setSavedTripId(tripId);
      }

      await api.post(`/api/v1/trips/${tripId}/complete`, quickPlan.completion);
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete trip");
    } finally {
      setBusy(false);
    }
  }, [quickPlan, savedTripId, showPlanErrors, finish]);

  // Route path: only used when the odometer pair is absent (driver does not
  // have the readings) — the distance then comes from the calculated route.
  const completeViaRoute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const tripId = await saveDraft(savedTripId);
      if (!tripId) return;

      const calcResult = await api.post<{
        route: { totalDistanceM: number };
        legs: RouteLeg[];
      }>("/api/v1/trips/calculate-route", { tripId });

      if (!calcResult.route.totalDistanceM || calcResult.route.totalDistanceM <= 0) {
        throw new Error("Route calculation returned no usable distance");
      }

      setRouteDistanceM(calcResult.route.totalDistanceM);
      setRouteLegs(calcResult.legs);
      setRouteStale(false);

      // Verify the server has a valid persisted distance before completing.
      const tripCheck = await api.get<{ trip: Trip }>(`/api/v1/trips/${tripId}`);
      if (tripCheck.trip.routeStale) {
        throw new Error("Route is stale on the server — please recalculate");
      }
      const hasValidBasis =
        (tripCheck.trip.routeDistanceM && tripCheck.trip.routeDistanceM > 0) ||
        (tripCheck.trip.manualDistanceKm && tripCheck.trip.manualDistanceKm > 0) ||
        (tripCheck.trip.actualDistanceKm && tripCheck.trip.actualDistanceKm > 0);
      if (!hasValidBasis) {
        throw new Error(
          "Trip has no valid distance basis — calculate a route or provide a manual distance",
        );
      }

      await api.post(`/api/v1/trips/${tripId}/complete`, {});
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete trip");
    } finally {
      setBusy(false);
    }
  }, [saveDraft, savedTripId, finish]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      // Odometer pair present and valid → the accurate, one-step path.
      if (quickPlan.ok) {
        completeQuickTrip();
        return;
      }
      // No readings: the route (advanced) is the remaining distance basis.
      // Anything typed but invalid is reported instead of silently ignored.
      const odometersBlank = !startOdometerKm.trim() && !endOdometerKm.trim();
      if (advanced && odometersBlank) {
        completeViaRoute();
        return;
      }
      showPlanErrors(quickPlan.errors);
    },
    [
      quickPlan,
      completeQuickTrip,
      advanced,
      startOdometerKm,
      endOdometerKm,
      completeViaRoute,
      showPlanErrors,
    ],
  );

  const totalKm = routeDistanceM ? (routeDistanceM / 1000).toFixed(1) : null;
  const startOdometerValue = parseOdometerReading(startOdometerKm);

  return (
    <>
      {trigger ? (
        <span onClick={handleOpen}>{trigger}</span>
      ) : (
        <Button variant="primary" onClick={handleOpen}>
          Record Trip
        </Button>
      )}

      <Modal
        open={open}
        onClose={handleClose}
        title="Record trip"
        description="Two places and the odometer pair — the difference is the distance. Vehicle, date and start reading are prefilled."
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="text-body-xs text-muted">
              {distancePreview !== null && (
                <span className="text-ink font-medium">{distancePreview} km from the odometer</span>
              )}
              {distancePreview === null && totalKm && !routeStale && (
                <span className="text-ink font-medium">{totalKm} km estimated from the route</span>
              )}
              {routeStale && (
                <span className="text-warning font-medium">Route stale — recalculate</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              {advanced && (
                <Button
                  variant="secondary"
                  onClick={() => saveDraft(savedTripId)}
                  disabled={busy || calculating}
                  isLoading={busy && !calculating}
                >
                  Save draft
                </Button>
              )}
              <Button
                variant="accent"
                type="submit"
                form="record-trip-form"
                disabled={busy || calculating}
                isLoading={busy}
              >
                Complete trip
              </Button>
            </div>
          </div>
        }
      >
        <form id="record-trip-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="border-error/30 bg-error/10 text-error text-body-xs rounded-md border p-3">
              {error}
            </div>
          )}

          {/* Who / when */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle" required htmlFor="trip-vehicle" error={fieldErrors.vehicleId}>
              <Select
                id="trip-vehicle"
                value={vehicleId}
                onChange={(e) => changeVehicle(e.target.value)}
                required
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required htmlFor="trip-date" error={fieldErrors.tripDate}>
              <Input
                id="trip-date"
                type="date"
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                required
              />
            </Field>
          </div>

          {/* Where — two names, no coordinates needed for the fast path */}
          {!advanced && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="From" required htmlFor="trip-origin" error={fieldErrors.origin}>
                <Input
                  id="trip-origin"
                  value={origin?.label ?? ""}
                  onChange={(e) => setStopLabel("ORIGIN", e.target.value)}
                  placeholder="e.g. Kotoka Airport"
                  autoComplete="off"
                />
              </Field>
              <Field label="To" required htmlFor="trip-destination" error={fieldErrors.destination}>
                <Input
                  id="trip-destination"
                  value={destination?.label ?? ""}
                  onChange={(e) => setStopLabel("DESTINATION", e.target.value)}
                  placeholder="e.g. Cape Coast"
                  autoComplete="off"
                />
              </Field>
            </div>
          )}

          {/* Distance evidence */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Start odometer (km)"
              htmlFor="trip-start-odometer"
              hint={
                startOdometerTouched
                  ? undefined
                  : startOdometerValue !== null
                    ? "Prefilled from the vehicle's last recorded reading"
                    : "Enter the reading before the trip"
              }
              error={fieldErrors.odometers}
            >
              <Input
                id="trip-start-odometer"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={startOdometerKm}
                onChange={(e) => {
                  setStartOdometerTouched(true);
                  setStartOdometerKm(e.target.value);
                }}
              />
            </Field>
            <Field
              label="End odometer (km)"
              htmlFor="trip-end-odometer"
              hint={
                distancePreview !== null
                  ? `${distancePreview} km covered`
                  : "The reading after the trip"
              }
              error={fieldErrors.odometers}
            >
              <Input
                id="trip-end-odometer"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={endOdometerKm}
                onChange={(e) => setEndOdometerKm(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Purpose" required htmlFor="trip-purpose" error={fieldErrors.purpose}>
              <Select
                id="trip-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
              >
                {TRIP_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="text-body-xs text-link pb-2 font-medium hover:underline"
                aria-expanded={advanced}
              >
                {advanced ? "Hide route and details" : "Add stops, route and booking reference"}
              </button>
            </div>
          </div>

          {advanced && (
            <div className="border-hairline flex flex-col gap-4 border-t pt-4">
              <TripStopBuilder
                stops={stops}
                onStopsChange={handleStopsChange}
                routeLegs={routeLegs}
                routeStale={routeStale}
                onCalculateRoute={calculateRoute}
                calculating={calculating}
              />

              {calcError && <p className="text-body-xs text-error">{calcError}</p>}

              {routeDistanceM !== null && routeLegs.length > 0 && (
                <div className="flex flex-col gap-3">
                  <RouteMapPreview
                    stops={stops}
                    legs={routeLegs}
                    totalDistanceKm={routeDistanceM / 1000}
                    totalDurationS={routeDurationS}
                    provider={routeProvider}
                    routeGeometry={routeGeometry}
                  />
                  <RouteSummary
                    stops={stops}
                    legs={routeLegs}
                    totalDistanceM={routeDistanceM}
                    totalDurationS={routeDurationS}
                    provider={routeProvider}
                    calculatedAt={routeCalculatedAt}
                    stale={routeStale}
                    approximate={routeApproximate}
                  />
                </div>
              )}

              <Field
                label="Booking / Tour reference"
                hint="Optional OTA booking, tour or transfer reference"
                htmlFor="trip-ref"
              >
                <Input
                  id="trip-ref"
                  value={externalReference}
                  onChange={(e) => setExternalReference(e.target.value)}
                  placeholder="e.g. BK-2026-0042"
                />
              </Field>

              <Field label="Notes" hint="Optional notes about the journey" htmlFor="trip-notes">
                <Textarea
                  id="trip-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any relevant details about the trip…"
                  rows={2}
                />
              </Field>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
