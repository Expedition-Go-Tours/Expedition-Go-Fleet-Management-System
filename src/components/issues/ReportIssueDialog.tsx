"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import {
  buildIssueIntakePayload,
  ISSUE_CATEGORIES,
  REPORT_SEVERITIES,
  type IssueIntakeValues,
} from "@/lib/domain/report";

/**
 * The single issue intake, shared by the driver workspace, the issues page and
 * any future "report a problem" action — so the same fault is captured the
 * same way whichever door it comes through.
 *
 * Short by default (vehicle, title, description, "can it still be driven?").
 * The one safety decision a reporter makes is whether the vehicle may keep
 * driving; an undrivable vehicle is reported CRITICAL + immobilized and the
 * server applies the safety hold, which no client can bypass or undo.
 * Severity and category stay behind "More detail" for the rarer cases.
 */
export function ReportIssueDialog({
  vehicles,
  defaultVehicleId,
  variant = "outline",
}: {
  vehicles: { id: string; label: string }[];
  defaultVehicleId?: string;
  variant?: "outline" | "primary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drivable, setDrivable] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const clientTokenRef = useRef<string>("");

  function openDialog() {
    clientTokenRef.current = crypto.randomUUID();
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = buildIssueIntakePayload(readValues(form, drivable));
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    try {
      await api.post("/api/v1/reports", {
        ...result.payload,
        clientToken: clientTokenRef.current,
      });
      setOpen(false);
      (event.target as HTMLFormElement).reset();
      setDrivable(true);
      setShowDetail(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={openDialog} disabled={vehicles.length === 0}>
        <AlertTriangle aria-hidden="true" className="h-4 w-4" />
        Report a problem
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report a vehicle problem"
        description="Reported defects appear in the repair queue right away — you do not need to do anything else."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" form="issue-intake-form" isLoading={busy}>
              Submit report
            </Button>
          </>
        }
      >
        <form id="issue-intake-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3"
            >
              {error}
            </p>
          )}

          <Field label="Vehicle" required htmlFor="ii-vehicle">
            <Select id="ii-vehicle" name="vehicleId" defaultValue={defaultVehicleId ?? ""} required>
              <option value="" disabled>
                Choose a vehicle
              </option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="What's wrong?" required htmlFor="ii-title">
            <Input
              id="ii-title"
              name="title"
              required
              placeholder="e.g. Brake noise when stopping"
            />
          </Field>

          <Field label="Describe the problem" required htmlFor="ii-description">
            <Textarea
              id="ii-description"
              name="description"
              rows={3}
              required
              placeholder="What you noticed, when, and under what conditions."
            />
          </Field>

          <div className="flex flex-col gap-2">
            <label className="hover:bg-subtle border-hairline flex cursor-pointer items-center gap-2 rounded-md border p-2.5">
              <input
                type="checkbox"
                name="drivable"
                checked={drivable}
                onChange={(event) => setDrivable(event.target.checked)}
                className="accent-orange h-4 w-4"
              />
              <span className="text-data text-ink">The vehicle can still be driven</span>
            </label>
            {!drivable && (
              <p className="text-body-xs text-error">
                This places the vehicle on safety hold immediately — it will not be assignable
                until the repair is completed and it is confirmed back in service.
              </p>
            )}
          </div>

          {!drivable ? (
            <p className="text-body-xs text-muted">
              Reported as critical — severity is set automatically for an undrivable vehicle.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowDetail((show) => !show)}
                className="text-body-xs text-muted hover:text-ink self-start underline-offset-2 hover:underline"
              >
                {showDetail ? "Hide detail" : "More detail (optional)"}
              </button>
              {showDetail && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Category" htmlFor="ii-category">
                    <Select id="ii-category" name="category" defaultValue="">
                      <option value="">Not sure</option>
                      {ISSUE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category.replace(/_/g, " ")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Severity" htmlFor="ii-severity">
                    <Select id="ii-severity" name="severity" defaultValue="MEDIUM">
                      {REPORT_SEVERITIES.filter((severity) => severity !== "CRITICAL").map(
                        (severity) => (
                          <option key={severity} value={severity}>
                            {severity}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                </div>
              )}
            </>
          )}
        </form>
      </Modal>
    </>
  );
}

function readValues(form: FormData, drivable: boolean): IssueIntakeValues {
  return {
    vehicleId: String(form.get("vehicleId") ?? ""),
    title: String(form.get("title") ?? ""),
    description: String(form.get("description") ?? ""),
    drivable,
    severity: String(form.get("severity") ?? "MEDIUM"),
    category: String(form.get("category") ?? ""),
  };
}
