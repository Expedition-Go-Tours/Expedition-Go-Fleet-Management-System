import { makeActionHandler } from "@/lib/api/action";
import { ApiError } from "@/lib/api/errors";
import { INCIDENT_ACTIONS, type IncidentReport, type IncidentStatus } from "@/lib/domain/incident";
import { AUDIT_EVENTS } from "@/lib/repos/audit";
import { applyIncidentStatus, getIncidentById } from "@/lib/repos/incidents";

export const runtime = "nodejs";

/**
 * POST /api/v1/incidents/[id]/status
 * Incident lifecycle actions: start_review | resolve.
 * Permission comes from the action map (incident:manage).
 * Resolving requires a resolution note so every closed incident is accounted for.
 */
export const POST = makeActionHandler<IncidentStatus, IncidentReport>({
  actions: INCIDENT_ACTIONS,
  auditEventType: AUDIT_EVENTS.INCIDENT_UPDATED,
  entityType: "incident",
  jsonKey: "incident",
  load: getIncidentById,
  apply: (entity, def, body, actorId) => {
    if (def.to === "RESOLVED") {
      const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
      if (!resolution || resolution.length > 2000) {
        throw ApiError.badRequest("Resolving an incident requires a resolution note (max 2000 chars)");
      }
      return applyIncidentStatus(entity.id, def.to, actorId, { resolution });
    }
    return applyIncidentStatus(entity.id, def.to, actorId);
  },
});