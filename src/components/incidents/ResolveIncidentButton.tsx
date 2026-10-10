"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client/api";

/**
 * Resolve an incident — requires a resolution note (accountability: every
 * closed incident records why and by whom).
 */
export function ResolveIncidentButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    const resolution = window.prompt("Resolution note (required):");
    if (resolution === null) return; // cancelled
    const trimmed = resolution.trim();
    if (!trimmed) {
      setError("A resolution note is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/v1/incidents/${incidentId}/status`, {
        action: "resolve",
        resolution: trimmed,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve the incident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={resolve}>
        {busy ? "…" : "Resolve"}
      </Button>
      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}