"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";
import type { DirectoryUser } from "@/components/admin/UserDirectory";

/**
 * Correct an employee's profile on their behalf — the "the admin has to
 * manually edit a data for a driver" case. Only name and phone are editable:
 * roles and status have dedicated controls with their own invariants, and the
 * email is the Firebase Auth identity key so it is read-only here.
 */
export function EditUserDialog({ user, onSave }: { user: DirectoryUser; onSave?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setName(user.name);
    setPhone(user.phone ?? "");
    setError(null);
    setOpen(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/v1/users/${user.id}`, { name: name.trim(), phone: phone.trim() });
      setOpen(false);
      onSave?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openDialog} aria-label={`Edit ${user.name}`}>
        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
        Edit
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit employee record"
        description={`${user.email} · ${user.roles.join(" · ")}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" type="submit" form="edit-user-form" isLoading={busy}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-user-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Full name" required htmlFor="eu-name">
            <Input
              id="eu-name"
              name="name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Phone"
            hint="Used for trip-day contact. Leave empty to clear it."
            htmlFor="eu-phone"
          >
            <Input
              id="eu-phone"
              name="phone"
              type="tel"
              maxLength={50}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <p className="field-hint">
            Email, roles and account status are managed separately so their invariants (last
            administrator, session revocation) still apply.
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
