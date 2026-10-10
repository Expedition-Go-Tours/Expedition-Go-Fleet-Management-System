import Link from "next/link";

import { CreateForm } from "@/components/actions/CreateForm";
import { Container } from "@/components/layout/Container";
import { Card } from "@/components/ui/Card";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requireAuthContext } from "@/lib/auth/guards";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/permissions";
import { VEHICLE_TYPES } from "@/lib/domain/vehicle";
import { formatKm } from "@/lib/format";
import { listVehicles } from "@/lib/repos/vehicles";

export const metadata = { title: "Vehicles" };

export default async function VehiclesPage() {
  const context = await requireAuthContext();
  const canCreate = rolesHavePermission(context.user.roles, PERMISSIONS.VEHICLE_CREATE);
  const vehicles = await listVehicles();

  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-2">
        <Eyebrow>Fleet</Eyebrow>
        <DisplayTitle size="md">Vehicles</DisplayTitle>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`${vehicles.length} vehicle(s)`}>
            {vehicles.length === 0 ? (
              <p className="text-body-xs text-muted px-5 py-8">No vehicles registered yet.</p>
            ) : (
              <ul className="divide-hairline divide-y">
                {vehicles.map((vehicle) => (
                  <li key={vehicle.id}>
                    <Link
                      href={`/vehicles/${vehicle.id}`}
                      className="hover:bg-surface flex items-center justify-between gap-4 px-5 py-4 transition-colors"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="font-heading text-heading-sm font-semibold">
                          {vehicle.regNumber}
                        </span>
                        <span className="text-body-xs text-muted">
                          {vehicle.make} {vehicle.model} · {vehicle.year} ·{" "}
                          {formatKm(vehicle.odometerKm)}
                        </span>
                      </div>
                      <StatusBadge status={vehicle.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {canCreate && (
          <Card title="Register vehicle">
            <div className="p-5">
              <CreateForm
                endpoint="/api/v1/vehicles"
                submitLabel="Register"
                fields={[
                  {
                    name: "regNumber",
                    label: "Registration no.",
                    required: true,
                    placeholder: "GR-1234-24",
                  },
                  { name: "make", label: "Make", required: true, placeholder: "Toyota" },
                  { name: "model", label: "Model", required: true, placeholder: "Hiace" },
                  {
                    name: "year",
                    label: "Year",
                    type: "number",
                    required: true,
                    defaultValue: "2024",
                  },
                  {
                    name: "type",
                    label: "Type",
                    type: "select",
                    required: true,
                    options: VEHICLE_TYPES.map((t) => ({ value: t, label: t })),
                  },
                  { name: "mileage", label: "Odometer (km)", type: "number", defaultValue: "0" },
                ]}
              />
            </div>
          </Card>
        )}
      </div>
    </Container>
  );
}
