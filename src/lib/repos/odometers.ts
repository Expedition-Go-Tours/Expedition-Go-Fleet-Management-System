import type { DocumentData } from "firebase-admin/firestore";

import type { OdometerReading, OdometerSource, OdometerStatus } from "@/lib/domain/odometer";
import {
  deltaFromPrevious,
  detectHistoricalConflict,
  isLiveSource,
  validateCorrection,
  validateReading,
} from "@/lib/domain/odometer";
import { COLLECTIONS } from "@/lib/db/collections";
import { getAdminDb } from "@/lib/firebase/admin";
import { toDate } from "@/lib/repos/timestamps";

/*
 * Odometer ledger repository.
 *
 * Recording a reading and updating the vehicle projection happen in ONE
 * Firestore transaction — they can never disagree. Retries are safe: the
 * reading document id is derived from the client token, so a replayed request
 * finds the existing reading and returns it without a second write.
 */

export class OdometerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OdometerError";
    this.code = code;
  }
}

/** Strip undefined values — Firestore rejects them as document fields. */
function definedOnly(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

function readingsRef() {
  return getAdminDb().collection(COLLECTIONS.odometerReadings);
}

function toReading(id: string, data: DocumentData): OdometerReading {
  return {
    id,
    vehicleId: String(data.vehicleId ?? ""),
    km: Number(data.km ?? 0),
    effectiveAt: toDate(data.effectiveAt) ?? new Date(0),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    recordedByUserId: String(data.recordedByUserId ?? ""),
    source: (data.source ?? "MANUAL_ENTRY") as OdometerSource,
    assignmentId: data.assignmentId ? String(data.assignmentId) : undefined,
    inspectionId: data.inspectionId ? String(data.inspectionId) : undefined,
    serviceRecordId: data.serviceRecordId ? String(data.serviceRecordId) : undefined,
    fuelEntryId: data.fuelEntryId ? String(data.fuelEntryId) : undefined,
    issueId: data.issueId ? String(data.issueId) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    status: (data.status ?? "ACCEPTED") as OdometerStatus,
    deltaKm: typeof data.deltaKm === "number" ? data.deltaKm : undefined,
    correctedReadingId: data.correctedReadingId ? String(data.correctedReadingId) : undefined,
    correctedByUserId: data.correctedByUserId ? String(data.correctedByUserId) : undefined,
    correctionReason: data.correctionReason ? String(data.correctionReason) : undefined,
    supersedesReadingId: data.supersedesReadingId ? String(data.supersedesReadingId) : undefined,
    conflictNote: data.conflictNote ? String(data.conflictNote) : undefined,
    clientToken: data.clientToken ? String(data.clientToken) : undefined,
  };
}

export interface RecordReadingInput {
  vehicleId: string;
  km: number;
  source: OdometerSource;
  recordedByUserId: string;
  /** Physical time of the reading; defaults to now. */
  effectiveAt?: Date;
  assignmentId?: string;
  inspectionId?: string;
  serviceRecordId?: string;
  fuelEntryId?: string;
  issueId?: string;
  notes?: string;
  /** Idempotency token; a deterministic reading id is derived from it. */
  clientToken?: string;
  /**
   * Service-completion readings may be lower than the projection when a
   * correction superseded a higher entry; internal trusted sources only.
   */
  allowDecrease?: boolean;
}

export interface RecordReadingResult {
  reading: OdometerReading;
  /** True when this request replayed an existing reading (idempotent no-op). */
  duplicate: boolean;
  newProjectionKm: number;
}

/**
 * Record a reading and update the vehicle projection atomically.
 */
export async function recordReading(input: RecordReadingInput): Promise<RecordReadingResult> {
  const db = getAdminDb();
  const vehicleRef = db.collection(COLLECTIONS.vehicles).doc(input.vehicleId);

  const now = new Date();
  const effectiveAt = input.effectiveAt ?? now;
  const readingId = input.clientToken
    ? `${input.vehicleId}_${input.clientToken}`
    : readingsRef().doc().id;
  const readingRef = readingsRef().doc(readingId);

  return db.runTransaction(async (tx) => {
    const [vehicleSnap, readingSnap] = await Promise.all([tx.get(vehicleRef), tx.get(readingRef)]);

    // Idempotent replay: the reading already exists — no second write.
    if (readingSnap.exists) {
      const existing = toReading(readingSnap.id, readingSnap.data() ?? {});
      return {
        reading: existing,
        duplicate: true,
        newProjectionKm: Number(vehicleSnap.data()?.odometerKm ?? 0),
      };
    }
    if (!vehicleSnap.exists) {
      throw new OdometerError("VEHICLE_NOT_FOUND", "Vehicle not found");
    }
    const vehicle = vehicleSnap.data() ?? {};
    const projectionKm = Number(vehicle.odometerKm ?? 0);

    // Live sources enforce monotonicity unless an internal trusted caller
    // (service completion) explicitly allows a decrease.
    if (!input.allowDecrease) {
      const validation = validateReading(input.km, input.source, projectionKm);
      if (!validation.ok) {
        throw new OdometerError(validation.code, validation.message);
      }
    } else {
      const validation = validateCorrection(input.km);
      if (!validation.ok) {
        throw new OdometerError(validation.code, validation.message);
      }
    }

    const deltaKm =
      input.km >= projectionKm ? deltaFromPrevious(input.km, projectionKm) : undefined;

    let conflictNote: string | undefined;
    if (!isLiveSource(input.source)) {
      // Historical import: compare against the nearest accepted neighbours by
      // effective time. Single-field queries only — sort in memory.
      const neighbours = await readingsRef()
        .where("vehicleId", "==", input.vehicleId)
        .where("status", "==", "ACCEPTED")
        .limit(2000)
        .get();
      const sorted = neighbours.docs
        .map((d) => toReading(d.id, d.data()))
        .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
      const before = sorted.filter((r) => r.effectiveAt <= effectiveAt).pop();
      const after = sorted.find((r) => r.effectiveAt > effectiveAt);
      conflictNote =
        detectHistoricalConflict(input.km, before?.km ?? null, after?.km ?? null) ?? undefined;
    }

    const reading: OdometerReading = {
      id: readingId,
      vehicleId: input.vehicleId,
      km: input.km,
      effectiveAt,
      createdAt: now,
      recordedByUserId: input.recordedByUserId,
      source: input.source,
      assignmentId: input.assignmentId,
      inspectionId: input.inspectionId,
      serviceRecordId: input.serviceRecordId,
      fuelEntryId: input.fuelEntryId,
      issueId: input.issueId,
      notes: input.notes,
      status: conflictNote ? "FLAGGED" : "ACCEPTED",
      deltaKm,
      conflictNote,
      clientToken: input.clientToken,
    };

    tx.set(readingRef, definedOnly({ ...reading, effectiveAt, createdAt: now }));

    // Projection rises only for ACCEPTED readings; FLAGGED historical imports
    // never move the projection.
    const newProjection = Math.max(projectionKm, reading.status === "ACCEPTED" ? input.km : 0);
    if (newProjection > projectionKm) {
      tx.update(vehicleRef, {
        odometerKm: newProjection,
        odometerAt: effectiveAt,
        odometerSource: input.source,
        updatedAt: now,
      });
    }

    return { reading, duplicate: false, newProjectionKm: newProjection };
  });
}

export interface CorrectReadingInput {
  readingId: string;
  correctedKm: number;
  reason: string;
  correctedByUserId: string;
}

/**
 * Supersede an accepted reading with a corrected value. The original is kept
 * (status SUPERSEDED, with correction metadata); the replacement is created;
 * the vehicle projection is recomputed from the remaining accepted ledger.
 */
export async function correctReading(
  input: CorrectReadingInput,
): Promise<{ original: OdometerReading; replacement: OdometerReading }> {
  const db = getAdminDb();
  const readingRef = readingsRef().doc(input.readingId);

  return db.runTransaction(async (tx) => {
    const readingSnap = await tx.get(readingRef);
    if (!readingSnap.exists) {
      throw new OdometerError("READING_NOT_FOUND", "Reading not found");
    }
    const original = toReading(readingSnap.id, readingSnap.data() ?? {});
    if (original.status !== "ACCEPTED") {
      throw new OdometerError("NOT_ACCEPTED", "Only accepted readings can be corrected");
    }
    if (original.correctedByUserId || original.supersedesReadingId) {
      throw new OdometerError("ALREADY_CORRECTED", "This reading has already been corrected");
    }
    const validation = validateCorrection(input.correctedKm);
    if (!validation.ok) {
      throw new OdometerError(validation.code, validation.message);
    }

    const replacementId = readingsRef().doc().id;
    const now = new Date();

    tx.update(readingRef, {
      status: "SUPERSEDED",
      correctedReadingId: replacementId,
      correctedByUserId: input.correctedByUserId,
      correctionReason: input.reason.slice(0, 1000),
      updatedAt: now,
    });

    const replacement: OdometerReading = {
      ...original,
      id: replacementId,
      km: input.correctedKm,
      status: "ACCEPTED",
      createdAt: now,
      effectiveAt: original.effectiveAt,
      recordedByUserId: input.correctedByUserId,
      source: original.source,
      supersedesReadingId: input.readingId,
      correctedByUserId: input.correctedByUserId,
      correctionReason: input.reason.slice(0, 1000),
      deltaKm: undefined,
      clientToken: undefined,
    };
    tx.set(readingsRef().doc(replacementId), definedOnly({ ...replacement }));

    // Recompute projection from remaining accepted readings for this
    // vehicle. Queries inside a transaction must not be used for the
    // replacement's value (it is uncommitted) — the projection is the max of
    // the corrected value and every other accepted reading.
    const ledgerSnap = await readingsRef()
      .where("vehicleId", "==", original.vehicleId)
      .where("status", "==", "ACCEPTED")
      .limit(2000)
      .get();
    const others = ledgerSnap.docs
      .map((d) => toReading(d.id, d.data()))
      .filter((r) => r.id !== input.readingId); // superseded original
    const newProjection = others.reduce((max, r) => Math.max(max, r.km), input.correctedKm);

    const vehicleRef = db.collection(COLLECTIONS.vehicles).doc(original.vehicleId);
    tx.update(vehicleRef, {
      odometerKm: newProjection,
      updatedAt: now,
    });

    return { original: { ...original, status: "SUPERSEDED" as const }, replacement };
  });
}

/** Count readings for a vehicle (optionally by status) via aggregation. */
export async function countReadings(
  vehicleId: string,
  options?: { status?: OdometerStatus },
): Promise<number> {
  let query: import("firebase-admin/firestore").Query = readingsRef().where(
    "vehicleId",
    "==",
    vehicleId,
  );
  if (options?.status) query = query.where("status", "==", options.status);
  const snap = await query.count().get();
  return snap.data().count;
}

/** Ledger page for a vehicle, newest effective reading first. */
export async function listReadings(
  vehicleId: string,
  options?: { limit?: number; status?: OdometerStatus },
): Promise<OdometerReading[]> {
  let query = readingsRef().where("vehicleId", "==", vehicleId);
  if (options?.status) {
    query = query.where("status", "==", options.status);
  }
  const snap = await query.limit(2000).get();
  return snap.docs
    .map((d) => toReading(d.id, d.data()))
    .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())
    .slice(0, options?.limit ?? 100);
}
