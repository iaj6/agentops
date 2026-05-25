import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { WebhooksSection } from "@/app/settings/WebhooksSection";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Subscribe external services to AgentOps events",
};

export const dynamic = "force-dynamic";

export default async function AdminWebhooksPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/admin/webhooks");
  if (user.role !== "admin") redirect("/");

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Webhooks</h1>
        <p className="text-sm text-muted">
          Forward AgentOps events (policy violations, run completions) to
          external endpoints
        </p>
      </div>
      <WebhooksSection />
    </div>
  );
}
