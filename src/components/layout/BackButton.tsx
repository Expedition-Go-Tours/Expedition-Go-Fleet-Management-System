"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * History back control. Calls the real router back so it uses the browser's
 * in-app history rather than a hardcoded destination. When there is no prior
 * entry in this tab (e.g. the dashboard was opened directly), it falls back to
 * the given href.
 */
export function BackButton({
  label = "Back",
  fallbackHref = "/",
}: {
  label?: string;
  fallbackHref?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <Button variant="ghost" size="sm" onClick={goBack}>
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      {label}
    </Button>
  );
}
