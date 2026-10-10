import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";

export const metadata = { title: "Styleguide" };

const palette: { name: string; value: string; note: string }[] = [
  { name: "Ink", value: "#1a1d21", note: "Primary text / primary action" },
  { name: "Accent", value: "#f15a24", note: "Attention, alerts, active state" },
  { name: "Dark", value: "#000000", note: "Dark surfaces & inverse text" },
  { name: "Panel", value: "#0c1016", note: "Cards on dark surfaces" },
  { name: "Muted", value: "#6b7280", note: "Secondary text" },
  { name: "Faint", value: "#d9d9d9", note: "Dividers, disabled" },
];

const phases = [
  { id: "0", label: "Scaffold", state: "Done" },
  { id: "1", label: "Auth core", state: "Done" },
  { id: "2", label: "RBAC + audit", state: "Done" },
  { id: "3", label: "Fleet domain", state: "Done" },
  { id: "4", label: "Dashboard", state: "Done" },
  { id: "5", label: "Scheduled reminders", state: "Pending" },
  { id: "6", label: "Hardening", state: "Pending" },
] as const;

/** Internal design-system reference — not part of the product surface. */
export default function StyleguidePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-dark text-on-dark">
        <Container className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-6 py-16 md:py-24">
          <div className="flex items-center justify-between gap-6">
            <Eyebrow className="text-on-dark/70">Expedition Go Tours · Fleet Operations</Eyebrow>
            <Eyebrow className="text-on-dark/70">Internal · Invite only</Eyebrow>
          </div>

          <div className="flex flex-col gap-6">
            <DisplayTitle size="xl" className="max-w-4xl">
              Fleet maintenance, run on record.
            </DisplayTitle>
            <p className="text-body-lg text-on-dark/70 max-w-xl">
              Vehicle, work-order and expense tracking for the Expedition Go Tours fleet — with
              scheduled maintenance reminders and a full audit trail.
            </p>
          </div>
        </Container>
      </section>

      <Container className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-14 px-6 py-16">
        <section className="flex flex-col gap-6">
          <Eyebrow>Palette</Eyebrow>
          <div className="border-hairline bg-hairline grid grid-cols-2 gap-px overflow-hidden rounded-xl border sm:grid-cols-3 lg:grid-cols-6">
            {palette.map((swatch) => (
              <div key={swatch.name} className="bg-page flex flex-col gap-4 p-5">
                <span
                  aria-hidden
                  className="border-hairline h-14 w-full rounded-md border"
                  style={{ background: swatch.value }}
                />
                <div className="flex flex-col gap-1">
                  <span className="font-heading text-heading-sm font-semibold">{swatch.name}</span>
                  <span className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                    {swatch.value}
                  </span>
                  <span className="text-body-xs text-muted">{swatch.note}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Eyebrow>Type scale</Eyebrow>
            <div className="flex flex-col gap-4">
              <p className="text-display-md font-heading font-semibold">Display 40</p>
              <p className="text-heading-lg font-heading font-semibold">Heading 32</p>
              <p className="text-heading-md font-heading font-semibold">Heading 24</p>
              <p className="text-body-md">Body 18 — DM Sans for paragraphs and dense data.</p>
              <p className="text-body-xs text-muted">
                Body 14 — secondary copy, captions and table meta.
              </p>
              <p className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                UI 11 — mono micro-label
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <Eyebrow>Controls</Eyebrow>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-6">
          <Eyebrow>Build phases</Eyebrow>
          <ol className="border-hairline bg-hairline grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
            {phases.map((phase) => (
              <li key={phase.id} className="bg-page flex flex-col gap-3 p-5">
                <span className="font-ui text-muted text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
                  Phase {phase.id}
                </span>
                <span className="font-heading text-heading-sm font-semibold">{phase.label}</span>
                <span
                  className={
                    phase.state === "Pending"
                      ? "text-body-xs text-muted"
                      : "text-accent text-body-xs font-medium"
                  }
                >
                  {phase.state}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </Container>
    </main>
  );
}
