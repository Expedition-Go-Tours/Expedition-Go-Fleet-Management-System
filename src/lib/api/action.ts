import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { ApiError, jsonOk, toErrorResponse } from "@/lib/api/errors";
import { assertCsrfAndOrigin, requireAuthContext, requirePermission } from "@/lib/auth/guards";
import type { ActionDef, ActionMap } from "@/lib/domain/lifecycle";
import { reachableStates, resolveAction, transitionAllowed } from "@/lib/domain/lifecycle";
import type { AuditEventType } from "@/lib/repos/audit";
import { writeAuditEvent } from "@/lib/repos/audit";

/*
 * Generic lifecycle action endpoint.
 *
 * Every state change in the app goes through this pattern:
 *   CSRF + origin → authenticated context → resolve action →
 *   requirePermission(action.permission) → load entity → validate source state →
 *   entity-specific invariant → apply → audit (before/after status).
 *
 * Generic PATCH bodies can never change `status` — states only move via these
 * explicit, permission-checked action endpoints.
 */

export interface ActionHandlerConfig<S extends string, E extends { id: string; status: S }> {
  /** Action map from the entity's domain module. */
  actions: ActionMap<S>;
  /** Audit event type recorded on success. The action name goes in `reason`. */
  auditEventType: AuditEventType;
  /** Collection/entity label for404s and audit `entityType`. */
  entityType: string;
  /** JSON response key for the updated entity, e.g. "vehicle". */
  jsonKey: string;
  load: (id: string) => Promise<E | null>;
  apply: (
    entity: E,
    def: ActionDef<S>,
    body: Record<string, unknown>,
    actorId: string,
  ) => Promise<E>;
  /**
   * Extra invariants checked after permission + state validation, before apply.
   * Throw ApiError (typically409/400) to block.
   */
  assertAllowed?: (entity: E, def: ActionDef<S>, body: Record<string, unknown>) => Promise<void>;
}

export function makeActionHandler<S extends string, E extends { id: string; status: S }>(
  config: ActionHandlerConfig<S, E>,
) {
  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const requestId = randomUUID();
    try {
      await assertCsrfAndOrigin();
      const context = await requireAuthContext();

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const action = body?.action;
      if (typeof action !== "string" || action.length === 0) {
        throw ApiError.badRequest("Missing action");
      }

      const resolved = resolveAction(config.actions, action);
      if (!resolved.ok) {
        throw ApiError.badRequest(
          `Unknown action "${action}". Valid actions: ${Object.keys(config.actions).join(", ")}`,
          "UNKNOWN_ACTION",
        );
      }
      const def = resolved.def;
      requirePermission(context, def.permission);

      const { id } = await params;
      const entity = await config.load(id);
      if (!entity) throw ApiError.notFound(`${config.entityType} not found`);

      if (!transitionAllowed(def, entity.status)) {
        const reachable = reachableStates(config.actions, entity.status);
        throw ApiError.conflict(
          `${config.entityType} is ${entity.status}; action "${action}" is unavailable. ` +
            `Reachable from here: ${reachable.length ? reachable.join(", ") : "nothing"}`,
        );
      }

      await config.assertAllowed?.(entity, def, body ?? {});
      const updated = await config.apply(entity, def, body ?? {}, context.user.id);

      await writeAuditEvent({
        eventType: config.auditEventType,
        actorId: context.user.id,
        entityType: config.entityType,
        entityId: entity.id,
        reason: action,
        before: { status: entity.status },
        after: { status: updated.status },
        requestId,
      });

      return jsonOk({ [config.jsonKey]: updated, action });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
