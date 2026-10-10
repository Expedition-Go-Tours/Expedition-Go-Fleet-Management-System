"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/fields";
import { api } from "@/lib/client/api";
import { ROLE_KEYS } from "@/lib/auth/types";

/**
 * Invite form: creates the account and surfaces the one-time temporary
 * password the admin must share with the invitee out-of-band.
 */
export function InviteUserForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>("DRIVER");
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setTempPassword(null);
    setBusy(true);
    try {
      const result = await api.post<{ tempPassword: string }>("/api/v1/users", {
        name,
        email,
        phone: phone || undefined,
        roles: [role],
      });
      setTempPassword(result.tempPassword);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  }

  if (tempPassword) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border-success/30 bg-success/10 rounded-md border p-4">
          <p className="text-body-xs text-success mb-2 font-medium">Account created</p>
          <p className="text-body-xs text-muted mb-2">
            Share this temporary password with {email} via phone/WhatsApp. They must change it on
            first sign-in.
          </p>
          <code className="bg-surface border-hairline text-body-sm block rounded border px-3 py-2 font-mono">
            {tempPassword}
          </code>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setTempPassword(null);
            setName("");
            setEmail("");
            setPhone("");
          }}
        >
          Invite another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Full name" htmlFor="invite-name" required>
        <Input id="invite-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email" htmlFor="invite-email" required>
        <Input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Phone (optional)" htmlFor="invite-phone">
        <Input
          id="invite-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Field label="Role" htmlFor="invite-role">
        <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>

      {error && (
        <p role="alert" className="text-body-xs text-error">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" size="sm" isLoading={busy}>
          Create invite
        </Button>
      </div>
    </form>
  );
}
