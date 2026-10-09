import type { ReactNode } from "react";

import { Container } from "@/components/layout/Container";
import { DisplayTitle } from "@/components/ui/DisplayTitle";
import { Eyebrow } from "@/components/ui/Eyebrow";

/** Bare layout for pre-authentication screens (sign-in, password change). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-dark text-on-dark flex min-h-screen flex-col">
      <Container className="flex flex-1 flex-col justify-center py-16">
        <div className="mx-auto flex w-full max-w-md flex-col gap-10">
          <div className="flex flex-col gap-3">
            <Eyebrow className="text-on-dark/60">Expedition Go Tours · Fleet Operations</Eyebrow>
            <DisplayTitle size="md">Fleet maintenance, run on record.</DisplayTitle>
          </div>
          {children}
          <p className="font-ui text-on-dark/40 text-[length:var(--fs-ui-xs)] tracking-[var(--tracking-ui)] uppercase">
            Staff only · Invite only
          </p>
        </div>
      </Container>
    </main>
  );
}
