import { PERMISSIONS } from "@/lib/auth/permissions";
import { toPesewas } from "@/lib/domain/expense";

/*
 * Fuel purchase records.
 *
 * A fuel entry is the operational record; its cost lives in the canonical
 * Expense (linked by expenseId) so reports count each pesewa exactly once.
 * Efficiency is only computed from full-tank-to-full-tank sequences —
 * anything less reports "unknown" rather than an unreliable figure.
 */

export const FUEL_TYPES_SUPPORTED = ["PETROL", "DIESEL", "HYBRID", "OTHER"] as const;

export interface FuelEntry {
  id: string;
  vehicleId: string;
  /** Transaction/purchase date. */
  transactedOn: string;
  odometerKm: number;
  odometerReadingId?: string;
  fuelType: string;
  litres: number;
  /** Pesewas per litre, when known. */
  unitPriceMinor?: number;
  /** Total cost in pesewas — mirrored into the canonical Expense. */
  totalMinor: number;
  currency: string;
  station?: string;
  receiptKey?: string;
  /** Filled to the tank nozzle — required for consumption calculation. */
  fullTank: boolean;
  /** Canonical expense for this purchase (counted once in reports). */
  expenseId?: string;
  recordedBy: string;
  createdAt: Date;
}

/**
 * Fuel consumption between two consecutive full-tank fill-ups:
 * km/l = (second odometer − first odometer) ÷ litres to refill.
 * Returns null when the sequence is not defensible.
 */
export function computeConsumption(
  first: Pick<FuelEntry, "odometerKm" | "fullTank" | "litres">,
  second: Pick<FuelEntry, "odometerKm" | "fullTank" | "litres">,
): { kmPerLitre: number | null; reason?: string } {
  if (!first.fullTank || !second.fullTank) {
    return { kmPerLitre: null, reason: "Both fill-ups must be full-tank for a defensible figure" };
  }
  const distance = second.odometerKm - first.odometerKm;
  if (distance <= 0) {
    return { kmPerLitre: null, reason: "Odometer readings are missing or contradictory" };
  }
  if (second.litres <= 0) {
    return { kmPerLitre: null, reason: "Refill volume is missing" };
  }
  return { kmPerLitre: Math.round((distance / second.litres) * 100) / 100 };
}

/** Guard for fuel entry amounts and volumes. */
export function isValidFuelEntry(input: {
  litres: unknown;
  totalMinor: unknown;
}): { ok: true } | { ok: false; message: string } {
  if (typeof input.litres !== "number" || !Number.isFinite(input.litres) || input.litres <= 0) {
    return { ok: false, message: "litres must be a positive number" };
  }
  if (
    typeof input.totalMinor !== "number" ||
    !Number.isSafeInteger(input.totalMinor) ||
    input.totalMinor <= 0
  ) {
    return { ok: false, message: "totalMinor must be a positive integer (pesewas)" };
  }
  return { ok: true };
}

/** Raw form values for a fuel purchase, as typed by the operator. */
export interface FuelPurchaseFormValues {
  vehicleId: string;
  transactedOn: string;
  odometerKm: string;
  litres: string;
  unitPrice: string;
  fuelType: string;
  station: string;
  fullTank: boolean;
}

/** The validated POST /api/v1/fuel body. */
export interface FuelCreatePayload {
  vehicleId: string;
  transactedOn: string;
  odometerKm: number;
  litres: number;
  /** Unit price in major units (what the operator typed). */
  unitPrice: number;
  /** Cost in pesewas — authoritative: the API stores exactly this. */
  totalMinor: number;
  fuelType: string;
  station?: string;
  fullTank: boolean;
}

/**
 * Form values → the fuel-entry request body, or the first message to show the
 * operator. The server re-validates everything; this exists so the dialog can
 * fail fast with the same rules and display the exact total that will be
 * stored (unit price × litres, computed in integer pesewas).
 */
export function buildFuelCreatePayload(
  values: FuelPurchaseFormValues,
): { ok: true; payload: FuelCreatePayload } | { ok: false; message: string } {
  const vehicleId = values.vehicleId.trim();
  if (!vehicleId) return { ok: false, message: "Choose the vehicle that was filled up" };

  const transactedOn = values.transactedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactedOn)) {
    return { ok: false, message: "transactedOn must be YYYY-MM-DD" };
  }

  const odometerRaw = values.odometerKm.trim();
  if (!/^\d+$/.test(odometerRaw)) {
    return { ok: false, message: "odometerKm is required (non-negative integer)" };
  }

  const litres = Number(values.litres);
  const unitMinor = toPesewas(values.unitPrice);
  if (unitMinor === null || unitMinor <= 0) {
    return { ok: false, message: "unitPrice must be a positive amount" };
  }
  const totalMinor = Math.round(unitMinor * litres);
  const amountCheck = isValidFuelEntry({ litres, totalMinor });
  if (!amountCheck.ok) return amountCheck;

  const fuelType = values.fuelType.trim() || "PETROL";
  if (!FUEL_TYPES_SUPPORTED.some((type) => type === fuelType)) {
    return { ok: false, message: "Unsupported fuel type" };
  }

  const station = values.station.trim();
  return {
    ok: true,
    payload: {
      vehicleId,
      transactedOn,
      odometerKm: Number(odometerRaw),
      litres,
      unitPrice: unitMinor / 100,
      totalMinor,
      fuelType,
      ...(station ? { station } : {}),
      fullTank: values.fullTank === true,
    },
  };
}

export const FUEL_CREATE_PERMISSION = PERMISSIONS.FUEL_CREATE;
export const FUEL_READ_PERMISSION = PERMISSIONS.FUEL_READ;
