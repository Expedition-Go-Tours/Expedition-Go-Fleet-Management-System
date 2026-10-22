import { isValidAmountMinor } from "@/lib/domain/expense";

/*
 * The cost half of a completed service.
 *
 * A service record and its linked repair expense are two writes. The service
 * record is the durable fact — it is written first, together with the cost the
 * caller asked to record. Creating the expense is then reconciled by THIS
 * module, which is safe to run again:
 *
 *  - the expense document id is derived from the service record, so a retry or
 *    two concurrent requests converge on exactly one monetary record;
 *  - linking is additive (the service record's `expenseIds`), so repeating it
 *    cannot create a second link;
 *  - an already-linked expense is reused instead of creating another one.
 *
 * Failures are surfaced, never swallowed: the route reports a retryable
 * "cost not recorded" outcome instead of claiming a fully successful
 * completion when the money is missing.
 */

export class ServiceCostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ServiceCostError";
    this.code = code;
  }
}

/**
 * Deterministic expense id for a service record. One service record can have
 * at most one repair expense, including under concurrent retries.
 */
export function serviceExpenseId(serviceRecordId: string): string {
  const id = serviceRecordId.trim();
  if (!id || id.includes("/")) {
    throw new ServiceCostError("INVALID_SERVICE_RECORD", "A valid service record id is required");
  }
  return `svc_${id}`;
}

export interface ServiceExpenseRecord {
  id: string;
  vehicleId: string;
  workOrderId?: string;
  serviceRecordId: string;
  category: "MAINTENANCE";
  amountMinor: number;
  currency: string;
  description: string;
  supplierName?: string;
  providerId?: string;
  incurredOn: Date;
  createdBy: string;
}

export interface ServiceCostInput {
  serviceRecordId: string;
  vehicleId: string;
  workOrderId?: string;
  amountMinor: number;
  currency: string;
  description: string;
  supplierName?: string;
  providerId?: string;
  incurredOn: Date;
  createdBy: string;
  /** An expense already referenced by the service record — reuse it. */
  existingExpenseId?: string;
}

/** Validated, deterministic expense payload (never written here). */
export function buildServiceExpenseRecord(input: ServiceCostInput): ServiceExpenseRecord {
  if (!isValidAmountMinor(input.amountMinor)) {
    throw new ServiceCostError("INVALID_AMOUNT", "Repair cost must be a positive amount");
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ServiceCostError("INVALID_CURRENCY", "Currency must be a three-letter code");
  }
  const vehicleId = input.vehicleId.trim();
  if (!vehicleId) {
    throw new ServiceCostError("INVALID_VEHICLE", "vehicleId is required");
  }
  const description = input.description.trim();
  if (!description) {
    throw new ServiceCostError("INVALID_DESCRIPTION", "A cost description is required");
  }

  return {
    id: serviceExpenseId(input.serviceRecordId),
    vehicleId,
    workOrderId: input.workOrderId,
    serviceRecordId: input.serviceRecordId,
    category: "MAINTENANCE",
    amountMinor: input.amountMinor,
    currency,
    description: description.slice(0, 200),
    supplierName: input.supplierName?.trim() || undefined,
    providerId: input.providerId?.trim() || undefined,
    incurredOn: input.incurredOn,
    createdBy: input.createdBy,
  };
}

/** Small port surface so the recovery rules can be tested without Firestore. */
export interface ServiceCostPorts {
  /** Create the expense once; an existing document with the same id is reused. */
  ensureExpense(record: ServiceExpenseRecord): Promise<{ expenseId: string; created: boolean }>;
  /** Additive link: ServiceRecord.expenseIds includes the expense id. */
  linkServiceRecord(serviceRecordId: string, expenseId: string): Promise<void>;
}

/**
 * Ensure the service record has exactly one linked repair expense.
 * Safe to call for every completion attempt, including duplicates/retries.
 * Throws (rather than pretending success) if the expense or link cannot be
 * written, so the route can report a recoverable partial failure.
 */
export async function recordServiceCost(
  ports: ServiceCostPorts,
  input: ServiceCostInput,
): Promise<{ expenseId: string; created: boolean }> {
  if (input.existingExpenseId) {
    await ports.linkServiceRecord(input.serviceRecordId, input.existingExpenseId);
    return { expenseId: input.existingExpenseId, created: false };
  }

  const record = buildServiceExpenseRecord(input);
  const ensured = await ports.ensureExpense(record);
  if (!ensured.expenseId) {
    throw new ServiceCostError("COST_NOT_RECORDED", "The repair expense was not created");
  }
  await ports.linkServiceRecord(input.serviceRecordId, ensured.expenseId);
  return ensured;
}
