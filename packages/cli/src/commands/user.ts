import { Command } from "commander";
import { randomBytes } from "node:crypto";
import {
  getDb,
  countUsers,
  insertUser,
  listUsers,
  getUserByEmail,
  setUserPassword,
} from "@agentops/db";

function generateTempPassword(): string {
  // 16 chars from a non-ambiguous alphabet; ~88 bits of entropy. The user
  // changes this on first login.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function registerUserCommands(program: Command): void {
  const user = program
    .command("user")
    .description("Manage AgentOps dashboard users (admin)");

  user
    .command("add <email>")
    .description("Create a new user account; prints a one-time temp password")
    .option("--name <name>", "Display name for the user")
    .option("--admin", "Grant admin role (first user is automatically admin)")
    .action((email: string, opts: { name?: string; admin?: boolean }) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const existing = getUserByEmail(db, email);
      if (existing) {
        const msg = `User already exists: ${email}`;
        if (json) {
          console.log(JSON.stringify({ status: "exists", email }));
        } else {
          console.error(msg);
        }
        process.exit(1);
      }

      const isFirst = countUsers(db) === 0;
      const tempPassword = generateTempPassword();
      const created = insertUser(db, {
        email,
        ...(opts.name ? { name: opts.name } : {}),
        password: tempPassword,
        role: opts.admin || isFirst ? "admin" : "member",
        mustChangePassword: true,
      });

      if (json) {
        console.log(
          JSON.stringify({
            status: "created",
            user: { id: created.id, email: created.email, role: created.role },
            tempPassword,
          }),
        );
        return;
      }

      console.log(`User created.`);
      console.log(``);
      console.log(`  Email:    ${created.email}`);
      console.log(`  Role:     ${created.role}`);
      console.log(`  Password: ${tempPassword}`);
      console.log(``);
      console.log(
        `Share these credentials securely. The user must change the password on first login.`,
      );
    });

  user
    .command("list")
    .description("List all dashboard users")
    .action(() => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const users = listUsers(db);

      if (json) {
        console.log(JSON.stringify(users, null, 2));
        return;
      }

      if (users.length === 0) {
        console.log(`No users yet. Create one with: agentops user add <email>`);
        return;
      }

      // Simple aligned table without an external dep
      const header = ["EMAIL", "ROLE", "NAME", "CREATED"];
      const rows = users.map((u) => [
        u.email,
        u.role,
        u.name ?? "-",
        new Date(u.createdAt).toLocaleDateString(),
      ]);
      const widths = header.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => r[i]!.length)),
      );
      const fmt = (cells: string[]) =>
        cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
      console.log(fmt(header));
      console.log(widths.map((w) => "-".repeat(w)).join("  "));
      for (const row of rows) console.log(fmt(row));
    });

  user
    .command("reset-password <email>")
    .description("Generate a new temp password for a user")
    .action((email: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const target = getUserByEmail(db, email);
      if (!target) {
        const msg = `No such user: ${email}`;
        if (json) console.log(JSON.stringify({ status: "not-found", email }));
        else console.error(msg);
        process.exit(1);
      }

      const tempPassword = generateTempPassword();
      setUserPassword(db, target.id, tempPassword);

      if (json) {
        console.log(JSON.stringify({ status: "reset", email, tempPassword }));
        return;
      }

      console.log(`Password reset for ${email}.`);
      console.log(``);
      console.log(`  New password: ${tempPassword}`);
      console.log(``);
      console.log(`User can sign in immediately.`);
    });
}
