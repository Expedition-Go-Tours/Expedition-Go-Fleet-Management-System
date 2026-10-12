import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Gauge,
  MapPin,
  Navigation,
  Route,
} from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RouteMapPreview } from "@/components/trips/RouteMapPreview";
import { RouteSummary } from "@/components/trips/RouteSummary";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, permissionsForRoles } from "@/lib/auth/permissions";
import {
  getTripDistanceMetres,
  type RouteLeg,
} from "@/lib/domain/trip";
import type { GeoJsonLineString } from "@/lib/routing/provider";
import { formatDate, humanizeEnum } from "@/lib/format";
import { getTripById } from "@/lib/repos/trips";
import { getVehicleById } from "@/lib/repos/vehicles";
import { getUserById } from "@/lib/repos/users";

export const metadata = { title: "Trip detail" };

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requirePagePermission(PERMISSIONS.TRIP_READ);
  const { id } = await params;

  const trip = await getTripById(id);
  if (!trip) notFound();

  const permissions = [...permissionsForRoles(context.user.roles)];
  const canReadAll = permissions.includes(PERMISSIONS.TRIP_READ_ALL);

  // Scope check: non-privileged users can only view their own trips.
  if (!canReadAll && trip.driverUserId !== context.user.id) {
    notFound();
  }

  const [vehicle, driver, recorder] = await Promise.all([
    getVehicleById(trip.vehicleId).catch(() => null),
    getUserById(trip.driverUserId).catch(() => null),
    getUserById(trip.recordedByUserId).catch(() => null),
  ]);

  const distanceM = getTripDistanceMetres(trip);
  const distanceKm = distanceM !== null ? (distanceM / 1000).toFixed(1) : null;

  const routeGeometry: GeoJsonLineString | null = null; // Not stored on trip
  const legList: RouteLeg[] = trip.routeLegs;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${trip.origin.label} → ${trip.destination.label}`}
        description={
          trip.externalReference
            ? `${humanizeEnum(trip.purpose)} · ${trip.externalReference}`
            : humanizeEnum(trip.purpose)
        }
        crumbs={[
          { label: "Overview", href: "/" },
          { label: "Trips", href: "/trips" },
          { label: `${trip.origin.label} → ${trip.destination.label}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              className="text-body-xs text-link hover:underline"
            >
              <ArrowLeft className="mr-1 inline h-3 w-3" /> Back to trips
            </Link>
          </div>
        }
      />

      {/* Summary strip */}
      <Card>
        <div className="flex flex-wrap items-center gap-6 px-5 py-4">
          <div className="flex items-center gap-2">
            <Route className="text-muted h-4 w-4" />
            <div>
              <p className="text-data-xs text-muted">Distance</p>
              <p className="text-body-sm text-ink font-semibold">
                {distanceKm ?? "—"} km
                <span className="text-body-xs text-muted ml-1">
                  ({trip.distanceBasis === "ACTUAL_ODOMETER"
                    ? "actual"
                    : trip.distanceBasis === "MANUAL_OVERRIDE"
                      ? "manual"
                      : "estimated"}
                  )
                </span>
              </p>
            </div>
          </div>

          {trip.routeDurationS != null && (
            <div className="flex items-center gap-2">
              <Clock className="text-muted h-4 w-4" />
              <div>
                <p className="text-data-xs text-muted">Duration</p>
                <p className="text-body-sm text-ink font-semibold">
                  {formatDuration(trip.routeDurationS)}
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Gauge className="text-muted h-4 w-4" />
            <div>
              <p className="text-data-xs text-muted">Odometer</p>
              <p className="text-body-sm text-ink font-semibold">
                {trip.startOdometerKm != null && trip.endOdometerKm != null
                  ? `${trip.startOdometerKm.toLocaleString()} → ${trip.endOdometerKm.toLocaleString()} km`
                  : "Not recorded"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Navigation className="text-muted h-4 w-4" />
            <div>
              <p className="text-data-xs text-muted">Status</p>
              <StatusBadge status={trip.status} />
            </div>
          </div>
        </div>
      </Card>

      {/* Map + route */}
      {(trip.stops.length >= 2) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-semibold">Route</h2>
            <RouteMapPreview
              stops={trip.stops}
              legs={legList}
              totalDistanceKm={trip.routeDistanceKm ?? null}
              totalDurationS={trip.routeDurationS}
              provider={trip.routingProvider}
              routeGeometry={routeGeometry}
            />
          </div>
          <div>
            <h2 className="mb-3 text-lg font-semibold">Stops &amp; legs</h2>
            <RouteSummary
              stops={trip.stops}
              legs={legList}
              totalDistanceM={trip.routeDistanceM}
              totalDurationS={trip.routeDurationS}
              provider={trip.routingProvider}
              calculatedAt={trip.routeCalculatedAt}
              stale={trip.routeStale}
            />
          </div>
        </div>
      )}

      {/* Metadata */}
      <Card title="Trip metadata">
        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
          <MetaRow label="Trip date" value={trip.tripDate} />
          <MetaRow label="Purpose" value={humanizeEnum(trip.purpose)} />
          {trip.externalReference && (
            <MetaRow label="Booking / Tour reference" value={trip.externalReference} />
          )}
          <MetaRow
            label="Vehicle"
            value={
              vehicle ? (
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="text-link hover:underline"
                >
                  {vehicle.regNumber} — {vehicle.make} {vehicle.model}
                </Link>
              ) : (
                trip.vehicleId
              )
            }
          />
          <MetaRow
            label="Driver"
            value={driver ? driver.name : trip.driverUserId}
          />
          {trip.recordedByUserId !== trip.driverUserId && (
            <MetaRow
              label="Recorded by"
              value={recorder ? recorder.name : trip.recordedByUserId}
            />
          )}
          <MetaRow label="Route provider" value={trip.routingProvider ?? "—"} />
          <MetaRow
            label="Route calculated"
            value={trip.routeCalculatedAt ? formatDate(trip.routeCalculatedAt) : "—"}
          />
          <MetaRow
            label="Actual distance"
            value={
              trip.actualDistanceKm != null
                ? `${trip.actualDistanceKm.toLocaleString()} km`
                : "—"
            }
          />
          <MetaRow
            label="Manual distance"
            value={
              trip.manualDistanceKm != null
                ? `${trip.manualDistanceKm.toLocaleString()} km${trip.manualDistanceReason ? ` (${trip.manualDistanceReason})` : ""}`
                : "—"
            }
          />
          <MetaRow label="Created" value={formatDate(trip.createdAt)} />
          <MetaRow label="Last updated" value={formatDate(trip.updatedAt)} />
          {trip.notes && (
            <div className="sm:col-span-2">
              <MetaRow label="Notes" value={trip.notes} />
            </div>
          )}
        </div>
      </Card>

      {/* Per-stop details */}
      <Card title={`Stop details (${trip.stops.length} stops)`}>
        <ul className="divide-hairline divide-y">
          {trip.stops.map((stop, i) => (
            <li key={stop.id} className="flex items-start gap-3 px-5 py-3">
              <div className="flex flex-col items-center gap-0.5 pt-0.5">
                <MapPin
                  className={
                    i === 0
                      ? "text-accent h-4 w-4"
                      : i === trip.stops.length - 1
                        ? "text-success h-4 w-4"
                        : "text-muted h-4 w-4"
                  }
                />
                {i < trip.stops.length - 1 && (
                  <div className="border-hairline h-6 w-px border-l" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-ink font-medium">
                  {stop.label || `Stop ${i + 1}`}
                  <span className="text-body-xs text-muted ml-2">
                    {stop.type === "ORIGIN"
                      ? "Origin"
                      : stop.type === "DESTINATION"
                        ? "Destination"
                        : `Stop ${stop.sequence}`}
                  </span>
                </p>
                {stop.address && (
                  <p className="text-body-xs text-muted">{stop.address}</p>
                )}
                {stop.latitude != null && stop.longitude != null && (
                  <p className="text-data-xs text-muted">
                    {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                  </p>
                )}
                {stop.purpose && (
                  <p className="text-data-xs text-muted">Purpose: {stop.purpose}</p>
                )}
                {stop.notes && (
                  <p className="text-data-xs text-muted">{stop.notes}</p>
                )}
              </div>
              {trip.routeLegs[i] && (
                <div className="text-right">
                  <p className="text-body-xs text-ink">
                    {(trip.routeLegs[i].distanceM / 1000).toFixed(1)} km
                  </p>
                  {trip.routeLegs[i].durationS != null && (
                    <p className="text-data-xs text-muted">
                      {formatDuration(trip.routeLegs[i].durationS!)}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-data-xs text-muted">{label}</p>
      <p className="text-body-sm text-ink">{value}</p>
    </div>
  );
}
