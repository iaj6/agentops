import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { UsersSection } from "@/app/settings/UsersSection";

export const metadata: Metadata = {
  title: "Users",
  description: "Invite teammates and manage roles",
};

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/admin/users");
  if (user.role !== "admin") redirect("/");

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted">
          Invite teammates, set roles, and reset access
        </p>
      </div>
      <UsersSection meRole="admin" />
    </div>
  );
}
