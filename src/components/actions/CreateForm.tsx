"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { api } from "@/lib/client/api";

/**
 * Generic inline create form: renders a compact field set, posts JSON to the
 * given endpoint, then refreshes the server-rendered list.
 */
export function CreateForm({
  endpoint,
  fields,
  submitLabel,
  onSuccess,
}: {
  endpoint: string;
  fields: {
    name: string;
    label: string;
    type?: "text" | "number" | "textarea" | "select" | "date" | "email" | "tel";
    required?: boolean;
    placeholder?: string;
    /** `step` for number inputs; defaults to a whole number (browser default). */
    step?: string;
    options?: { value: string; label: string }[];
    defaultValue?: string;
  }[];
  submitLabel: string;
  /** Called with the response body on success (e.g. to surface a temp password). */
  onSuccess?: (body: unknown) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = form.get(field.name);
      if (raw === null || raw === "") continue;
      body[field.name] = field.type === "number" ? Number(raw) : raw;
    }
    try {
      const result = await api.post<unknown>(endpoint, body);
      onSuccess?.(result);
      router.refresh();
      (event.target as HTMLFormElement).reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `create-${field.name}`;
          return (
            <Field key={field.name} label={field.label} htmlFor={id} required={field.required}>
              {field.type === "textarea" ? (
                <Textarea
                  id={id}
                  name={field.name}
                  required={field.required}
                  placeholder={field.placeholder}
                  rows={3}
                />
              ) : field.type === "select" ? (
                <Select
                  id={id}
                  name={field.name}
                  required={field.required}
                  defaultValue={field.defaultValue ?? ""}
                >
                  {!field.required && <option value="">—</option>}
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={id}
                  name={field.name}
                  type={field.type ?? "text"}
                  required={field.required}
                  placeholder={field.placeholder}
                  step={field.step}
                  defaultValue={field.defaultValue}
                />
              )}
            </Field>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" size="sm" isLoading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
