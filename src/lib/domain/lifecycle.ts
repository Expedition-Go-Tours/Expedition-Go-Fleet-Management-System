import type { PermissionKey } from "@/lib/auth/permissions";

/*
 * Shared lifecycle machinery for domain state machines.
 *
 * Each entity defines an action map: action name → { permission, allowed
 * source states, target state }. Routes resolve the action, check its
 * permission, verify the current state is an allowed source, then apply the
 * transition. Every invalid transition is a 409; every action is permission
 * checked — state changes never go through generic PATCH bodies.
 */

export interface ActionDef<S extends string> {
  permission: PermissionKey;
  /** States the action is valid from. */
  from: readonly S[];
  /** State the action moves the entity into. */
  to: S;
}

export type ActionMap<S extends string> = Record<string, ActionDef<S>>;

export type TransitionResult<S extends string> =
  | { ok: true; def: ActionDef<S> }
  | { ok: false; error: "unknown_action" }
  | { ok: false; error: "invalid_state"; allowed: readonly S[] };

/** Resolve an action name against an entity's action map. */
export function resolveAction<S extends string>(
  actions: ActionMap<S>,
  action: string,
): TransitionResult<S> {
  const def = actions[action];
  if (!def) return { ok: false, error: "unknown_action" };
  return { ok: true, def };
}

/** True when `current` is an allowed source state for the action. */
export function transitionAllowed<S extends string>(def: ActionDef<S>, current: S): boolean {
  return def.from.includes(current);
}

/** All target states reachable from `current` (for error messages). */
export function reachableStates<S extends string>(actions: ActionMap<S>, current: S): readonly S[] {
  return Object.values(actions)
    .filter((def) => def.from.includes(current))
    .map((def) => def.to);
}
