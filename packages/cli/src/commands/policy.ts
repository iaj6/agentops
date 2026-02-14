import { Command } from "commander";
import {
  createRunId,
  createPolicyId,
  PolicyEngine,
  PolicyType,
  PolicySeverity,
  getPolicyMode,
} from "@agentops/core";
import type { Policy, PolicyConfig } from "@agentops/core";
import { getDb, getRun, listPolicies, insertPolicy, getPolicyResults } from "@agentops/db";
import { table, colorBool } from "../format.js";

export function registerPolicyCommands(program: Command): void {
  const policy = program.command("policy").description("Manage policies");

  policy
    .command("list")
    .description("List active policies")
    .action(() => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const results = listPolicies(db, { enabled: true });

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No active policies.");
        return;
      }

      const knownTypes = new Set(Object.values(PolicyType) as string[]);
      const rows = results.map((p) => [
        p.id as string,
        p.name,
        p.type,
        knownTypes.has(p.type) ? getPolicyMode(p.type as PolicyType) : "deprecated",
        p.severity,
        p.enabled ? "yes" : "no",
      ]);

      console.log(table(["ID", "Name", "Type", "Mode", "Severity", "Enabled"], rows));
    });

  policy
    .command("add")
    .description("Add a new policy")
    .argument("<type>", "Policy type (e.g. pathRestriction, riskyOpFlag)")
    .requiredOption("--name <name>", "Policy name")
    .requiredOption("--config <json>", "Policy config as JSON")
    .option("--severity <severity>", "Policy severity", "error")
    .action(
      (
        type: string,
        opts: { name: string; config: string; severity: string },
      ) => {
        const dbPath = program.opts()["dbPath"] as string | undefined;
        const json = program.opts()["json"] as boolean | undefined;
        const db = getDb(dbPath);

        let config: PolicyConfig;
        try {
          config = JSON.parse(opts.config) as PolicyConfig;
        } catch {
          console.error("Invalid JSON for --config");
          process.exit(1);
        }

        const id = createPolicyId(`policy_${Date.now()}`);
        const newPolicy: Policy & { enabled: boolean; createdAt: string } = {
          id,
          name: opts.name,
          type: type as PolicyType,
          config,
          severity: opts.severity as PolicySeverity,
          enabled: true,
          createdAt: new Date().toISOString(),
        };

        insertPolicy(db, newPolicy);

        if (json) {
          console.log(JSON.stringify({ id, name: opts.name, type }));
        } else {
          console.log(`Policy added: ${id}`);
        }
      },
    );

  policy
    .command("evaluate")
    .description("Evaluate policies against a run")
    .argument("<runId>", "The run ID to evaluate")
    .action((runId: string) => {
      const dbPath = program.opts()["dbPath"] as string | undefined;
      const json = program.opts()["json"] as boolean | undefined;
      const db = getDb(dbPath);

      const run = getRun(db, createRunId(runId));
      if (!run) {
        console.error(`Run not found: ${runId}`);
        process.exit(1);
      }

      const activePolicies = listPolicies(db, { enabled: true });
      const engine = new PolicyEngine();
      const results = engine.evaluate(run, activePolicies);

      if (json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No policies to evaluate.");
        return;
      }

      for (const r of results) {
        console.log(`${colorBool(r.passed)} [${r.policy.severity}] ${r.policy.name}: ${r.message}`);
      }
    });
}
