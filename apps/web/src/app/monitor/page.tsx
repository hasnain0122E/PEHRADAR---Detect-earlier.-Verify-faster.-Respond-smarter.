import type { Metadata } from "next";

import { CommandCenterRoot } from "@/components/command/CommandCenterRoot";
import { EntryReveal } from "@/components/landing/EntryReveal";
import { PRODUCT_NAME } from "@/lib/config";

export const metadata: Metadata = { title: `${PRODUCT_NAME} — Karachi Monitoring` };

export default function MonitorPage() {
  return (
    <>
      <CommandCenterRoot />
      <EntryReveal />
    </>
  );
}
