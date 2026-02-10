import { randomUUID } from "node:crypto";
import type { Run, Agent, Action, Artifact, Evaluation, Decision, Metrics } from "@agentops/core";
import {
  RunStatus,
  AgentRole,
  DecisionType,
  createRunId,
  createPolicyId,
  createAgentId,
  createActionId,
  createArtifactId,
  createDecisionId,
  createSessionId,
  createEventId,
  SessionStatus,
  PolicyType,
  PolicySeverity,
  PolicyEngine,
  EventCategory,
} from "@agentops/core";
import type { Policy } from "@agentops/core";
import type { AgentOpsDb } from "./connection.js";
import { getDb } from "./connection.js";
import { insertRun } from "./runs.js";
import { insertPolicy } from "./policies.js";
import { insertEvent } from "./events.js";
import { insertSession } from "./sessions.js";
import { policyResults, runMetrics, jobs, sessions, events, locks } from "./schema.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid(): string {
  return randomUUID().slice(0, 8);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickN<T>(arr: readonly T[], min: number, max: number): T[] {
  const n = randInt(min, max);
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function daysAgo(days: number, jitterHours = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - randInt(0, jitterHours));
  d.setMinutes(randInt(0, 59));
  return d;
}

function minutesAfter(base: Date, min: number, max: number): Date {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + randInt(min, max));
  return d;
}

// ─── Realistic data pools ───────────────────────────────────────────────────

const REPOS = [
  "acme/backend",
  "acme/frontend",
  "acme/infra",
  "acme/mobile-api",
  "acme/data-pipeline",
] as const;

const BRANCHES = [
  "feat/add-pagination",
  "fix/n-plus-one-query",
  "refactor/auth-to-jwt",
  "feat/otel-tracing",
  "fix/payment-error-handling",
  "chore/upgrade-deps",
  "feat/user-search",
  "fix/rate-limiter-bypass",
  "feat/webhook-retries",
  "refactor/order-service",
  "feat/rbac-permissions",
  "fix/memory-leak-ws",
  "feat/csv-export",
  "fix/timezone-handling",
  "chore/node20-migration",
  "feat/audit-log",
  "fix/cors-preflight",
  "feat/graphql-subscriptions",
  "refactor/database-pooling",
  "fix/deadlock-checkout",
];

const MODELS = [
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
  "gpt-4o",
  "gpt-4o-mini",
] as const;

const GOALS: Array<{
  human: string;
  type: string;
  desc: string;
  repo: (typeof REPOS)[number];
  files: string[];
}> = [
  {
    human: "Fix N+1 query in user dashboard endpoint",
    type: "bugfix",
    desc: "The GET /api/dashboard endpoint fires a separate query per user. Use eager loading.",
    repo: "acme/backend",
    files: [
      "src/routes/dashboard.ts",
      "src/repositories/userRepository.ts",
      "src/models/User.ts",
      "tests/routes/dashboard.test.ts",
    ],
  },
  {
    human: "Add cursor-based pagination to /api/users endpoint",
    type: "feature",
    desc: "Replace offset-based pagination with cursor pagination for stable iteration.",
    repo: "acme/backend",
    files: [
      "src/routes/users.ts",
      "src/middleware/pagination.ts",
      "src/repositories/userRepository.ts",
      "tests/routes/users.test.ts",
      "tests/middleware/pagination.test.ts",
    ],
  },
  {
    human: "Migrate auth from session cookies to JWT",
    type: "refactor",
    desc: "Replace express-session with signed JWTs. Add refresh token rotation.",
    repo: "acme/backend",
    files: [
      "src/middleware/auth.ts",
      "src/routes/auth.ts",
      "src/services/tokenService.ts",
      "src/models/RefreshToken.ts",
      "tests/middleware/auth.test.ts",
      "tests/services/tokenService.test.ts",
      "package.json",
    ],
  },
  {
    human: "Refactor payment service error handling",
    type: "refactor",
    desc: "Replace generic try/catch blocks with typed error hierarchy and structured logging.",
    repo: "acme/backend",
    files: [
      "src/services/paymentService.ts",
      "src/errors/PaymentError.ts",
      "src/errors/index.ts",
      "tests/services/paymentService.test.ts",
    ],
  },
  {
    human: "Add OpenTelemetry tracing to order service",
    type: "feature",
    desc: "Instrument order creation flow with OTel spans. Export to Jaeger.",
    repo: "acme/backend",
    files: [
      "src/services/orderService.ts",
      "src/tracing/setup.ts",
      "src/tracing/spans.ts",
      "docker-compose.yml",
      "tests/services/orderService.test.ts",
    ],
  },
  {
    human: "Fix rate limiter bypass via X-Forwarded-For spoofing",
    type: "bugfix",
    desc: "Trust proxy headers only when behind known load balancer. Validate IPs.",
    repo: "acme/backend",
    files: [
      "src/middleware/rateLimiter.ts",
      "src/config/proxy.ts",
      "tests/middleware/rateLimiter.test.ts",
    ],
  },
  {
    human: "Add role-based access control (RBAC) to admin endpoints",
    type: "feature",
    desc: "Create permission model with roles, scopes, and per-endpoint guards.",
    repo: "acme/backend",
    files: [
      "src/middleware/rbac.ts",
      "src/models/Role.ts",
      "src/models/Permission.ts",
      "src/routes/admin.ts",
      "src/repositories/roleRepository.ts",
      "tests/middleware/rbac.test.ts",
      "tests/routes/admin.test.ts",
    ],
  },
  {
    human: "Fix memory leak in WebSocket connection handler",
    type: "bugfix",
    desc: "Event listeners not cleaned up on disconnect. Leaking ~2MB per stale connection.",
    repo: "acme/backend",
    files: [
      "src/ws/connectionManager.ts",
      "src/ws/heartbeat.ts",
      "tests/ws/connectionManager.test.ts",
    ],
  },
  {
    human: "Add CSV export for transaction history",
    type: "feature",
    desc: "Stream large result sets to CSV with proper escaping. Support date range filters.",
    repo: "acme/backend",
    files: [
      "src/routes/exports.ts",
      "src/services/csvWriter.ts",
      "tests/routes/exports.test.ts",
      "tests/services/csvWriter.test.ts",
    ],
  },
  {
    human: "Fix timezone handling in scheduled reports",
    type: "bugfix",
    desc: "Reports scheduled in user's timezone fire at UTC offset. Store and convert properly.",
    repo: "acme/backend",
    files: [
      "src/services/scheduler.ts",
      "src/utils/timezone.ts",
      "tests/services/scheduler.test.ts",
      "tests/utils/timezone.test.ts",
    ],
  },
  {
    human: "Add dark mode toggle to settings page",
    type: "feature",
    desc: "Persist theme preference in localStorage. Use CSS custom properties for theming.",
    repo: "acme/frontend",
    files: [
      "src/components/Settings/ThemeToggle.tsx",
      "src/hooks/useTheme.ts",
      "src/styles/themes.css",
      "tests/components/ThemeToggle.test.tsx",
    ],
  },
  {
    human: "Fix infinite re-render in dashboard chart component",
    type: "bugfix",
    desc: "useEffect dependency array missing memoized callback, causing render loop.",
    repo: "acme/frontend",
    files: [
      "src/components/Dashboard/MetricsChart.tsx",
      "src/hooks/useChartData.ts",
      "tests/components/MetricsChart.test.tsx",
    ],
  },
  {
    human: "Implement real-time notifications via SSE",
    type: "feature",
    desc: "Add EventSource connection to notification bell. Reconnect on drop.",
    repo: "acme/frontend",
    files: [
      "src/services/notificationStream.ts",
      "src/components/Notifications/Bell.tsx",
      "src/components/Notifications/Panel.tsx",
      "src/hooks/useNotifications.ts",
      "tests/services/notificationStream.test.ts",
    ],
  },
  {
    human: "Upgrade React Router from v5 to v6",
    type: "refactor",
    desc: "Migrate route definitions, replace useHistory with useNavigate, update guards.",
    repo: "acme/frontend",
    files: [
      "src/routes/index.tsx",
      "src/routes/ProtectedRoute.tsx",
      "src/App.tsx",
      "package.json",
      "tests/routes/index.test.tsx",
    ],
  },
  {
    human: "Add search with debounced autocomplete to user list",
    type: "feature",
    desc: "Debounce input, query backend, render dropdown with keyboard navigation.",
    repo: "acme/frontend",
    files: [
      "src/components/Users/SearchBar.tsx",
      "src/hooks/useDebounce.ts",
      "src/services/userSearch.ts",
      "tests/components/SearchBar.test.tsx",
    ],
  },
  {
    human: "Fix CORS preflight failure on PUT /api/settings",
    type: "bugfix",
    desc: "OPTIONS handler missing for settings route. Browser blocks non-simple requests.",
    repo: "acme/backend",
    files: [
      "src/middleware/cors.ts",
      "src/routes/settings.ts",
      "tests/middleware/cors.test.ts",
    ],
  },
  {
    human: "Add GraphQL subscriptions for live order updates",
    type: "feature",
    desc: "Use graphql-ws transport. Subscribe to order status changes per user.",
    repo: "acme/backend",
    files: [
      "src/graphql/subscriptions/orderStatus.ts",
      "src/graphql/schema.ts",
      "src/graphql/resolvers/order.ts",
      "src/ws/graphqlTransport.ts",
      "tests/graphql/subscriptions/orderStatus.test.ts",
    ],
  },
  {
    human: "Refactor database connection pooling",
    type: "refactor",
    desc: "Replace per-request connections with a shared pool. Add health check and retry logic.",
    repo: "acme/backend",
    files: [
      "src/db/pool.ts",
      "src/db/connection.ts",
      "src/db/healthCheck.ts",
      "tests/db/pool.test.ts",
    ],
  },
  {
    human: "Fix deadlock in checkout flow under concurrent requests",
    type: "bugfix",
    desc: "Two transactions lock inventory and cart rows in opposite order. Reorder acquisitions.",
    repo: "acme/backend",
    files: [
      "src/services/checkoutService.ts",
      "src/repositories/inventoryRepository.ts",
      "src/repositories/cartRepository.ts",
      "tests/services/checkoutService.test.ts",
    ],
  },
  {
    human: "Add webhook retry with exponential backoff",
    type: "feature",
    desc: "Failed webhook deliveries retry up to 5 times with jittered exponential backoff.",
    repo: "acme/backend",
    files: [
      "src/services/webhookService.ts",
      "src/queues/webhookRetry.ts",
      "src/models/WebhookDelivery.ts",
      "tests/services/webhookService.test.ts",
      "tests/queues/webhookRetry.test.ts",
    ],
  },
  {
    human: "Migrate Node.js runtime from 18 to 20",
    type: "chore",
    desc: "Update Dockerfiles, CI matrix, and engine requirements. Drop Node 18 polyfills.",
    repo: "acme/infra",
    files: [
      "Dockerfile",
      ".github/workflows/ci.yml",
      ".node-version",
      "package.json",
    ],
  },
  {
    human: "Add structured audit logging for compliance",
    type: "feature",
    desc: "Log all data mutations with actor, action, resource, and timestamp to audit table.",
    repo: "acme/backend",
    files: [
      "src/middleware/auditLog.ts",
      "src/models/AuditEntry.ts",
      "src/repositories/auditRepository.ts",
      "tests/middleware/auditLog.test.ts",
    ],
  },
  {
    human: "Fix Terraform state drift in staging VPC",
    type: "bugfix",
    desc: "Manual console changes caused drift. Import resources and reconcile state.",
    repo: "acme/infra",
    files: [
      "terraform/staging/vpc.tf",
      "terraform/staging/security_groups.tf",
      "terraform/staging/terraform.tfstate",
    ],
  },
  {
    human: "Set up GitHub Actions matrix for multi-platform Docker builds",
    type: "feature",
    desc: "Build linux/amd64 and linux/arm64 images in CI. Push to ECR.",
    repo: "acme/infra",
    files: [
      ".github/workflows/docker-build.yml",
      ".github/workflows/ci.yml",
      "Dockerfile",
      "docker-compose.ci.yml",
    ],
  },
  {
    human: "Add end-to-end Playwright tests for checkout flow",
    type: "feature",
    desc: "Cover cart addition, address entry, payment, and order confirmation pages.",
    repo: "acme/frontend",
    files: [
      "e2e/checkout.spec.ts",
      "e2e/fixtures/testUser.ts",
      "e2e/pages/CartPage.ts",
      "e2e/pages/CheckoutPage.ts",
      "playwright.config.ts",
    ],
  },
  {
    human: "Optimize slow aggregation query on transactions table",
    type: "bugfix",
    desc: "Monthly summary query takes 12s. Add covering index and rewrite as CTE.",
    repo: "acme/data-pipeline",
    files: [
      "src/queries/monthlySummary.sql",
      "src/migrations/20250115_add_transaction_idx.sql",
      "src/reports/monthlyReport.ts",
      "tests/reports/monthlyReport.test.ts",
    ],
  },
  {
    human: "Add Kafka consumer for real-time event ingestion",
    type: "feature",
    desc: "Consume from 'order-events' topic, transform, and write to analytics store.",
    repo: "acme/data-pipeline",
    files: [
      "src/consumers/orderEvents.ts",
      "src/transforms/orderTransform.ts",
      "src/config/kafka.ts",
      "tests/consumers/orderEvents.test.ts",
    ],
  },
  {
    human: "Fix flaky integration test in CI pipeline",
    type: "bugfix",
    desc: "test_order_creation intermittently fails due to race condition in DB seeding.",
    repo: "acme/backend",
    files: [
      "tests/integration/orderCreation.test.ts",
      "tests/helpers/dbSetup.ts",
      "tests/helpers/factories.ts",
    ],
  },
  {
    human: "Add mobile push notification support via FCM",
    type: "feature",
    desc: "Integrate Firebase Cloud Messaging for order status push notifications to mobile app.",
    repo: "acme/mobile-api",
    files: [
      "src/services/pushNotification.ts",
      "src/config/firebase.ts",
      "src/routes/devices.ts",
      "src/models/DeviceToken.ts",
      "tests/services/pushNotification.test.ts",
    ],
  },
  {
    human: "Implement request/response compression with Brotli",
    type: "feature",
    desc: "Add Brotli compression middleware. Negotiate encoding via Accept-Encoding header.",
    repo: "acme/backend",
    files: [
      "src/middleware/compression.ts",
      "src/config/server.ts",
      "tests/middleware/compression.test.ts",
    ],
  },
];

const TEST_NAMES_BY_TYPE: Record<string, string[]> = {
  bugfix: [
    "should return correct data without N+1 queries",
    "should not leak memory on connection close",
    "should handle concurrent requests without deadlock",
    "should respect timezone offsets in scheduling",
    "should reject spoofed proxy headers",
    "should execute query within acceptable time",
    "should clean up event listeners on disconnect",
    "should not fire duplicate scheduled jobs",
    "should handle edge case with empty result set",
    "should return 200 for valid input",
    "should propagate errors correctly",
    "should apply fix to all affected code paths",
  ],
  feature: [
    "should paginate results with cursor",
    "should return next page token",
    "should create resource successfully",
    "should enforce RBAC on admin endpoints",
    "should stream CSV without loading all rows",
    "should debounce search input by 300ms",
    "should reconnect SSE on connection drop",
    "should export correct CSV headers",
    "should handle empty dataset gracefully",
    "should validate request body schema",
    "should return 201 on successful creation",
    "should send notification on status change",
    "should retry failed webhook delivery",
    "should respect backoff schedule",
    "should render component without errors",
  ],
  refactor: [
    "should maintain backward compatibility",
    "should pass all existing integration tests",
    "should issue JWT on successful login",
    "should reject expired tokens",
    "should rotate refresh tokens",
    "should use connection pool instead of per-request",
    "should handle pool exhaustion gracefully",
    "should return same results as before refactor",
    "should not change public API surface",
    "should handle edge cases in new implementation",
  ],
  chore: [
    "should build successfully on Node 20",
    "should pass CI on all matrix targets",
    "should generate valid Docker image",
    "should run migrations without errors",
    "should not break existing functionality",
  ],
};

const ERROR_MESSAGES = [
  "TypeError: Cannot read properties of undefined (reading 'map')",
  "Error: ECONNREFUSED 127.0.0.1:5432",
  "AssertionError: expected 200 to equal 201",
  "Error: Query timeout after 30000ms",
  "RangeError: Maximum call stack size exceeded",
  "Error: ENOMEM - not enough memory",
  "SyntaxError: Unexpected token '<' in JSON at position 0",
  "Error: connect ETIMEDOUT 10.0.0.5:443",
  "Error: Invariant violation: rendered more hooks than expected",
  "Error: deadlock detected - process 1234 blocked on 5678",
];

const FAIL_REASONS = [
  "3 of 12 tests failing — regression in auth middleware",
  "Build failed: TypeScript strict mode violations in 4 files",
  "Integration test timed out waiting for database connection",
  "Memory usage exceeded 512MB limit during test suite",
  "Lint errors: 7 unused imports, 2 any-typed parameters",
  "Security scan flagged: potential SQL injection in query builder",
  "E2E test failed: checkout button not found within 10s timeout",
  "Type error: Argument of type 'string' is not assignable to parameter of type 'UserId'",
];

const BLOCK_REASONS = [
  "Modifies infrastructure files — requires platform team approval",
  "Cost exceeded $5.00 ceiling ($6.47 spent) — needs budget approval",
  "Touches restricted path .github/workflows/ — requires security review",
  "25 files modified — exceeds file count limit of 20",
  "Database migration detected — requires DBA sign-off",
];

const CANCEL_REASONS = [
  "Superseded by newer run on same branch",
  "User cancelled — requirements changed mid-task",
  "Branch was deleted",
  "Duplicate of run_3a8f on same PR",
];

const APPROVAL_ACTORS = [
  "sarah.chen",
  "mike.rodriguez",
  "priya.patel",
  "james.kim",
  "auto-merge-bot",
] as const;

const DIFF_SNIPPETS = [
  `--- a/src/routes/dashboard.ts
+++ b/src/routes/dashboard.ts
@@ -23,8 +23,12 @@ export async function getDashboard(req: Request, res: Response) {
-  const users = await db.query('SELECT * FROM users');
-  for (const user of users) {
-    user.orders = await db.query('SELECT * FROM orders WHERE user_id = ?', [user.id]);
-  }
+  const users = await db.query(\`
+    SELECT u.*, json_agg(o.*) as orders
+    FROM users u
+    LEFT JOIN orders o ON o.user_id = u.id
+    GROUP BY u.id
+    ORDER BY u.created_at DESC
+    LIMIT $1 OFFSET $2
+  \`, [limit, offset]);`,

  `--- a/src/middleware/auth.ts
+++ b/src/middleware/auth.ts
@@ -1,6 +1,7 @@
-import session from 'express-session';
+import jwt from 'jsonwebtoken';
+import { TokenService } from '../services/tokenService';

 export function authMiddleware(req: Request, res: Response, next: NextFunction) {
-  if (!req.session?.userId) {
-    return res.status(401).json({ error: 'Not authenticated' });
+  const token = req.headers.authorization?.replace('Bearer ', '');
+  if (!token) {
+    return res.status(401).json({ error: 'Missing authentication token' });
   }
+  try {
+    const payload = TokenService.verify(token);
+    req.userId = payload.sub;
+    next();
+  } catch (err) {
+    return res.status(401).json({ error: 'Invalid or expired token' });
   }`,

  `--- a/src/services/paymentService.ts
+++ b/src/services/paymentService.ts
@@ -45,10 +45,15 @@ export class PaymentService {
   async processPayment(orderId: string, amount: number): Promise<PaymentResult> {
-    try {
-      const result = await this.stripe.charges.create({ amount, currency: 'usd' });
-      return result;
-    } catch (err) {
-      console.error('Payment failed', err);
-      throw err;
-    }
+    const charge = await this.stripe.charges.create({
+      amount,
+      currency: 'usd',
+      idempotencyKey: \`order_\${orderId}\`,
+    }).catch((err: Stripe.StripeError) => {
+      throw new PaymentError(err.code, err.message, { orderId, amount });
+    });
+
+    this.logger.info('payment.processed', { orderId, chargeId: charge.id });
+    return { chargeId: charge.id, status: charge.status };`,

  `--- a/src/ws/connectionManager.ts
+++ b/src/ws/connectionManager.ts
@@ -18,6 +18,8 @@ export class ConnectionManager {
   handleDisconnect(socket: WebSocket) {
     const connId = this.connections.get(socket);
-    this.connections.delete(socket);
+    socket.removeAllListeners();
+    clearInterval(this.heartbeats.get(connId));
+    this.heartbeats.delete(connId);
+    this.connections.delete(socket);
     this.logger.debug('ws.disconnect', { connId });
   }`,

  `--- a/src/middleware/rateLimiter.ts
+++ b/src/middleware/rateLimiter.ts
@@ -8,7 +8,12 @@ export function rateLimiter(opts: RateLimitOpts) {
   return (req: Request, res: Response, next: NextFunction) => {
-    const ip = req.headers['x-forwarded-for'] as string || req.ip;
+    const trustedProxies = config.get('trustedProxies') as string[];
+    let ip = req.ip;
+    if (trustedProxies.includes(req.ip)) {
+      const forwarded = req.headers['x-forwarded-for'];
+      ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip;
+    }
     const key = \`rate:\${ip}\`;`,

  `--- a/terraform/staging/vpc.tf
+++ b/terraform/staging/vpc.tf
@@ -12,6 +12,10 @@ resource "aws_vpc" "staging" {
   cidr_block = "10.0.0.0/16"
+
+  tags = {
+    Environment = "staging"
+    ManagedBy   = "terraform"
+    Team        = "platform"
+  }
 }

+resource "aws_vpc_endpoint" "s3" {
+  vpc_id       = aws_vpc.staging.id
+  service_name = "com.amazonaws.us-east-1.s3"
+}`,

  `--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -15,7 +15,10 @@ jobs:
     strategy:
       matrix:
-        node-version: [18.x]
+        node-version: [20.x]
+        platform: [linux/amd64, linux/arm64]
     steps:
       - uses: actions/checkout@v4
-      - uses: actions/setup-node@v3
+      - uses: actions/setup-node@v4
         with:
           node-version: \${{ matrix.node-version }}`,

  `--- a/src/services/orderService.ts
+++ b/src/services/orderService.ts
@@ -1,5 +1,7 @@
 import { db } from '../db';
+import { trace, SpanStatusCode } from '@opentelemetry/api';

+const tracer = trace.getTracer('order-service');

 export class OrderService {
   async createOrder(userId: string, items: CartItem[]): Promise<Order> {
+    return tracer.startActiveSpan('createOrder', async (span) => {
+      span.setAttribute('user.id', userId);
+      span.setAttribute('order.item_count', items.length);
       const order = await db.transaction(async (tx) => {`,
];

const LOG_SNIPPETS = [
  `[2025-01-28T14:32:11Z] INFO  Starting run — goal: "Fix N+1 query in user dashboard"
[2025-01-28T14:32:12Z] INFO  Agent claude-sonnet-4-5 reading src/routes/dashboard.ts
[2025-01-28T14:32:15Z] INFO  Identified 3 N+1 patterns in getDashboard handler
[2025-01-28T14:32:18Z] INFO  Rewriting queries with JOIN + json_agg
[2025-01-28T14:32:45Z] INFO  Running test suite: npm test -- --grep dashboard
[2025-01-28T14:33:02Z] INFO  12/12 tests passing
[2025-01-28T14:33:03Z] INFO  Run completed successfully`,

  `[2025-02-01T09:15:03Z] INFO  Agent gpt-4o analyzing auth middleware
[2025-02-01T09:15:08Z] WARN  express-session detected — replacing with JWT
[2025-02-01T09:15:22Z] INFO  Creating src/services/tokenService.ts
[2025-02-01T09:15:45Z] INFO  Updating 14 route handlers to use Bearer token
[2025-02-01T09:16:30Z] INFO  Running tests...
[2025-02-01T09:16:58Z] ERROR test_refresh_token_rotation FAILED
[2025-02-01T09:17:05Z] INFO  Fixing: refresh token was not invalidated after use
[2025-02-01T09:17:30Z] INFO  All 18 tests passing after fix`,

  `[2025-02-03T16:44:00Z] INFO  Starting checkout deadlock investigation
[2025-02-03T16:44:03Z] INFO  Reading src/services/checkoutService.ts
[2025-02-03T16:44:05Z] WARN  Lock ordering: cart -> inventory (inconsistent with inventoryRepo)
[2025-02-03T16:44:10Z] INFO  Reordering: always acquire inventory lock first
[2025-02-03T16:44:25Z] INFO  Adding advisory lock with timeout
[2025-02-03T16:44:50Z] INFO  Running concurrent checkout stress test (50 threads)
[2025-02-03T16:45:20Z] INFO  0 deadlocks in 500 iterations — fix verified`,

  `[2025-02-05T11:20:00Z] ERROR Agent exceeded cost ceiling ($6.47 > $5.00)
[2025-02-05T11:20:01Z] WARN  Blocking run — policy "cost-ceiling" violated
[2025-02-05T11:20:01Z] INFO  22 files already modified — rolling back is not automatic
[2025-02-05T11:20:02Z] INFO  Run blocked, awaiting budget approval`,

  `[2025-02-06T08:00:15Z] INFO  CI agent running npm test
[2025-02-06T08:01:02Z] FAIL  tests/integration/orderCreation.test.ts
  ✗ should create order with valid items (timeout 30000ms exceeded)
  ✗ should roll back on payment failure (expected 0 rows, got 1)
  ✓ should reject empty cart
[2025-02-06T08:01:03Z] ERROR 2 of 15 integration tests failed
[2025-02-06T08:01:03Z] INFO  Investigating: DB seeding race condition in beforeEach`,
];

const TEST_OUTPUT_SNIPPETS = [
  ` PASS  tests/routes/dashboard.test.ts
  GET /api/dashboard
    ✓ should return dashboard data (45ms)
    ✓ should include user orders via JOIN (38ms)
    ✓ should respect pagination params (22ms)
    ✓ should return 401 without auth (8ms)
    ✓ should handle empty user list (15ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Time:        1.847s`,

  ` FAIL  tests/services/paymentService.test.ts
  PaymentService
    ✓ should process payment successfully (120ms)
    ✓ should handle Stripe errors with typed PaymentError (35ms)
    ✗ should retry on network timeout (245ms)
      Error: expected retry count to be 3, received 0
    ✓ should log payment events (18ms)
    ✓ should use idempotency key (42ms)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 4 passed, 5 total
Time:        2.103s`,

  ` PASS  tests/middleware/auth.test.ts
  Auth Middleware (JWT)
    ✓ should accept valid Bearer token (12ms)
    ✓ should reject expired token (8ms)
    ✓ should reject malformed token (5ms)
    ✓ should extract userId from payload (10ms)
    ✓ should return 401 without Authorization header (4ms)
    ✓ should handle token refresh (28ms)
    ✓ should invalidate old refresh token (15ms)
    ✓ should reject reused refresh token (9ms)

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Time:        0.934s`,

  ` PASS  tests/middleware/rateLimiter.test.ts
  Rate Limiter
    ✓ should limit by real client IP (15ms)
    ✓ should not trust X-Forwarded-For from untrusted proxy (8ms)
    ✓ should trust X-Forwarded-For from known LB (10ms)
    ✓ should return 429 after limit exceeded (22ms)
    ✓ should reset after window expires (1015ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Time:        1.244s`,

  ` FAIL  tests/integration/orderCreation.test.ts
  Order Creation (integration)
    ✓ should reject empty cart (25ms)
    ✗ should create order with valid items (30045ms)
      Timeout: operation timed out after 30000ms
    ✗ should roll back on payment failure (180ms)
      Expected: 0 rows in orders table
      Received: 1 row (stale from previous test)
    ✓ should calculate totals correctly (35ms)
    ✓ should apply discount codes (42ms)

Test Suites: 1 failed, 1 total
Tests:       2 failed, 3 passed, 5 total
Time:        32.485s`,
];

// ─── Policy definitions ─────────────────────────────────────────────────────

function buildPolicies(): Policy[] {
  return [
    {
      id: createPolicyId("pol_path_infra"),
      name: "Block infrastructure changes",
      type: PolicyType.PathRestriction,
      config: {
        type: PolicyType.PathRestriction,
        blockedPaths: ["/infra/", "terraform/", ".github/workflows/"],
      },
      severity: PolicySeverity.Error,
    },
    {
      id: createPolicyId("pol_path_deploy"),
      name: "Block deployment config changes",
      type: PolicyType.PathRestriction,
      config: {
        type: PolicyType.PathRestriction,
        blockedPaths: ["/deploy/", "k8s/", "helm/"],
      },
      severity: PolicySeverity.Warning,
    },
    {
      id: createPolicyId("pol_file_limit"),
      name: "File count limit (max 20)",
      type: PolicyType.FileLimitCount,
      config: {
        type: PolicyType.FileLimitCount,
        maxFiles: 20,
      },
      severity: PolicySeverity.Error,
    },
    {
      id: createPolicyId("pol_cost_ceiling"),
      name: "Cost ceiling ($5.00)",
      type: PolicyType.CostCeiling,
      config: {
        type: PolicyType.CostCeiling,
        maxCostUsd: 5.0,
      },
      severity: PolicySeverity.Error,
    },
    {
      id: createPolicyId("pol_test_enforce"),
      name: "Require passing tests",
      type: PolicyType.TestEnforcement,
      config: {
        type: PolicyType.TestEnforcement,
        requirePassing: true,
        minCoverage: 80,
      },
      severity: PolicySeverity.Error,
    },
    {
      id: createPolicyId("pol_risky_migration"),
      name: "Flag database migrations",
      type: PolicyType.RiskyOpFlag,
      config: {
        type: PolicyType.RiskyOpFlag,
        riskyPatterns: [
          "migrate",
          "ALTER TABLE",
          "DROP TABLE",
          "CREATE INDEX",
          "drizzle-kit push",
        ],
      },
      severity: PolicySeverity.Warning,
    },
    {
      id: createPolicyId("pol_risky_force"),
      name: "Flag force push and destructive git ops",
      type: PolicyType.RiskyOpFlag,
      config: {
        type: PolicyType.RiskyOpFlag,
        riskyPatterns: [
          "git push --force",
          "git reset --hard",
          "rm -rf",
          "DROP DATABASE",
        ],
      },
      severity: PolicySeverity.Error,
    },
  ];
}

// ─── Run generation ─────────────────────────────────────────────────────────

function buildAgents(count: number): Agent[] {
  const roles = [AgentRole.Lead, AgentRole.Implementer, AgentRole.Reviewer, AgentRole.CI];
  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    agents.push({
      id: createAgentId(`agent_${uid()}`),
      model: pick(MODELS),
      role: roles[i] ?? AgentRole.Implementer,
    });
  }
  return agents;
}

function buildToolCalls(files: string[], timestamp: Date): Action["toolCalls"] {
  const tools = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"];
  const calls: Action["toolCalls"][number][] = [];
  const count = randInt(1, 4);

  for (let i = 0; i < count; i++) {
    const tool = pick(tools);
    const file = pick(files);
    const ts = minutesAfter(timestamp, i, i + 2);

    if (tool === "Read") {
      calls.push({
        name: "Read",
        input: { file_path: file },
        output: `Read ${randInt(50, 400)} lines from ${file}`,
        timestamp: ts.toISOString(),
      });
    } else if (tool === "Edit") {
      calls.push({
        name: "Edit",
        input: { file_path: file, old_string: "// ...", new_string: "// updated" },
        output: `Edited ${file}`,
        timestamp: ts.toISOString(),
      });
    } else if (tool === "Write") {
      calls.push({
        name: "Write",
        input: { file_path: file, content: "..." },
        output: `Wrote ${randInt(20, 200)} lines to ${file}`,
        timestamp: ts.toISOString(),
      });
    } else if (tool === "Bash") {
      const cmds = ["npm test", "npm run lint", "npm run build", "git diff --stat", "npx tsc --noEmit"];
      calls.push({
        name: "Bash",
        input: { command: pick(cmds) },
        output: "exit code 0",
        timestamp: ts.toISOString(),
      });
    } else if (tool === "Grep") {
      calls.push({
        name: "Grep",
        input: { pattern: pick(["TODO", "FIXME", "import.*from", "async function"]), path: "src/" },
        output: `Found ${randInt(2, 15)} matches`,
        timestamp: ts.toISOString(),
      });
    } else {
      calls.push({
        name: "Glob",
        input: { pattern: "**/*.ts" },
        output: `Found ${randInt(10, 80)} files`,
        timestamp: ts.toISOString(),
      });
    }
  }

  return calls;
}

function buildFileEdits(files: string[], timestamp: Date): Action["fileEdits"] {
  const editFiles = pickN(files, 1, Math.min(files.length, 4));
  return editFiles.map((path, i) => ({
    path,
    diff: pick(DIFF_SNIPPETS),
    timestamp: minutesAfter(timestamp, i + 1, i + 3).toISOString(),
  }));
}

function buildCommands(
  goalType: string,
  timestamp: Date,
  shouldFail: boolean,
): Action["commands"] {
  const cmds: Action["commands"][number][] = [];

  cmds.push({
    command: "npm test",
    exitCode: shouldFail ? 1 : 0,
    stdout: shouldFail
      ? pick(TEST_OUTPUT_SNIPPETS.filter((s) => s.includes("FAIL")))
      : pick(TEST_OUTPUT_SNIPPETS.filter((s) => s.includes(" PASS"))),
    stderr: shouldFail ? pick(ERROR_MESSAGES) : "",
    timestamp: minutesAfter(timestamp, 2, 5).toISOString(),
  });

  if (goalType === "refactor" || goalType === "feature") {
    cmds.push({
      command: "npx tsc --noEmit",
      exitCode: 0,
      stdout: "",
      stderr: "",
      timestamp: minutesAfter(timestamp, 5, 7).toISOString(),
    });
  }

  cmds.push({
    command: "git diff --stat",
    exitCode: 0,
    stdout: ` ${randInt(2, 12)} files changed, ${randInt(15, 250)} insertions(+), ${randInt(5, 80)} deletions(-)`,
    stderr: "",
    timestamp: minutesAfter(timestamp, 7, 9).toISOString(),
  });

  return cmds;
}

function buildActions(
  goalType: string,
  files: string[],
  createdAt: Date,
  status: RunStatus,
): Action[] {
  const actionCount = status === RunStatus.Running ? randInt(1, 3) : randInt(2, 8);
  const shouldFail = status === RunStatus.Failed;
  const actions: Action[] = [];

  for (let i = 0; i < actionCount; i++) {
    const ts = minutesAfter(createdAt, i * 2, i * 3 + 2);
    actions.push({
      id: createActionId(`act_${uid()}`),
      toolCalls: buildToolCalls(files, ts),
      fileEdits: i < actionCount - 1 || status !== RunStatus.Running
        ? buildFileEdits(files, ts)
        : [],
      commands:
        i === actionCount - 1
          ? buildCommands(goalType, ts, shouldFail)
          : [],
      timestamp: ts.toISOString(),
    });
  }

  return actions;
}

function buildArtifacts(status: RunStatus): Artifact[] {
  if (status === RunStatus.Running || status === RunStatus.Cancelled) {
    return [];
  }
  const count = randInt(1, 3);
  const artifacts: Artifact[] = [];

  for (let i = 0; i < count; i++) {
    artifacts.push({
      id: createArtifactId(`art_${uid()}`),
      diffs: [pick(DIFF_SNIPPETS)],
      logs: [pick(LOG_SNIPPETS)],
      testOutputs:
        status !== RunStatus.Blocked ? [pick(TEST_OUTPUT_SNIPPETS)] : [],
      reports: [],
    });
  }

  return artifacts;
}

function buildTestResults(
  goalType: string,
  shouldPass: boolean,
): Evaluation["testResults"] {
  const pool = TEST_NAMES_BY_TYPE[goalType] ?? TEST_NAMES_BY_TYPE["feature"]!;
  const testNames = pickN(pool, 3, Math.min(pool.length, 12));

  return testNames.map((name, i) => {
    const passes = shouldPass ? true : i < testNames.length - randInt(1, 3);
    return {
      name,
      passed: passes,
      duration: randInt(5, 2000),
      message: passes ? "" : pick(ERROR_MESSAGES),
    };
  });
}

function buildEvaluations(
  goalType: string,
  status: RunStatus,
  policies: Policy[],
  run: Run,
): Evaluation[] {
  if (status === RunStatus.Running || status === RunStatus.Cancelled) {
    return [];
  }

  const shouldPass = status === RunStatus.Completed;
  const testResults = buildTestResults(goalType, shouldPass);

  const engine = new PolicyEngine();
  const policyCheckResults = engine.evaluate(run, policies);

  const policyChecks = policyCheckResults.map((r) => ({
    policyId: r.policy.id,
    passed: r.passed,
    message: r.message,
  }));

  const passingTests = testResults.filter((t) => t.passed).length;
  const totalTests = testResults.length;
  const confidenceScore = shouldPass
    ? randFloat(0.75, 0.98)
    : randFloat(0.15, 0.55);

  return [
    {
      testResults,
      policyChecks,
      confidenceScore,
    },
  ];
}

function buildDecisions(
  status: RunStatus,
  createdAt: Date,
): Decision[] {
  if (status === RunStatus.Completed) {
    return [
      {
        id: createDecisionId(`dec_${uid()}`),
        type: DecisionType.Approval,
        actor: pick(APPROVAL_ACTORS),
        reason: pick([
          "All tests passing, policy checks green — auto-approved",
          "LGTM — reviewed changes, merging",
          "Approved after manual review of diff",
          "CI passed, code owner approved",
        ]),
        timestamp: minutesAfter(createdAt, 10, 20).toISOString(),
      },
    ];
  }

  if (status === RunStatus.Failed) {
    return [
      {
        id: createDecisionId(`dec_${uid()}`),
        type: DecisionType.Block,
        actor: "system",
        reason: pick(FAIL_REASONS),
        timestamp: minutesAfter(createdAt, 5, 15).toISOString(),
      },
    ];
  }

  if (status === RunStatus.Blocked) {
    return [
      {
        id: createDecisionId(`dec_${uid()}`),
        type: DecisionType.Escalation,
        actor: pick(APPROVAL_ACTORS),
        reason: pick(BLOCK_REASONS),
        timestamp: minutesAfter(createdAt, 3, 10).toISOString(),
      },
    ];
  }

  return [];
}

function buildMetrics(status: RunStatus, actionCount: number): Metrics {
  const inputTokens = randInt(5000, 180000);
  const outputTokens = randInt(2000, 60000);
  const costBase = (inputTokens * 0.000003 + outputTokens * 0.000015);
  // Add some variance
  const costUsd =
    status === RunStatus.Running
      ? randFloat(0.05, 2.5)
      : parseFloat((costBase * randFloat(0.8, 1.4)).toFixed(2));

  return {
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    },
    wallTimeMs:
      status === RunStatus.Running
        ? randInt(30000, 120000)
        : randInt(30000, 900000),
    costUsd: Math.max(0.05, costUsd),
    flakeRate: randFloat(0, 0.12),
  };
}

interface RunBlueprint {
  status: RunStatus;
  daysAgoRange: [number, number];
}

function generateRun(
  blueprint: RunBlueprint,
  policies: Policy[],
  index: number,
): Run {
  const goal = GOALS[index % GOALS.length]!;
  const createdAt = daysAgo(randInt(blueprint.daysAgoRange[0], blueprint.daysAgoRange[1]));
  const branch = pick(BRANCHES);

  const agents = buildAgents(randInt(1, 3));
  const environment = {
    repo: goal.repo,
    branch,
    permissions: ["read", "write", "execute"],
    sandbox: {
      enabled: true,
      isolationLevel: pick(["container", "vm", "process"]),
    },
  };

  const actions = buildActions(goal.type, goal.files, createdAt, blueprint.status);
  const artifacts = buildArtifacts(blueprint.status);
  const metrics = buildMetrics(blueprint.status, actions.length);
  const decisions = buildDecisions(blueprint.status, createdAt);

  const updatedAt =
    blueprint.status === RunStatus.Running
      ? new Date()
      : minutesAfter(createdAt, 5, 25);

  // Build a partial run for policy evaluation
  const partialRun: Run = {
    id: createRunId(`run_${uid()}`),
    status: blueprint.status,
    goal: {
      humanReadable: goal.human,
      structured: {
        type: goal.type,
        description: goal.desc,
        parameters: {},
      },
    },
    agents,
    environment,
    actions,
    artifacts,
    metrics,
    evaluations: [],
    decisions,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };

  // Now build evaluations (which depend on the run for policy checks)
  const evaluations = buildEvaluations(goal.type, blueprint.status, policies, partialRun);

  return {
    ...partialRun,
    evaluations,
  };
}

// ─── Orchestration seed functions (populated by workstream agents) ──────────

function seedJobs(db: AgentOpsDb): number {
  const JOB_STATUSES = ["queued", "dispatched", "running", "completed", "failed", "cancelled"] as const;
  const JOB_PRIORITIES = ["critical", "high", "normal", "low"] as const;

  interface JobBlueprint {
    status: (typeof JOB_STATUSES)[number];
    priority: (typeof JOB_PRIORITIES)[number];
  }

  const blueprints: JobBlueprint[] = [
    // 5 queued
    { status: "queued", priority: "critical" },
    { status: "queued", priority: "high" },
    { status: "queued", priority: "normal" },
    { status: "queued", priority: "normal" },
    { status: "queued", priority: "low" },
    // 3 dispatched
    { status: "dispatched", priority: "high" },
    { status: "dispatched", priority: "normal" },
    { status: "dispatched", priority: "normal" },
    // 4 running
    { status: "running", priority: "critical" },
    { status: "running", priority: "high" },
    { status: "running", priority: "normal" },
    { status: "running", priority: "normal" },
    // 10 completed
    { status: "completed", priority: "critical" },
    { status: "completed", priority: "high" },
    { status: "completed", priority: "high" },
    { status: "completed", priority: "normal" },
    { status: "completed", priority: "normal" },
    { status: "completed", priority: "normal" },
    { status: "completed", priority: "normal" },
    { status: "completed", priority: "normal" },
    { status: "completed", priority: "low" },
    { status: "completed", priority: "low" },
    // 4 failed
    { status: "failed", priority: "high" },
    { status: "failed", priority: "normal" },
    { status: "failed", priority: "normal" },
    { status: "failed", priority: "low" },
    // 2 cancelled
    { status: "cancelled", priority: "normal" },
    { status: "cancelled", priority: "low" },
  ];

  let count = 0;
  for (let i = 0; i < blueprints.length; i++) {
    const bp = blueprints[i]!;
    const goal = GOALS[i % GOALS.length]!;
    const createdAt = daysAgo(randInt(0, 21));
    const branch = pick(BRANCHES);

    const queuedAt = createdAt;
    const dispatchedAt = ["dispatched", "running", "completed", "failed"].includes(bp.status)
      ? minutesAfter(createdAt, 1, 5)
      : null;
    const completedAt = bp.status === "completed"
      ? minutesAfter(createdAt, 10, 30)
      : null;

    const attempt = bp.status === "failed" ? randInt(1, 3) : 0;
    const maxAttempts = 3;

    db.insert(jobs)
      .values({
        id: `job_${uid()}`,
        status: bp.status,
        priority: bp.priority,
        goal: {
          humanReadable: goal.human,
          structured: { type: goal.type, description: goal.desc, parameters: {} },
        } as unknown as Record<string, unknown>,
        environment: {
          repo: goal.repo,
          branch,
          permissions: ["read", "write"],
          sandbox: { enabled: true, isolationLevel: "container" },
        } as unknown as Record<string, unknown>,
        repo: goal.repo,
        branch,
        retryPolicy: {
          maxRetries: 3,
          backoffMs: 1000,
          backoffMultiplier: 2,
        } as unknown as Record<string, unknown>,
        concurrencyLimits: {
          perRepo: 5,
          perOrg: 10,
          global: 50,
        } as unknown as Record<string, unknown>,
        runIds: (bp.status === "running" || bp.status === "completed" || bp.status === "failed"
          ? [`run_${uid()}`]
          : []) as unknown as Record<string, unknown>,
        sessionId: ["dispatched", "running"].includes(bp.status) ? `session_${uid()}` : null,
        attempt,
        maxAttempts,
        queuedAt: queuedAt.toISOString(),
        dispatchedAt: dispatchedAt?.toISOString() ?? null,
        completedAt: completedAt?.toISOString() ?? null,
        createdAt: createdAt.toISOString(),
        updatedAt: (completedAt ?? dispatchedAt ?? createdAt).toISOString(),
      })
      .run();
    count++;
  }

  return count;
}

function seedSessions(db: AgentOpsDb): number {
  const AGENT_NAMES = [
    "claude-lead-01",
    "claude-impl-02",
    "claude-impl-03",
    "gpt4o-reviewer-01",
    "claude-ci-01",
    "claude-impl-04",
    "gpt4o-impl-05",
    "claude-lead-02",
    "claude-reviewer-02",
    "claude-impl-06",
  ] as const;

  interface SessionBlueprint {
    status: SessionStatus;
    daysAgoRange: [number, number];
    hasCurrentRun: boolean;
    completedRunCount: number;
  }

  const blueprints: SessionBlueprint[] = [
    // 5 active
    { status: SessionStatus.Active, daysAgoRange: [0, 1], hasCurrentRun: true, completedRunCount: randInt(1, 5) },
    { status: SessionStatus.Active, daysAgoRange: [0, 1], hasCurrentRun: true, completedRunCount: randInt(0, 3) },
    { status: SessionStatus.Active, daysAgoRange: [0, 2], hasCurrentRun: false, completedRunCount: randInt(2, 6) },
    { status: SessionStatus.Active, daysAgoRange: [0, 1], hasCurrentRun: true, completedRunCount: randInt(0, 2) },
    { status: SessionStatus.Active, daysAgoRange: [0, 3], hasCurrentRun: false, completedRunCount: randInt(3, 8) },
    // 2 paused
    { status: SessionStatus.Paused, daysAgoRange: [1, 5], hasCurrentRun: false, completedRunCount: randInt(1, 4) },
    { status: SessionStatus.Paused, daysAgoRange: [2, 7], hasCurrentRun: false, completedRunCount: randInt(2, 5) },
    // 3 terminated
    { status: SessionStatus.Terminated, daysAgoRange: [3, 14], hasCurrentRun: false, completedRunCount: randInt(3, 10) },
    { status: SessionStatus.Terminated, daysAgoRange: [5, 20], hasCurrentRun: false, completedRunCount: randInt(1, 6) },
    { status: SessionStatus.Terminated, daysAgoRange: [7, 25], hasCurrentRun: false, completedRunCount: randInt(4, 12) },
  ];

  for (let i = 0; i < blueprints.length; i++) {
    const bp = blueprints[i]!;
    const agentName = AGENT_NAMES[i % AGENT_NAMES.length]!;
    const createdAt = daysAgo(randInt(bp.daysAgoRange[0], bp.daysAgoRange[1]));
    const startedAt = minutesAfter(createdAt, 0, 2);

    const completedRunIds: string[] = [];
    for (let j = 0; j < bp.completedRunCount; j++) {
      completedRunIds.push(`run_sess_${uid()}`);
    }

    const currentRunId = bp.hasCurrentRun ? `run_sess_current_${uid()}` : null;

    const lastHeartbeatAt = bp.status === SessionStatus.Active
      ? minutesAfter(new Date(), -randInt(0, 5), 0)
      : bp.status === SessionStatus.Paused
        ? minutesAfter(createdAt, 60, 180)
        : minutesAfter(createdAt, 30, 120);

    const terminatedAt = bp.status === SessionStatus.Terminated
      ? minutesAfter(createdAt, 30, 240)
      : null;

    const updatedAt = terminatedAt
      ? terminatedAt
      : bp.status === SessionStatus.Active
        ? lastHeartbeatAt
        : minutesAfter(createdAt, 20, 60);

    insertSession(db, {
      id: createSessionId(`session_${uid()}`),
      status: bp.status,
      agentId: createAgentId(agentName),
      currentRunId: currentRunId ? createRunId(currentRunId) : null,
      completedRunIds: completedRunIds.map(createRunId),
      resourceUsage: {
        memoryMb: randInt(128, 1024),
        cpuPercent: randFloat(5, 85),
        tokensBudgetRemaining: randInt(10000, 400000),
        costBudgetRemaining: randFloat(1, 25),
      },
      metadata: {
        environment: pick(["development", "staging", "production"]),
        model: pick(MODELS),
      },
      startedAt: startedAt.toISOString(),
      lastHeartbeatAt: lastHeartbeatAt.toISOString(),
      terminatedAt: terminatedAt ? terminatedAt.toISOString() : null,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  }

  return blueprints.length;
}

function seedEvents(db: AgentOpsDb): number {
  const EVENT_DEFS: Array<{ category: string; type: string; sourcePrefix: string; payloadFn: () => Record<string, unknown> }> = [
    { category: EventCategory.Job, type: "job.queued", sourcePrefix: "job_", payloadFn: () => ({ priority: pick(["critical", "high", "normal", "low"]), repo: pick(REPOS) }) },
    { category: EventCategory.Job, type: "job.dispatched", sourcePrefix: "job_", payloadFn: () => ({ sessionId: `session_${uid()}`, dispatchedAt: new Date().toISOString() }) },
    { category: EventCategory.Job, type: "job.completed", sourcePrefix: "job_", payloadFn: () => ({ durationMs: randInt(30000, 600000), runCount: randInt(1, 5) }) },
    { category: EventCategory.Job, type: "job.failed", sourcePrefix: "job_", payloadFn: () => ({ reason: pick(["timeout", "crash", "policy violation", "resource exhaustion"]), attempt: randInt(1, 3) }) },
    { category: EventCategory.Run, type: "run.started", sourcePrefix: "run_", payloadFn: () => ({ repo: pick(REPOS), branch: pick(BRANCHES) }) },
    { category: EventCategory.Run, type: "run.completed", sourcePrefix: "run_", payloadFn: () => ({ durationMs: randInt(30000, 900000), costUsd: randFloat(0.10, 4.50) }) },
    { category: EventCategory.Run, type: "run.failed", sourcePrefix: "run_", payloadFn: () => ({ error: pick(["test failure", "build error", "lint violation", "timeout"]), testsRun: randInt(5, 50) }) },
    { category: EventCategory.Session, type: "session.started", sourcePrefix: "session_", payloadFn: () => ({ agentId: `agent_${uid()}`, model: pick(MODELS) }) },
    { category: EventCategory.Session, type: "session.paused", sourcePrefix: "session_", payloadFn: () => ({ reason: pick(["cost limit", "manual pause", "awaiting approval"]) }) },
    { category: EventCategory.Session, type: "session.terminated", sourcePrefix: "session_", payloadFn: () => ({ reason: pick(["completed", "idle timeout", "manual termination", "error"]) }) },
    { category: EventCategory.Policy, type: "policy.violated", sourcePrefix: "run_", payloadFn: () => ({ policyName: pick(["cost ceiling", "path restriction", "file limit", "test enforcement"]), severity: pick(["error", "warning"]) }) },
    { category: EventCategory.Cost, type: "cost.threshold", sourcePrefix: "run_", payloadFn: () => ({ currentCost: randFloat(3.00, 8.00), threshold: 5.00, currency: "USD" }) },
    { category: EventCategory.Action, type: "action.taken", sourcePrefix: "run_", payloadFn: () => ({ actionType: pick(["file_edit", "command", "tool_call"]), fileCount: randInt(1, 10) }) },
  ];

  const TARGET_COUNT = 130;
  let count = 0;

  for (let i = 0; i < TARGET_COUNT; i++) {
    const def = pick(EVENT_DEFS);
    const daysBack = randInt(0, 28);
    const ts = daysAgo(daysBack, randInt(0, 23));

    insertEvent(db, {
      id: createEventId(`evt_${uid()}`),
      category: def.category as EventCategory,
      type: def.type,
      sourceId: `${def.sourcePrefix}${uid()}`,
      payload: def.payloadFn(),
      timestamp: ts.toISOString(),
    });
    count++;
  }

  return count;
}

function seedLocks(db: AgentOpsDb): number {
  const LOCK_TYPES = ["repo", "path", "branch"] as const;
  const LOCK_RESOURCES = [
    "acme/backend",
    "acme/frontend",
    "acme/infra",
    "acme/backend/src/routes/",
    "acme/backend/src/services/",
    "acme/frontend/src/components/",
    "main",
    "develop",
    "feat/add-pagination",
    "fix/n-plus-one-query",
    "refactor/auth-to-jwt",
  ] as const;
  const LOCK_HOLDERS = [
    "agent_lead_01",
    "agent_impl_02",
    "agent_impl_03",
    "agent_review_04",
    "agent_ci_05",
  ] as const;

  interface LockBlueprint {
    state: "active" | "expired" | "released";
  }

  const blueprints: LockBlueprint[] = [
    { state: "active" },
    { state: "active" },
    { state: "active" },
    { state: "active" },
    { state: "active" },
    { state: "expired" },
    { state: "expired" },
    { state: "expired" },
    { state: "released" },
    { state: "released" },
    { state: "released" },
    { state: "released" },
  ];

  let count = 0;
  for (const bp of blueprints) {
    const lockType = pick(LOCK_TYPES);
    let resource: string;
    if (lockType === "repo") {
      resource = pick(LOCK_RESOURCES.slice(0, 3));
    } else if (lockType === "path") {
      resource = pick(LOCK_RESOURCES.slice(3, 6));
    } else {
      resource = pick(LOCK_RESOURCES.slice(6));
    }

    const acquiredAt = daysAgo(randInt(0, 7));
    let expiresAt: Date;
    let released: boolean;

    if (bp.state === "active") {
      expiresAt = minutesAfter(new Date(), randInt(30, 480), randInt(481, 1440));
      released = false;
    } else if (bp.state === "expired") {
      expiresAt = minutesAfter(acquiredAt, 5, 60);
      released = false;
    } else {
      expiresAt = minutesAfter(acquiredAt, 60, 480);
      released = true;
    }

    db.insert(locks)
      .values({
        id: `lock_${uid()}`,
        lockType,
        resource,
        holderId: pick(LOCK_HOLDERS),
        acquiredAt: acquiredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        released,
      })
      .run();
    count++;
  }

  return count;
}

// ─── Seed function ──────────────────────────────────────────────────────────

export async function seed(db: AgentOpsDb): Promise<{ runs: number; policies: number; policyResults: number; jobs: number; sessions: number; events: number; locks: number }> {
  const allPolicies = buildPolicies();

  // Insert policies
  for (const policy of allPolicies) {
    insertPolicy(db, {
      ...policy,
      enabled: true,
      createdAt: daysAgo(45).toISOString(),
    });
  }

  // Define run distribution
  const blueprints: RunBlueprint[] = [
    // 30 completed
    ...Array.from({ length: 30 }, (): RunBlueprint => ({
      status: RunStatus.Completed,
      daysAgoRange: [1, 28],
    })),
    // 5 running
    ...Array.from({ length: 5 }, (): RunBlueprint => ({
      status: RunStatus.Running,
      daysAgoRange: [0, 0],
    })),
    // 8 failed
    ...Array.from({ length: 8 }, (): RunBlueprint => ({
      status: RunStatus.Failed,
      daysAgoRange: [1, 25],
    })),
    // 3 blocked
    ...Array.from({ length: 3 }, (): RunBlueprint => ({
      status: RunStatus.Blocked,
      daysAgoRange: [1, 14],
    })),
    // 4 cancelled
    ...Array.from({ length: 4 }, (): RunBlueprint => ({
      status: RunStatus.Cancelled,
      daysAgoRange: [2, 20],
    })),
  ];

  // Shuffle for realism
  blueprints.sort(() => Math.random() - 0.5);

  const engine = new PolicyEngine();
  let policyResultCount = 0;

  for (let i = 0; i < blueprints.length; i++) {
    const bp = blueprints[i]!;
    const run = generateRun(bp, allPolicies, i);

    insertRun(db, run);

    // Insert run metrics
    db.insert(runMetrics)
      .values({
        id: `rm_${uid()}`,
        runId: run.id as string,
        tokenUsage: run.metrics.tokenUsage as unknown as Record<string, unknown>,
        wallTimeMs: run.metrics.wallTimeMs,
        costCents: Math.round(run.metrics.costUsd * 100),
        flakeRate: run.metrics.flakeRate,
        recordedAt: run.updatedAt,
      })
      .run();

    // Evaluate policies and store results
    if (
      run.status !== RunStatus.Running &&
      run.status !== RunStatus.Cancelled
    ) {
      const results = engine.evaluate(run, allPolicies);
      for (const result of results) {
        db.insert(policyResults)
          .values({
            id: `pr_${uid()}`,
            runId: run.id as string,
            policyId: result.policy.id as string,
            passed: result.passed,
            message: result.message,
            details: result.details as Record<string, unknown>,
            evaluatedAt: run.updatedAt,
          })
          .run();
        policyResultCount++;
      }
    }
  }

  // Seed orchestration tables
  const jobCount = seedJobs(db);
  const sessionCount = seedSessions(db);
  const eventCount = seedEvents(db);
  const lockCount = seedLocks(db);

  return {
    runs: blueprints.length,
    policies: allPolicies.length,
    policyResults: policyResultCount,
    jobs: jobCount,
    sessions: sessionCount,
    events: eventCount,
    locks: lockCount,
  };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding AgentOps database...\n");
  const db = getDb();

  // Clear existing seed data
  const { sql } = await import("drizzle-orm");
  db.run(sql`DELETE FROM locks`);
  db.run(sql`DELETE FROM events`);
  db.run(sql`DELETE FROM sessions`);
  db.run(sql`DELETE FROM jobs`);
  db.run(sql`DELETE FROM policy_results`);
  db.run(sql`DELETE FROM run_metrics`);
  db.run(sql`DELETE FROM runs`);
  db.run(sql`DELETE FROM policies`);

  const counts = await seed(db);

  console.log(`  Policies:       ${counts.policies}`);
  console.log(`  Runs:           ${counts.runs}`);
  console.log(`  Policy results: ${counts.policyResults}`);
  console.log(`  Jobs:           ${counts.jobs}`);
  console.log(`  Sessions:       ${counts.sessions}`);
  console.log(`  Events:         ${counts.events}`);
  console.log(`  Locks:          ${counts.locks}`);
  console.log("\nDone.");
}

// Run if executed directly
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("seed.ts") || process.argv[1].endsWith("seed.js"));

if (isMain) {
  main().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
