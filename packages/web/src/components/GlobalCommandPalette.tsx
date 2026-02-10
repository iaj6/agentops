"use client";

import { useState, useEffect } from "react";
import { CommandPalette } from "./CommandPalette";

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return <CommandPalette open={open} onClose={() => setOpen(false)} />;
}
