"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client/api";
import { ROLE_KEYS } from "@/lib/auth/types";

/**
 * Role editor for one user. Posts the full new role set to
 * /api/v1/users/[id]/roles (user:role:assign), which enforces the
 * last-administrator invariant server-side.
 */
export function RoleEditor({ userId, currentRoles }: { userId: string; currentRoles: string[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(currentRoles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(role: string) {
    setSaved(false);
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/users/${userId}/roles`, { roles: selected });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update roles");
    } finally {
      setBusy(false);
    }
  }

  const changed = selected.slice().sort().join(",") !== currentRoles.slice().sort().join(",");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {ROLE_KEYS.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => toggle(role)}
            aria-pressed={selected.includes(role)}
            className={`rounded-pill font-ui border px-2.5 py-0.5 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase transition-colors ${
              selected.includes(role)
                ? "border-ink bg-ink text-on-dark"
                : "border-hairline text-muted hover:border-strong hover:text-ink"
            }`}
          >
            {role}
          </button>
        ))}
      </div>
      {changed && (
        <div>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || selected.length === 0}
            onClick={save}
          >
            {busy ? "Saving…" : "Save roles"}
          </Button>
        </div>
      )}
      {saved && <p className="text-body-xs text-success">Roles updated.</p>}
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
