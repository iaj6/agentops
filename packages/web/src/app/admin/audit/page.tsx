import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { AuditSection } from "@/app/settings/AuditSection";

export const metadata: Metadata = {
  title: "Audit Log",
  description: "Chronological log of administrative actions",
};

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/admin/audit");
  if (user.role !== "admin") redirect("/");

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
        <p className="text-sm text-muted">
          Every user invite, policy change, and webhook action — who, when, what
        </p>
      </div>
      <AuditSection />
    </div>
  );
}
