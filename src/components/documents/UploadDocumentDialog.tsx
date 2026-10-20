"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/client/api";

/**
 * Upload a document file against a vehicle.
 *
 * The file and its metadata go to `/api/v1/documents/upload` in one multipart
 * request, so a failed upload never leaves a half-registered record behind.
 * Type and size are checked here for a friendly message *and* re-checked
 * server-side.
 */
export function UploadDocumentDialog({
  vehicleId,
  categories,
  canUpload,
}: {
  vehicleId: string;
  categories: readonly string[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    form.set("vehicleId", vehicleId);
    form.set("mandatory", String(form.get("mandatory") === "on"));

    try {
      await api.upload("/api/v1/documents/upload", form);
      setOpen(false);
      setFileName(null);
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      // The server's message is the useful one (size, type, storage rejected,
      // uploads not configured) — never replace it with a generic apology.
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!canUpload}>
        <UploadCloud aria-hidden="true" className="h-4 w-4" />
        Upload document
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Upload document"
        description="Attach a registration, insurance, roadworthiness or permit file to this vehicle."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="accent" type="submit" form="upload-document-form" isLoading={busy}>
              Upload
            </Button>
          </>
        }
      >
        <form
          id="upload-document-form"
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {error && (
            <p
              role="alert"
              className="bg-error/10 text-body-xs border-error/25 text-error rounded-md border p-3 sm:col-span-2"
            >
              {error}
            </p>
          )}

          <Field
            label="File"
            required
            htmlFor="ud-file"
            className="sm:col-span-2"
            hint={fileName ?? "PDF, JPG, PNG, WebP or HEIC — up to 15 MB."}
          >
            <Input
              id="ud-file"
              name="file"
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </Field>

          <Field label="Category" required htmlFor="ud-category">
            <Select id="ud-category" name="category" defaultValue={categories[0]}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category.charAt(0) + category.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Expiry date" htmlFor="ud-expiry" hint="Leave blank if it does not expire.">
            <Input id="ud-expiry" name="expiryDate" type="date" />
          </Field>

          <Field label="Issue date" htmlFor="ud-issue">
            <Input id="ud-issue" name="issueDate" type="date" />
          </Field>

          <Field label="Required for this vehicle?" htmlFor="ud-mandatory">
            <label className="field-control flex items-center gap-2">
              <input
                id="ud-mandatory"
                name="mandatory"
                type="checkbox"
                className="border-strong h-4 w-4 rounded"
              />
              <span className="text-body-xs text-muted">Blocks trips while expired or missing</span>
            </label>
          </Field>

          <Field label="Notes" htmlFor="ud-notes" className="sm:col-span-2">
            <Textarea
              id="ud-notes"
              name="notes"
              rows={2}
              placeholder="e.g. Renewed through Kofi Insurance, policy #A-1234"
            />
          </Field>
        </form>
      </Modal>
    </>
  );
}
