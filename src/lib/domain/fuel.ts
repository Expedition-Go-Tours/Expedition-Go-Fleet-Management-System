import { PERMISSIONS } from "@/lib/auth/permissions";
import { parsePaidTo, toPesewas } from "@/lib/domain/expense";

/*
 * Fuel purchase records.
 *
 * A fuel entry is the operational record; its cost lives in the canonical
 * Expense (linked by expenseId) so reports count each pesewa exactly once.
 * The odometer and litres are optional: the person paying for fuel may only
 * know the amount. A purchase without them is still a real cost; it is simply
 * not measured. Efficiency is only computed from full-tank-to-full-tank
 * sequences where both volume and readings exist — anything less reports
 * "unknown" rather than an unreliable figure.
 */

export const FUEL_TYPES_SUPPORTED = ["PETROL", "DIESEL", "HYBRID", "OTHER"] as const;

export interface FuelEntry {
  id: string;
  vehicleId: string;
  /** Transaction/purchase date. */
  transactedOn: string;
  /** Odometer at the fill-up; absent when no reading was available. */
  odometerKm?: number;
  odometerReadingId?: string;
  fuelType: string;
  litres?: number;
  /** Pesewas per litre, when known. */
  unitPriceMinor?: number;
  /** Total cost in pesewas — mirrored into the canonical Expense. */
  totalMinor: number;
  currency: string;
  station?: string;
  /** Person who received the payment, when someone other than the station. */
  paidTo?: string;
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
  if (first.odometerKm === undefined || second.odometerKm === undefined) {
    return {
      kmPerLitre: null,
      reason: "Both fill-ups need an odometer reading for a defensible figure",
    };
  }
  if (first.litres === undefined || second.litres === undefined) {
    return {
      kmPerLitre: null,
      reason: "Both fill-ups need a recorded volume for a defensible figure",
    };
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

/**
 * Normalise an odometer value from a form or request body. Absence is a
 * deliberate state — never coerce it to 0, which would fabricate a reading
 * and corrupt both the ledger and the efficiency chain.
 */
export function parseOdometerKm(
  value: unknown,
): { ok: true; odometerKm?: number } | { ok: false; message: string } {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: true };
  }
  const km =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isSafeInteger(km) || km < 0) {
    return { ok: false, message: "odometerKm must be a non-negative integer when provided" };
  }
  return { ok: true, odometerKm: km };
}

/** The fields needed to place a fill-up in a vehicle's consumption chain. */
export interface ConsumptionEntry {
  id: string;
  vehicleId: string;
  transactedOn: string;
  createdAt?: Date;
  odometerKm?: number;
  fullTank: boolean;
  litres?: number;
}

/** Purchase order — date, then creation time, then id. Never odometer order. */
function fillOrder(a: ConsumptionEntry, b: ConsumptionEntry): number {
  const byDate = a.transactedOn.localeCompare(b.transactedOn);
  if (byDate !== 0) return byDate;
  const byCreated = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

/**
 * km/l keyed by the entry that closes each measured segment.
 *
 * Only ADJACENT fill-ups are paired, so any intervening entry — partial or
 * without an odometer — breaks the chain. Skipping a reading-less entry would
 * attribute its litres to a later segment and overstate efficiency.
 */
export function consumptionByEntry(entries: readonly ConsumptionEntry[]): Map<string, number> {
  const byVehicle = new Map<string, ConsumptionEntry[]>();
  for (const entry of entries) {
    const list = byVehicle.get(entry.vehicleId) ?? [];
    list.push(entry);
    byVehicle.set(entry.vehicleId, list);
  }

  const measured = new Map<string, number>();
  for (const list of byVehicle.values()) {
    const ordered = list.slice().sort(fillOrder);
    for (let i = 1; i < ordered.length; i++) {
      const first = ordered[i - 1]!;
      const second = ordered[i]!;
      const result = computeConsumption(first, second);
      if (result.kmPerLitre !== null) measured.set(second.id, result.kmPerLitre);
    }
  }
  return measured;
}

/** The most recent measured segment across the supplied entries. */
export function latestConsumption(
  entries: readonly ConsumptionEntry[],
  vehicleId?: string,
): { kmPerLitre: number | null; reason?: string } {
  const relevant = vehicleId ? entries.filter((entry) => entry.vehicleId === vehicleId) : entries;
  const measured = consumptionByEntry(relevant);
  if (measured.size === 0) {
    return {
      kmPerLitre: null,
      reason: "Not enough consecutive full-tank fill-ups with odometer readings",
    };
  }
  const latest = relevant
    .slice()
    .sort(fillOrder)
    .reverse()
    .find((entry) => measured.has(entry.id));
  return { kmPerLitre: latest ? (measured.get(latest.id) ?? null) : null };
}

/** Guard for fuel entry amounts and (optionally) volumes. */
export function isValidFuelEntry(input: {
  litres?: unknown;
  totalMinor: unknown;
}): { ok: true } | { ok: false; message: string } {
  if (
    input.litres !== undefined &&
    (typeof input.litres !== "number" || !Number.isFinite(input.litres) || input.litres <= 0)
  ) {
    return { ok: false, message: "litres must be a positive number when provided" };
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
  /** Total amount paid on the receipt, in major units. */
  amount: string;
  fuelType: string;
  station: string;
  /** Person who received the payment (representative / driver). */
  paidTo: string;
  fullTank: boolean;
}

/** The validated POST /api/v1/fuel body. */
export interface FuelCreatePayload {
  vehicleId: string;
  transactedOn: string;
  /** Present only when the operator actually has a reading. */
  odometerKm?: number;
  /** Cost in pesewas — authoritative: the API stores exactly this. */
  totalMinor: number;
  fuelType: string;
  station?: string;
  paidTo?: string;
  fullTank: boolean;
}

/**
 * Editable fields on a recorded purchase. The vehicle and odometer are not
 * here: the vehicle is fixed, and the odometer lives in the append-only ledger
 * (a wrong reading is corrected there, never by rewriting the purchase).
 */
export interface FuelUpdateFormValues {
  transactedOn: string;
  amount: string;
  fuelType: string;
  station: string;
  paidTo: string;
  fullTank: boolean;
}

/** The validated PATCH /api/v1/fuel/[id] body. */
export interface FuelUpdatePayload {
  transactedOn: string;
  totalMinor: number;
  fuelType: string;
  station?: string;
  paidTo?: string;
  fullTank: boolean;
}

/**
 * Validate the fields that can be corrected. Shared by the create payload
 * (after the vehicle/odometer checks) and the edit dialog so both reject the
 * same mistakes with the same wording.
 */
function buildFuelAmountFields(
  values: FuelUpdateFormValues,
): { ok: true; payload: FuelUpdatePayload } | { ok: false; message: string } {
  const transactedOn = values.transactedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactedOn)) {
    return { ok: false, message: "transactedOn must be YYYY-MM-DD" };
  }

  const amountRaw = values.amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw)) {
    return { ok: false, message: "amount must be a positive amount" };
  }
  const totalMinor = toPesewas(amountRaw);
  if (totalMinor === null || totalMinor <= 0) {
    return { ok: false, message: "amount must be a positive amount" };
  }
  const amountCheck = isValidFuelEntry({ totalMinor });
  if (!amountCheck.ok) return amountCheck;

  const fuelType = values.fuelType.trim() || "PETROL";
  if (!FUEL_TYPES_SUPPORTED.some((type) => type === fuelType)) {
    return { ok: false, message: "Unsupported fuel type" };
  }

  const station = values.station.trim();
  const paidToResult = parsePaidTo(values.paidTo);
  if (!paidToResult.ok) return { ok: false, message: paidToResult.message };

  return {
    ok: true,
    payload: {
      transactedOn,
      totalMinor,
      fuelType,
      ...(station ? { station } : {}),
      ...(paidToResult.paidTo ? { paidTo: paidToResult.paidTo } : {}),
      fullTank: values.fullTank === true,
    },
  };
}

/** Form values for correcting a recorded purchase (no vehicle/odometer). */
export function buildFuelUpdatePayload(
  values: FuelUpdateFormValues,
): { ok: true; payload: FuelUpdatePayload } | { ok: false; message: string } {
  return buildFuelAmountFields(values);
}

/**
 * Form values → the fuel-entry request body, or the first message to show the
 * operator. The server re-validates everything; this exists so the dialog can
 * fail fast with the same rules and show that the amount is stored exactly.
 */
export function buildFuelCreatePayload(
  values: FuelPurchaseFormValues,
): { ok: true; payload: FuelCreatePayload } | { ok: false; message: string } {
  const vehicleId = values.vehicleId.trim();
  if (!vehicleId) return { ok: false, message: "Choose the vehicle that was filled up" };

  const odometer = parseOdometerKm(values.odometerKm);
  if (!odometer.ok) return odometer;

  const fields = buildFuelAmountFields(values);
  if (!fields.ok) return fields;

  return {
    ok: true,
    payload: {
      vehicleId,
      ...(odometer.odometerKm !== undefined ? { odometerKm: odometer.odometerKm } : {}),
      ...fields.payload,
    },
  };
}

export const FUEL_CREATE_PERMISSION = PERMISSIONS.FUEL_CREATE;
export const FUEL_READ_PERMISSION = PERMISSIONS.FUEL_READ;
