// @effect-diagnostics-next-line nodeBuiltinImport:off - Generates and persists Ed25519 signing keys and PEM JWKS conversion at standalone boot.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Standalone CLI bootstrap reads local keyfile and migration SQL files synchronously before server start.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Required factory for NodeHttpServer.layer.
import * as NodeHttp from "node:http";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Resolves standalone state and migration paths.
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import { makeWithDefaults as makeDrizzlePg } from "drizzle-orm/effect-postgres";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Digest from "effect/crypto/Digest";
import * as Mac from "effect/crypto/Mac";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Etag from "effect/http/Etag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiScalar from "effect/http-api/HttpApiScalar";
import { RelayApi } from "@t3tools/contracts/relay";

import * as AccountDeletion from "./accounts/AccountDeletion.ts";
import * as AgentActivityPublisher from "./agentActivity/AgentActivityPublisher.ts";
import * as AgentActivityRows from "./agentActivity/AgentActivityRows.ts";
import * as ApnsClient from "./agentActivity/ApnsClient.ts";
import * as ApnsDeliveries from "./agentActivity/ApnsDeliveries.ts";
import * as ApnsDeliveryQueue from "./agentActivity/ApnsDeliveryQueue.ts";
import * as ApnsProviderTokens from "./agentActivity/ApnsProviderTokens.ts";
import * as DeliveryAttempts from "./agentActivity/DeliveryAttempts.ts";
import * as Devices from "./agentActivity/Devices.ts";
import * as FcmAssertionSigner from "./agentActivity/FcmAssertionSigner.ts";
import * as FcmClient from "./agentActivity/FcmClient.ts";
import * as FcmDeliveries from "./agentActivity/FcmDeliveries.ts";
import * as FcmDeliveryQueueSender from "./agentActivity/FcmDeliveryQueueSender.ts";
import * as LiveActivities from "./agentActivity/LiveActivities.ts";
import * as MobileRegistrations from "./agentActivity/MobileRegistrations.ts";
import * as CloudMintSigner from "./auth/CloudMintSigner.ts";
import * as DpopProofs from "./auth/DpopProofs.ts";
import * as RelayTokens from "./auth/RelayTokens.ts";
import * as RelayConfiguration from "./Config.ts";
import * as RelayDb from "./db.ts";
import * as CloudflareApiPause from "./environments/CloudflareApiPause.ts";
import {
  layerCloudflareRestClients,
  resolveCloudflareZoneId,
} from "./environments/CloudflareRestClient.ts";
import * as EnvironmentConnector from "./environments/EnvironmentConnector.ts";
import * as EnvironmentCredentials from "./environments/EnvironmentCredentials.ts";
import * as EnvironmentLinker from "./environments/EnvironmentLinker.ts";
import * as EnvironmentLinks from "./environments/EnvironmentLinks.ts";
import * as EnvironmentPublishSignatures from "./environments/EnvironmentPublishSignatures.ts";
import * as ManagedEndpointAllocations from "./environments/ManagedEndpointAllocations.ts";
import * as ManagedEndpointProvider from "./environments/ManagedEndpointProvider.ts";
import * as ManagedEndpointReaper from "./environments/ManagedEndpointReaper.ts";
import * as ManagedTunnelLimits from "./environments/ManagedTunnelLimits.ts";
import * as HeldHooks from "./hooks/HeldHooks.ts";
import * as HookForwarder from "./hooks/HookForwarder.ts";
import * as HookInbox from "./hooks/HookInbox.ts";
import * as RelayHttpApi from "./http/Api.ts";
import * as MobileTelemetry from "./mobileTelemetry/MobileTelemetry.ts";
import * as T3ChatAccounts from "./t3chat/T3ChatAccounts.ts";
import * as WebCrypto from "./WebCrypto.ts";

class StandaloneRelayBootError extends Schema.TaggedError<StandaloneRelayBootError>()(
  "StandaloneRelayBootError",
  { message: Schema.String },
) {}

interface PersistedKeys {
  readonly cloudMintPrivateKey: string;
  readonly cloudMintPublicKey: string;
  readonly apnsDeliveryJobSigningSecret: string;
}

function loadOrCreateKeys(stateDir: string): PersistedKeys {
  NodeFS.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const keyFile = NodePath.join(stateDir, "relay-keys.json");
  if (NodeFS.existsSync(keyFile)) {
    const parsed = JSON.parse(NodeFS.readFileSync(keyFile, "utf8")) as PersistedKeys;
    if (
      parsed.cloudMintPrivateKey &&
      parsed.cloudMintPublicKey &&
      parsed.apnsDeliveryJobSigningSecret
    ) {
      return parsed;
    }
  }
  const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const created: PersistedKeys = {
    cloudMintPrivateKey: privateKey,
    cloudMintPublicKey: publicKey,
    apnsDeliveryJobSigningSecret: NodeCrypto.randomBytes(32).toString("base64url"),
  };
  NodeFS.writeFileSync(keyFile, JSON.stringify(created, null, 2), { mode: 0o600 });
  return created;
}

function decodeClerkFrontendApi(publishableKey: string): string | null {
  const parts = publishableKey.trim().split("_");
  if (parts.length < 3) return null;
  const encoded = parts.slice(2).join("_");
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/u, "").trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

const fetchClerkJwksPublicKeyPem = Effect.fn("standalone.fetchClerkJwksPublicKeyPem")(function* (
  publishableKey: string,
) {
  const frontendApi = decodeClerkFrontendApi(publishableKey);
  if (!frontendApi) {
    return yield* new StandaloneRelayBootError({
      message: "Could not decode Clerk Frontend API hostname from publishable key.",
    });
  }
  const jwksUrl = `https://${frontendApi}/.well-known/jwks.json`;
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* httpClient.get(jwksUrl).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError(
      (cause) =>
        new StandaloneRelayBootError({
          message: `Failed to fetch Clerk JWKS from ${jwksUrl}: ${String(cause)}`,
        }),
    ),
  );
  if (response.status >= 400) {
    return yield* new StandaloneRelayBootError({
      message: `Clerk JWKS returned HTTP ${response.status} from ${jwksUrl}`,
    });
  }
  const payload = (yield* response.json.pipe(
    Effect.mapError(
      (cause) =>
        new StandaloneRelayBootError({
          message: `Invalid Clerk JWKS JSON: ${String(cause)}`,
        }),
    ),
  )) as {
    readonly keys?: ReadonlyArray<NodeCrypto.JsonWebKey & { readonly alg?: string }>;
  };
  const key = payload.keys?.find((entry) => entry.kty === "RSA") ?? payload.keys?.[0];
  if (!key) {
    return yield* new StandaloneRelayBootError({
      message: `No JWK keys returned from ${jwksUrl}`,
    });
  }
  const keyObject = NodeCrypto.createPublicKey({ key, format: "jwk" });
  return keyObject.export({ type: "spki", format: "pem" }).toString();
});

const runMigrations = Effect.fn("standalone.runMigrations")(function* (
  pgClient: PgClient.PgClient,
  migrationsDir: string,
) {
  yield* pgClient.unsafe(`
    CREATE TABLE IF NOT EXISTS relay_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const appliedRows = yield* pgClient.unsafe<{ readonly id: string }>(
    `SELECT id FROM relay_migrations`,
  );
  const applied = new Set(appliedRows.map((row) => row.id));
  const entries = NodeFS.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  for (const name of entries) {
    if (applied.has(name)) continue;
    const sqlPath = NodePath.join(migrationsDir, name, "migration.sql");
    if (!NodeFS.existsSync(sqlPath)) continue;
    const sqlText = NodeFS.readFileSync(sqlPath, "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    yield* Effect.logInfo(`Applying relay migration: ${name}`);
    yield* pgClient.withTransaction(
      Effect.gen(function* () {
        for (const statement of statements) {
          yield* pgClient.unsafe(statement).unprepared;
        }
        yield* pgClient`INSERT INTO relay_migrations (id) VALUES (${name})`;
      }),
    );
  }
});

const layerWebcrypto = Layer.mergeAll(
  Digest.layerWebCrypto,
  Mac.layerWebCrypto,
  Signature.layerWebCrypto,
).pipe(Layer.provideMerge(SecureRandom.layerWebCrypto));

const layerHttpPlatformNotSupported = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "node",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: Effect.fn("HttpPlatform.fileResponse")(function () {
    return Effect.die("Relay API does not serve filesystem responses");
  }),
  fileWebResponse: Effect.fn("HttpPlatform.fileWebResponse")(function () {
    return Effect.die("Relay API does not serve file responses");
  }),
});

const layerRelayApi = Layer.mergeAll(
  RelayHttpApi.layerHealthApi,
  RelayHttpApi.layerMetadataApi,
  RelayHttpApi.layerMobileApi,
  RelayHttpApi.layerClientApi,
  RelayHttpApi.layerTokenApi,
  RelayHttpApi.layerDpopClientApi,
  RelayHttpApi.layerServerApi,
);

const StandaloneConfig = Config.all({
  port: Config.Number("PORT").pipe(Config.withDefault(8787)),
  host: Config.String("HOST").pipe(Config.withDefault("127.0.0.1")),
  databaseUrl: Config.String("DATABASE_URL"),
  relayPublicOrigin: Config.NonEmptyString("RELAY_PUBLIC_ORIGIN"),
  stateDir: Config.String("RELAY_STATE_DIR").pipe(Config.withDefault("/var/lib/t4-relay")),
  migrationsDir: Config.String("RELAY_MIGRATIONS_DIR").pipe(Config.withDefault("")),
  clerkPublishableKey: Config.String("CLERK_PUBLISHABLE_KEY").pipe(
    Config.withDefault("pk_live_Y2xlcmsudDMuY29kZXMk"),
  ),
  clerkSecretKey: Config.String("CLERK_SECRET_KEY").pipe(Config.withDefault("")),
  clerkJwtAudience: Config.String("CLERK_JWT_AUDIENCE").pipe(Config.withDefault("t3-code-relay")),
  clerkJwtKey: Config.String("CLERK_JWT_KEY").pipe(Config.withDefault("")),
  cfApiToken: Config.String("CLOUDFLARE_API_TOKEN").pipe(Config.withDefault("")),
  cfAccountId: Config.String("CLOUDFLARE_ACCOUNT_ID").pipe(Config.withDefault("")),
  tunnelZoneName: Config.String("RELAY_TUNNEL_ZONE_NAME").pipe(Config.withDefault("")),
  tunnelZoneId: Config.String("RELAY_TUNNEL_ZONE_ID").pipe(Config.withDefault("")),
  tunnelNamespace: Config.String("RELAY_TUNNEL_NAMESPACE").pipe(Config.withDefault("t4")),
  maxManagedTunnels: Config.Number("RELAY_MAX_MANAGED_TUNNELS").pipe(Config.withDefault(100)),
  allowedUserIds: Config.String("RELAY_ALLOWED_USER_IDS").pipe(Config.withDefault("")),
  exposeDocs: Config.Boolean("RELAY_EXPOSE_DOCS").pipe(Config.withDefault(false)),
});

const program = Effect.scoped(
  Effect.gen(function* () {
    const env = yield* StandaloneConfig;
    const relayPublicOrigin = env.relayPublicOrigin.replace(/\/+$/u, "");
    const migrationsDir =
      env.migrationsDir.trim() ||
      NodePath.resolve(
        NodePath.dirname(new URL(import.meta.url).pathname),
        "../migrations/postgres",
      );

    const clerkSecretKey = env.clerkSecretKey.trim();
    const clerkJwtKey =
      env.clerkJwtKey.trim() ||
      (clerkSecretKey.length === 0
        ? yield* fetchClerkJwksPublicKeyPem(env.clerkPublishableKey)
        : undefined);

    const cfApiToken = env.cfApiToken.trim();
    const cfAccountId = env.cfAccountId.trim();
    const tunnelZoneName = env.tunnelZoneName.trim() || undefined;
    const tunnelNamespace = env.tunnelNamespace.trim() || "t4";

    let cfZoneId = env.tunnelZoneId.trim();
    if (cfApiToken && cfAccountId && tunnelZoneName && !cfZoneId) {
      cfZoneId = yield* resolveCloudflareZoneId(cfApiToken, tunnelZoneName);
    }

    const keys = loadOrCreateKeys(env.stateDir);
    const allowedUserIds = env.allowedUserIds
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const relaySettings: RelayConfiguration.RelayConfiguration["Service"] = {
      relayIssuer: relayPublicOrigin,
      apns: null,
      apnsDeliveryJobSigningSecret: Redacted.make(keys.apnsDeliveryJobSigningSecret),
      clerkSecretKey: Redacted.make(clerkSecretKey),
      ...(clerkJwtKey ? { clerkJwtKey } : {}),
      clerkPublishableKey: env.clerkPublishableKey,
      clerkJwtAudience: env.clerkJwtAudience,
      cloudMintPrivateKey: Redacted.make(keys.cloudMintPrivateKey),
      cloudMintPublicKey: keys.cloudMintPublicKey,
      managedEndpointBaseDomain: tunnelZoneName,
      managedEndpointNamespace: tunnelNamespace,
      maxManagedTunnels:
        Number.isFinite(env.maxManagedTunnels) && env.maxManagedTunnels > 0
          ? env.maxManagedTunnels
          : 100,
      ...(allowedUserIds.length > 0 ? { allowedUserIds } : {}),
      managedEndpointCleanupMode: "off",
      legacyManagedEndpointCleanupMode: "off",
    };

    const layerPg = PgClient.layer({
      url: Redacted.make(env.databaseUrl),
      maxConnections: 10,
      idleTimeout: "30 seconds",
    });

    const layerDb = Layer.effect(
      RelayDb.RelayDb,
      Effect.gen(function* () {
        const pgClient = yield* PgClient.PgClient;
        yield* runMigrations(pgClient, migrationsDir);
        return yield* makeDrizzlePg();
      }),
    ).pipe(Layer.provideMerge(layerPg));

    const layerCloudflareManagedEndpoints =
      cfApiToken && cfAccountId && cfZoneId
        ? ManagedEndpointProvider.layer.pipe(
            Layer.provideMerge(
              layerCloudflareRestClients({
                apiToken: cfApiToken,
                accountId: cfAccountId,
                zoneId: cfZoneId,
              }),
            ),
          )
        : ManagedEndpointProvider.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                ManagedEndpointProvider.layerTunnelClient({
                  get: () => Effect.die("Cloudflare tunnel API not configured"),
                  list: () => Effect.succeed({ result: [], resultInfo: null }),
                  create: () => Effect.die("Cloudflare tunnel API not configured"),
                  putConfiguration: () => Effect.die("Cloudflare tunnel API not configured"),
                  getConfiguration: () => Effect.succeed({ ingress: [] }),
                  getToken: () => Effect.die("Cloudflare tunnel API not configured"),
                  delete: () => Effect.void,
                  disconnect: () => Effect.void,
                }),
                ManagedEndpointProvider.layerDnsClient({
                  listRecords: () => Effect.succeed([]),
                  createRecord: () => Effect.die("Cloudflare DNS API not configured"),
                  updateRecord: () => Effect.die("Cloudflare DNS API not configured"),
                  deleteRecord: () => Effect.void,
                }),
              ),
            ),
          );

    const layerHookInbox = Layer.succeed(HookInbox.HookInbox, {
      hold: Effect.fn("HookInbox.hold")(function () {
        return Effect.succeed(false);
      }),
      wake: Effect.fn("HookInbox.wake")(function () {
        return Effect.succeed(false);
      }),
      clear: Effect.fn("HookInbox.clear")(function () {
        return Effect.void;
      }),
    });

    const layerRuntimeTier1 = Layer.mergeAll(
      RelayConfiguration.layer(relaySettings),
      layerWebcrypto,
      FetchHttpClient.layer,
      RelayDb.RelayTransactions.layer.pipe(Layer.provideMerge(layerDb)),
    );

    const layerRuntimeTier2 = Layer.mergeAll(
      RelayTokens.layer.pipe(Layer.provideMerge(CloudMintSigner.layer)),
      DeliveryAttempts.layer,
      LiveActivities.layer,
      T3ChatAccounts.layer,
      CloudflareApiPause.layer,
      EnvironmentLinks.layer,
      ManagedEndpointAllocations.layer,
      EnvironmentCredentials.layer,
      AgentActivityRows.layer,
      Devices.layer,
      layerHookInbox,
      DpopProofs.layer,
      ApnsClient.layer.pipe(Layer.provideMerge(ApnsProviderTokens.layer)),
      ApnsDeliveryQueue.layer.pipe(
        Layer.provide(
          Layer.succeed(ApnsDeliveryQueue.ApnsDeliveryQueueSender, {
            send: Effect.fn("ApnsDeliveryQueueSender.send")(function () {
              return Effect.void;
            }),
          }),
        ),
      ),
    ).pipe(Layer.provideMerge(layerRuntimeTier1));

    const layerRuntimeTier3 = Layer.mergeAll(
      ManagedTunnelLimits.layer,
      ApnsDeliveries.layer,
      FcmDeliveries.layer.pipe(
        Layer.provide(
          Layer.succeed(FcmDeliveryQueueSender.FcmDeliveryQueueSender, {
            send: Effect.fn("FcmDeliveryQueueSender.send")(function () {
              return Effect.void;
            }),
          }),
        ),
        Layer.provideMerge(
          FcmClient.layer.pipe(
            Layer.provide(FcmAssertionSigner.layer),
            Layer.provide(Layer.succeed(WebCrypto.WebCrypto, { subtle: globalThis.crypto.subtle })),
          ),
        ),
      ),
    ).pipe(Layer.provideMerge(layerRuntimeTier2));

    const layerRuntimeTier4 = Layer.mergeAll(
      layerCloudflareManagedEndpoints,
      EnvironmentPublishSignatures.layer,
      HeldHooks.layer,
    ).pipe(Layer.provideMerge(layerRuntimeTier3));

    const layerRuntimeTier5 = Layer.mergeAll(
      ManagedEndpointReaper.layer,
      AccountDeletion.layer,
      EnvironmentLinker.layer,
      EnvironmentConnector.layer,
      AgentActivityPublisher.layer,
    ).pipe(Layer.provideMerge(layerRuntimeTier4));

    const layerRuntime = MobileRegistrations.layer.pipe(Layer.provideMerge(layerRuntimeTier5));

    const layerHookRateLimiter = Layer.succeed(HookForwarder.HookRateLimiter, {
      allowHook: Effect.fn("HookRateLimiter.allowHook")(function () {
        return Effect.succeed(true);
      }),
      allowEndpoint: Effect.fn("HookRateLimiter.allowEndpoint")(function () {
        return Effect.succeed(true);
      }),
    });

    const layerNoopMobileTelemetry = Layer.succeed(MobileTelemetry.MobileTelemetry, {
      handle: Effect.fn("MobileTelemetry.handle")(function () {
        return Effect.succeed(HttpServerResponse.empty({ status: 204 }));
      }),
    });

    const layerApp = Layer.mergeAll(
      layerRelayApi,
      HookForwarder.layerApi.pipe(
        Layer.provide(HookForwarder.layer),
        Layer.provide(layerHookRateLimiter),
      ),
      MobileTelemetry.layerApi.pipe(Layer.provide(layerNoopMobileTelemetry)),
      AccountDeletion.layerApi,
    ).pipe(
      Layer.provideMerge(RelayHttpApi.layerClientAuth),
      Layer.provideMerge(RelayHttpApi.layerDpopClientAuth),
      Layer.provideMerge(RelayHttpApi.layerEnvironmentAuth),
      Layer.provide(layerRuntime),
    );

    const layerApiRoutes = env.exposeDocs
      ? Layer.mergeAll(
          HttpApiBuilder.layer(RelayApi, { openapiPath: "/openapi.json" }).pipe(
            Layer.provide(layerApp),
          ),
          HttpApiScalar.layer(RelayApi, { path: "/docs" }),
          RelayHttpApi.layerDocsRedirectRoute,
        )
      : HttpApiBuilder.layer(RelayApi).pipe(Layer.provide(layerApp));

    const layerServer = HttpRouter.serve(
      Layer.merge(
        layerApiRoutes.pipe(
          Layer.provide([Etag.layerWeak, layerHttpPlatformNotSupported, RelayHttpApi.layerCors]),
        ),
        RelayHttpApi.layerNotFoundRoute,
      ),
      { routerConfig: RelayHttpApi.RELAY_HTTP_ROUTER_CONFIG },
    ).pipe(
      Layer.provide(
        NodeHttpServer.layer(NodeHttp.createServer, { port: env.port, host: env.host }),
      ),
      Layer.provideMerge(layerRuntime),
    );

    const maintenanceSweep = Effect.gen(function* () {
      yield* DpopProofs.DpopProofReplay.pipe(Effect.flatMap((d) => d.pruneExpired));
      const now = yield* DateTime.now;
      yield* AgentActivityRows.AgentActivityRows.pipe(
        Effect.flatMap((rows) =>
          rows.pruneTerminal({
            updatedBefore: DateTime.formatIso(DateTime.subtract(now, { minutes: 30 })),
          }),
        ),
      );
      yield* DeliveryAttempts.DeliveryAttempts.pipe(Effect.flatMap((a) => a.pruneExpired));
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.logWarning("Standalone relay maintenance sweep failed", { cause }),
      ),
    );

    const runtimeContext = yield* Layer.build(layerServer);
    yield* Effect.logInfo(
      `Standalone relay listening on http://${env.host}:${env.port} (public: ${relayPublicOrigin}, maxTunnels: ${relaySettings.maxManagedTunnels}, allowlist: ${allowedUserIds.length > 0 ? `${allowedUserIds.length} user(s)` : "open"}, docs: ${env.exposeDocs ? "enabled" : "hidden"}, tunnelDomain: ${tunnelZoneName ?? "disabled"})`,
    );
    yield* Effect.forkScoped(
      maintenanceSweep.pipe(
        Effect.provide(runtimeContext),
        Effect.repeat(Schedule.spaced("5 minutes")),
      ),
    );
    return yield* Effect.never;
  }),
).pipe(Effect.provide(FetchHttpClient.layer));

NodeRuntime.runMain(program);
