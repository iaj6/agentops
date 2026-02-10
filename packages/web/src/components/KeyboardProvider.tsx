"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ShortcutsModal } from "./ShortcutsModal";

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Ignore if typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }

      if (e.key === "Backspace") {
        // Go back from detail pages to list
        if (pathname.startsWith("/runs/")) {
          e.preventDefault();
          router.push("/");
        } else if (pathname.startsWith("/policies/") && pathname !== "/policies") {
          e.preventDefault();
          router.push("/policies");
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router, pathname]);

  return (
    <>
      {children}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
    </>
  );
}
