"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { RouteSummary } from "@/components/trips/RouteSummary";
import { TripStopBuilder } from "@/components/trips/TripStopBuilder";
import { api } from "@/lib/client/api";
import { TRIP_PURPOSES, type RouteLeg, type Trip, type TripStop } from "@/lib/domain/trip";

/*
 * Record Trip dialog: multi-stop route builder with distance calculation,
 * draft saving, and trip completion. Mobile-first, accessible, and designed
 * for the end-of-day retrospective entry workflow.
 */

interface RecordTripDialogProps {
  /** Vehicle options for the dropdown. */
  vehicles: { id: string; label: string }[];
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
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Form state
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? vehicles[0]?.id ?? "");
  const [tripDate, setTripDate] = useState(defaultDate);
  const [purpose, setPurpose] = useState<string>("OTHER");
  const [externalReference, setExternalReference] = useState("");
  const [notes, setNotes] = useState("");
  const [stops, setStops] = useState<TripStop[]>([]);
  const [routeLegs, setRouteLegs] = useState<RouteLeg[]>([]);
  const [routeDistanceM, setRouteDistanceM] = useState<number | null>(null);
  const [routeDurationS, setRouteDurationS] = useState<number | null>(null);
  const [routeProvider, setRouteProvider] = useState<string | null>(null);
  const [routeCalculatedAt, setRouteCalculatedAt] = useState<string | null>(null);
  const [routeStale, setRouteStale] = useState(false);
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

  const resetForm = useCallback(() => {
    setError(null);
    setCalcError(null);
    setVehicleId(defaultVehicleId ?? vehicles[0]?.id ?? "");
    setTripDate(defaultDate);
    setPurpose("OTHER");
    setExternalReference("");
    setNotes("");
    setStops([]);
    setRouteLegs([]);
    setRouteDistanceM(null);
    setRouteDurationS(null);
    setRouteProvider(null);
    setRouteCalculatedAt(null);
    setRouteStale(false);
    setSavedTripId(null);
    prevStopsRef.current = "";
  }, [defaultVehicleId, defaultDate, vehicles]);

  const handleOpen = useCallback(() => {
    resetForm();
    setOpen(true);
  }, [resetForm]);

  const handleClose = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  // Calculate route.
  const calculateRoute = useCallback(async () => {
    setCalculating(true);
    setCalcError(null);
    setError(null);

    const waypoints = stops
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({
        latitude: s.latitude!,
        longitude: s.longitude!,
        label: s.label || undefined,
      }));

    if (waypoints.length < 2) {
      setCalcError("Add coordinates to at least 2 stops to calculate a route.");
      setCalculating(false);
      return;
    }

    try {
      // If we have a saved trip, calculate and persist in one call.
      // Otherwise, calculate standalone.
      const endpoint = savedTripId
        ? "/api/v1/trips/calculate-route"
        : "/api/v1/trips/calculate-route";
      const body = savedTripId ? { tripId: savedTripId } : { waypoints };

      const result = await api.post<{
        route: {
          totalDistanceM: number;
          totalDurationS: number;
          legs: Array<{ distanceM: number; durationS: number }>;
          provider: string;
          calculatedAt: string;
        };
        legs: RouteLeg[];
      }>(endpoint, body);

      setRouteDistanceM(result.route.totalDistanceM);
      setRouteDurationS(result.route.totalDurationS);
      setRouteProvider(result.route.provider);
      setRouteCalculatedAt(result.route.calculatedAt);
      setRouteLegs(result.legs);
      setRouteStale(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Route calculation failed";
      setCalcError(msg);
    } finally {
      setCalculating(false);
    }
  }, [stops, savedTripId]);

  // Save as draft.
  const saveDraft = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const origin = stops.find((s) => s.type === "ORIGIN");
      const destination = stops.find((s) => s.type === "DESTINATION");
      if (!origin?.label || !destination?.label) {
        throw new Error("Origin and destination are required.");
      }

      const body = {
        vehicleId,
        driverUserId,
        assignmentId: assignmentId || undefined,
        tripDate,
        purpose,
        externalReference: externalReference || undefined,
        notes: notes || undefined,
        stops,
      };

      if (savedTripId) {
        await api.patch(`/api/v1/trips/${savedTripId}`, body);
      } else {
        const result = await api.post<{ trip: Trip }>("/api/v1/trips", body);
        setSavedTripId(result.trip.id);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
    } finally {
      setBusy(false);
    }
  }, [
    vehicleId,
    driverUserId,
    assignmentId,
    tripDate,
    purpose,
    externalReference,
    notes,
    stops,
    savedTripId,
    router,
  ]);

  // Complete the trip.
  const completeTrip = useCallback(async () => {
    if (!savedTripId) {
      // Save first, then complete.
      await saveDraft();
      if (!savedTripId) return; // save failed
    }

    setBusy(true);
    setError(null);
    try {
      // If route is stale, try to recalculate first.
      if (routeStale || routeDistanceM === null) {
        await calculateRoute();
      }

      await api.post(`/api/v1/trips/${savedTripId}/complete`, {});
      setOpen(false);
      resetForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete trip");
    } finally {
      setBusy(false);
    }
  }, [savedTripId, saveDraft, routeStale, routeDistanceM, calculateRoute, resetForm, router]);

  const totalKm = routeDistanceM ? (routeDistanceM / 1000).toFixed(1) : null;

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
        title="Record Trip"
        description="Enter your journey details. Route distance is calculated from the coordinates you provide."
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="text-body-xs text-muted">
              {totalKm && !routeStale && (
                <span className="text-ink font-medium">{totalKm} km estimated</span>
              )}
              {routeStale && (
                <span className="text-warning font-medium">Route stale — recalculate</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={saveDraft}
                disabled={busy}
                isLoading={busy && !calculating}
              >
                Save draft
              </Button>
              <Button
                variant="accent"
                onClick={completeTrip}
                disabled={busy || routeStale}
                isLoading={busy}
              >
                Complete trip
              </Button>
            </div>
          </div>
        }
      >
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            calculateRoute();
          }}
          className="flex flex-col gap-5"
        >
          {error && (
            <div className="border-error/30 bg-error/10 text-error text-body-xs rounded-md border p-3">
              {error}
            </div>
          )}

          {/* Vehicle + Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle" required htmlFor="trip-vehicle">
              <Select
                id="trip-vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                required
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Trip date" required htmlFor="trip-date">
              <Input
                id="trip-date"
                type="date"
                value={tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                required
              />
            </Field>
          </div>

          {/* Purpose + Reference */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Purpose" required htmlFor="trip-purpose">
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
          </div>

          {/* Stops */}
          <TripStopBuilder
            stops={stops}
            onStopsChange={handleStopsChange}
            routeLegs={routeLegs}
            routeStale={routeStale}
            onCalculateRoute={calculateRoute}
            calculating={calculating}
          />

          {calcError && <p className="text-body-xs text-error">{calcError}</p>}

          {/* Route summary */}
          {routeDistanceM !== null && routeLegs.length > 0 && (
            <RouteSummary
              stops={stops}
              legs={routeLegs}
              totalDistanceM={routeDistanceM}
              totalDurationS={routeDurationS}
              provider={routeProvider}
              calculatedAt={routeCalculatedAt}
              stale={routeStale}
            />
          )}

          {/* Notes */}
          <Field label="Notes" hint="Optional notes about the journey" htmlFor="trip-notes">
            <Textarea
              id="trip-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any relevant details about the trip…"
              rows={2}
            />
          </Field>

          {/* Hidden submit for Enter key in route calculation */}
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
      </Modal>
    </>
  );
}
