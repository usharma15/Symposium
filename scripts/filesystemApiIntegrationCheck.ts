import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const main = async () => {
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postgresBin = process.env.SYMPOSIUM_TEST_POSTGRES_BIN;
if (!postgresBin) {
  throw new Error("Set SYMPOSIUM_TEST_POSTGRES_BIN to a PostgreSQL bin directory containing initdb.");
}

const initdb = path.join(postgresBin, "initdb");
const postgresServer = process.env.SYMPOSIUM_TEST_POSTGRES_SERVER ?? path.join(postgresBin, "postgres");
await Promise.all([access(initdb), access(postgresServer)]);

const root = await mkdtemp(path.join(tmpdir(), "symposium-filesystem-api-"));
const databaseRoot = path.join(root, "postgres");
const socketRoot = path.join(root, "socket");
const objectRoot = path.join(root, "objects");
const signingSecret = "filesystem-api-integration-signing-secret-32-chars";
const actorHeaders: Record<string, string> = {
  "x-symposium-handle": "@udayan",
  "x-symposium-name": "Filesystem Integration"
};

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const run = (command: string, args: string[], ignoreOutput = false) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    stdio: ignoreOutput ? "ignore" : "pipe"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout ?? "";
};

const runAsync = (
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv
) => new Promise<string>((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-64 * 1024);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (code === 0) resolve(output);
    else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}:\n${output}`));
  });
});

const waitFor = async (predicate: () => Promise<boolean>, label: string, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out${lastError ? `: ${String(lastError)}` : ""}`);
};

type ApiChild = {
  child: ChildProcess;
  output: () => string;
};

const startApi = (port: number, databaseUrl: string): ApiChild => {
  const environment = { ...process.env };
  for (const key of [
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_BASE_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "CLERK_SECRET_KEY",
    "OPENAI_API_KEY"
  ]) {
    delete environment[key];
  }
  Object.assign(environment, {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    DATABASE_APPLICATION_NAME: "symposium-filesystem-api-check",
    SYMPOSIUM_STRICT_ENV: "false",
    SYMPOSIUM_REQUIRE_AUTH: "false",
    SYMPOSIUM_ALLOW_DEV_ACTOR: "true",
    SYMPOSIUM_SEED_ON_BOOT: "true",
    SYMPOSIUM_ATTACHMENT_STORAGE: "filesystem",
    SYMPOSIUM_FILESYSTEM_STORAGE_ROOT: objectRoot,
    SYMPOSIUM_FILESYSTEM_STORAGE_BASE_URL: `http://127.0.0.1:${port}`,
    SYMPOSIUM_FILESYSTEM_STORAGE_SIGNING_SECRET: signingSecret,
    SYMPOSIUM_FILESYSTEM_STORAGE_BUCKET: "symposium-filesystem-integration",
    SYMPOSIUM_AI_ENABLED: "false",
    APP_VERSION: "filesystem-api-integration"
  });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/api/src/server.ts"],
    { cwd: repositoryRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] }
  );
  let tail = "";
  const append = (chunk: Buffer) => {
    tail = `${tail}${chunk.toString("utf8")}`.slice(-64 * 1024);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { child, output: () => tail };
};

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
};

const request = async (
  baseUrl: string,
  method: string,
  route: string,
  body?: BodyInit,
  headers: Record<string, string> = {}
) => fetch(`${baseUrl}${route}`, {
  method,
  headers: { ...actorHeaders, ...headers },
  body
});

const jsonRequest = async <T>(
  baseUrl: string,
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {}
) => {
  const response = await request(
    baseUrl,
    method,
    route,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? headers : { "content-type": "application/json", ...headers }
  );
  const payload = await response.json() as T;
  return { response, payload };
};

const requireOk = (label: string, response: Response, payload?: unknown) => {
  assert.ok(
    response.ok,
    `${label} returned ${response.status}: ${JSON.stringify(payload)}`
  );
};

let api: ApiChild | undefined;
let pool: Pool | undefined;
let postgres: ChildProcess | undefined;

try {
  const [databasePort, apiPort] = await Promise.all([freePort(), freePort()]);
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(socketRoot, { recursive: true })),
    import("node:fs/promises").then(({ mkdir }) => mkdir(objectRoot, { recursive: true }))
  ]);
  run(initdb, ["-D", databaseRoot, "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  postgres = spawn(postgresServer, [
    "-D",
    databaseRoot,
    "-F",
    "-k",
    socketRoot,
    "-p",
    String(databasePort),
    "-c",
    "listen_addresses=127.0.0.1"
  ], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "ignore"
  });
  const databaseUrl = `postgresql://127.0.0.1:${databasePort}/postgres`;
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  pool = new Pool({ connectionString: databaseUrl, max: 2 });
  await waitFor(async () => {
    if (postgres?.exitCode !== null || postgres?.signalCode !== null) {
      throw new Error("The isolated PostgreSQL server exited before accepting connections.");
    }
    await pool!.query("SELECT 1");
    return true;
  }, "isolated PostgreSQL startup");

  api = startApi(apiPort, databaseUrl);
  await waitFor(async () => {
    if (api?.child.exitCode !== null || api?.child.signalCode !== null) throw new Error(api?.output());
    const response = await fetch(`${baseUrl}/readyz?probe=database`);
    return response.status === 200;
  }, "canonical API startup and migration", 60_000);
  console.log("filesystem-api: startup and all migrations passed");

  const readiness = await fetch(`${baseUrl}/readyz?probe=database`).then((response) => response.json()) as {
    checks: Array<{ key: string; configured: boolean }>;
    migrations: { currentMigrationId: string; latestMigrationId: string; pendingMigrationIds: string[] };
    release: string;
  };
  assert.equal(readiness.release, "filesystem-api-integration");
  assert.equal(readiness.checks.find((check) => check.key === "attachment_storage")?.configured, true);
  assert.equal(readiness.migrations.currentMigrationId, readiness.migrations.latestMigrationId);
  assert.deepEqual(readiness.migrations.pendingMigrationIds, []);
  const seededBootstrap = await fetch(`${baseUrl}/v1/bootstrap`).then((response) => response.json()) as {
    profiles?: Record<string, unknown>;
  };
  const seededActorHandle = Object.keys(seededBootstrap.profiles ?? {})[0];
  assert.ok(seededActorHandle, "fresh canonical bootstrap must include a seeded profile");
  actorHeaders["x-symposium-handle"] = seededActorHandle;

  await runAsync("npm", ["run", "api:smoke"], {
    ...process.env,
    SYMPOSIUM_SMOKE_URL: baseUrl
  });
  await runAsync("npm", ["run", "api:smoke:writes"], {
    ...process.env,
    SYMPOSIUM_SMOKE_URL: baseUrl,
    SYMPOSIUM_SMOKE_HANDLE: seededActorHandle
  });
  console.log("filesystem-api: read and comprehensive write smoke passed");

  const publicBytes = Buffer.from("SYMPOSIUM public canonical attachment proof\n", "utf8");
  const publicPrepare = await jsonRequest<{
    attachmentId: string;
    objectKey: string;
    publicUrl: string;
  }>(baseUrl, "POST", "/v1/attachments/upload", {
    fileName: "canonical-proof.txt",
    contentType: "text/plain",
    byteSize: publicBytes.length,
    ownerType: "post"
  }, { "idempotency-key": "filesystem-public-prepare" });
  requireOk("public prepare", publicPrepare.response, publicPrepare.payload);
  assert.match(publicPrepare.payload.publicUrl, /\/v1\/storage\/public\/post\//);

  const pendingPublic = await fetch(publicPrepare.payload.publicUrl);
  assert.equal(pendingPublic.status, 404, "pending public bytes must not be delivered");

  const foreignConfirm = await jsonRequest(
    baseUrl,
    "POST",
    "/v1/attachments/confirm",
    { attachmentId: publicPrepare.payload.attachmentId, byteSize: publicBytes.length },
    { "x-symposium-handle": "@foreign", "x-symposium-name": "Foreign" }
  );
  assert.equal(foreignConfirm.response.status, 404, "another actor must not confirm an upload");

  const publicUpload = await request(
    baseUrl,
    "PUT",
    `/v1/attachments/${publicPrepare.payload.attachmentId}/content`,
    publicBytes,
    {
      "content-type": "application/octet-stream",
      "content-length": String(publicBytes.length)
    }
  );
  requireOk("public content upload", publicUpload);
  const duplicateUpload = await request(
    baseUrl,
    "PUT",
    `/v1/attachments/${publicPrepare.payload.attachmentId}/content`,
    publicBytes,
    {
      "content-type": "application/octet-stream",
      "content-length": String(publicBytes.length)
    }
  );
  requireOk("duplicate public content upload", duplicateUpload);

  const publicConfirm = await jsonRequest<{ publicUrl: string; status: string }>(
    baseUrl,
    "POST",
    "/v1/attachments/confirm",
    { attachmentId: publicPrepare.payload.attachmentId, byteSize: publicBytes.length }
  );
  requireOk("public confirm", publicConfirm.response, publicConfirm.payload);
  assert.equal(publicConfirm.payload.status, "uploaded");
  assert.equal(publicConfirm.payload.publicUrl, publicPrepare.payload.publicUrl);

  const publicDelivery = await fetch(publicConfirm.payload.publicUrl);
  assert.equal(publicDelivery.status, 200);
  assert.equal(publicDelivery.headers.get("content-type"), "text/plain");
  assert.deepEqual(Buffer.from(await publicDelivery.arrayBuffer()), publicBytes);
  const publicRange = await fetch(publicConfirm.payload.publicUrl, { headers: { range: "bytes=3-11" } });
  assert.equal(publicRange.status, 206);
  assert.equal(publicRange.headers.get("content-range"), `bytes 3-11/${publicBytes.length}`);
  assert.deepEqual(Buffer.from(await publicRange.arrayBuffer()), publicBytes.subarray(3, 12));
  const invalidRange = await fetch(publicConfirm.payload.publicUrl, { headers: { range: "bytes=9999-" } });
  assert.equal(invalidRange.status, 416);

  const createPost = await jsonRequest<{
    item: { id: string; attachments: Array<{ id: string; url: string }> };
  }>(
    baseUrl,
    "POST",
    "/v1/posts",
    {
      title: "",
      body: "Filesystem-backed canonical API attachment integration proof.",
      kind: "thought",
      postType: "thought",
      room: "symposium",
      attachmentIds: [publicPrepare.payload.attachmentId]
    },
    { "idempotency-key": "filesystem-public-post" }
  );
  requireOk("attached post create", createPost.response, createPost.payload);
  assert.equal(createPost.payload.item.attachments[0]?.id, publicPrepare.payload.attachmentId);
  assert.equal(createPost.payload.item.attachments[0]?.url, publicPrepare.payload.publicUrl);

  const privateBytes = Buffer.from("SYMPOSIUM private canonical attachment proof\n", "utf8");
  const privatePrepare = await jsonRequest<{ attachmentId: string; objectKey: string; publicUrl: null }>(
    baseUrl,
    "POST",
    "/v1/attachments/upload",
    {
      fileName: "private-proof.txt",
      contentType: "text/plain",
      byteSize: privateBytes.length,
      ownerType: "note"
    },
    { "idempotency-key": "filesystem-private-prepare" }
  );
  requireOk("private prepare", privatePrepare.response, privatePrepare.payload);
  assert.equal(privatePrepare.payload.publicUrl, null);
  requireOk(
    "private content upload",
    await request(
      baseUrl,
      "PUT",
      `/v1/attachments/${privatePrepare.payload.attachmentId}/content`,
      privateBytes,
      {
        "content-type": "application/octet-stream",
        "content-length": String(privateBytes.length)
      }
    )
  );
  const privateConfirm = await jsonRequest(
    baseUrl,
    "POST",
    "/v1/attachments/confirm",
    { attachmentId: privatePrepare.payload.attachmentId, byteSize: privateBytes.length }
  );
  requireOk("private confirm", privateConfirm.response, privateConfirm.payload);
  const privatePublicAttempt = await fetch(
    `${baseUrl}/v1/storage/public/${privatePrepare.payload.objectKey}`
  );
  assert.equal(privatePublicAttempt.status, 404, "private owner types must never use public delivery");
  const expires = Math.floor(Date.now() / 1000) + 60;
  const signature = createHmac("sha256", signingSecret)
    .update(`${expires}\n${privatePrepare.payload.objectKey}`)
    .digest("hex");
  const privateUrl = `${baseUrl}/v1/storage/private/${privatePrepare.payload.objectKey}?expires=${expires}&signature=${signature}`;
  const unsignedPrivate = await fetch(`${baseUrl}/v1/storage/private/${privatePrepare.payload.objectKey}`);
  assert.equal(unsignedPrivate.status, 404);
  const privateDelivery = await fetch(privateUrl);
  assert.equal(privateDelivery.status, 200);
  assert.deepEqual(Buffer.from(await privateDelivery.arrayBuffer()), privateBytes);
  const tamperedPrivate = await fetch(
    `${privateUrl.slice(0, -1)}${privateUrl.endsWith("0") ? "1" : "0"}`
  );
  assert.equal(tamperedPrivate.status, 404);

  const databaseEvidence = await pool.query<{
    auditCount: string;
    eventCount: string;
    receiptCount: string;
    status: string;
    ownerId: string | null;
    bucket: string;
  }>(
    `SELECT
       attachment.status,
       attachment.owner_id AS "ownerId",
       attachment.bucket,
       (SELECT count(*)::text FROM audit_logs WHERE subject_id = attachment.id::text) AS "auditCount",
       (SELECT count(*)::text FROM events WHERE subject_id = attachment.id::text AND kind = 'attachment.uploaded') AS "eventCount",
       (SELECT count(*)::text FROM mutation_receipts WHERE scope = 'attachment.prepare' AND status = 'completed') AS "receiptCount"
     FROM attachments attachment
     WHERE attachment.id = $1`,
    [publicPrepare.payload.attachmentId]
  );
  assert.equal(databaseEvidence.rows[0]?.status, "uploaded");
  assert.equal(databaseEvidence.rows[0]?.ownerId, createPost.payload.item.id);
  assert.equal(databaseEvidence.rows[0]?.bucket, "symposium-filesystem-integration");
  assert.ok(Number(databaseEvidence.rows[0]?.auditCount) >= 2);
  assert.equal(Number(databaseEvidence.rows[0]?.eventCount), 1);
  assert.ok(Number(databaseEvidence.rows[0]?.receiptCount) >= 1);
  console.log("filesystem-api: public/private delivery, authorization, receipts, audit, events, and ranges passed");

  await stopChild(api.child);
  api = startApi(apiPort, databaseUrl);
  await waitFor(async () => {
    if (api?.child.exitCode !== null || api?.child.signalCode !== null) throw new Error(api?.output());
    return (await fetch(`${baseUrl}/readyz?probe=database`)).status === 200;
  }, "canonical API restart", 60_000);
  const restartedPublic = await fetch(publicPrepare.payload.publicUrl);
  assert.equal(restartedPublic.status, 200);
  assert.deepEqual(Buffer.from(await restartedPublic.arrayBuffer()), publicBytes);
  const restartedRow = await pool.query<{ ownerId: string | null; status: string }>(
    `SELECT owner_id AS "ownerId", status FROM attachments WHERE id = $1`,
    [publicPrepare.payload.attachmentId]
  );
  assert.equal(restartedRow.rows[0]?.ownerId, createPost.payload.item.id);
  assert.equal(restartedRow.rows[0]?.status, "uploaded");
  console.log("filesystem-api: API restart preserved Postgres metadata and filesystem bytes");

  const deletePost = await jsonRequest(
    baseUrl,
    "DELETE",
    `/v1/posts/${createPost.payload.item.id}`,
    undefined,
    { "idempotency-key": "filesystem-public-post-delete" }
  );
  requireOk("attached post delete", deletePost.response, deletePost.payload);
  const discardPrivate = await jsonRequest(
    baseUrl,
    "DELETE",
    `/v1/attachments/${privatePrepare.payload.attachmentId}`
  );
  requireOk("private upload discard", discardPrivate.response, discardPrivate.payload);
  await waitFor(async () => {
    const jobs = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM storage_deletion_jobs
       WHERE attachment_id = ANY($1::uuid[])`,
      [[publicPrepare.payload.attachmentId, privatePrepare.payload.attachmentId]]
    );
    return Number(jobs.rows[0]?.count) === 0;
  }, "durable deletion queue drain");
  assert.equal((await fetch(publicPrepare.payload.publicUrl)).status, 404);
  assert.equal((await fetch(privateUrl)).status, 404);
  const storageFiles = (await readdir(objectRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.deepEqual(storageFiles, []);
  console.log("filesystem-api: durable canonical/staging deletion and deterministic cleanup passed");

  console.log(JSON.stringify({
    ok: true,
    postgres: "17",
    migrations: readiness.migrations.latestMigrationId,
    publicAttachmentId: publicPrepare.payload.attachmentId,
    privateAttachmentId: privatePrepare.payload.attachmentId,
    restartPersistence: true,
    remainingObjectFiles: storageFiles.length
  }, null, 2));
} finally {
  if (api) await stopChild(api.child);
  if (pool) await pool.end().catch(() => undefined);
  if (postgres) await stopChild(postgres);
  await rm(root, { recursive: true, force: true });
}
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
