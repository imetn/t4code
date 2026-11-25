import * as Base64 from "effect/encoding/Base64";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import {
  layerDnsClient,
  layerTunnelClient,
  ManagedEndpointDnsClientError,
  ManagedEndpointTunnelClientError,
  type ManagedEndpointTunnel,
} from "./ManagedEndpointProvider.ts";

interface CloudflareApiEnvelope<T> {
  readonly success: boolean;
  readonly result: T;
  readonly result_info?: {
    readonly page?: number;
    readonly per_page?: number;
    readonly total_count?: number;
  };
  readonly errors?: ReadonlyArray<{ readonly code?: number; readonly message?: string }>;
}

export class CloudflareRestError extends Schema.TaggedError<CloudflareRestError>()(
  "CloudflareRestError",
  {
    status: Schema.Number,
    codes: Schema.Array(Schema.Number),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Cloudflare API error (${this.status}): ${this.detail}`;
  }
}

const cfRequest = Effect.fn("CloudflareRestClient.request")(function* <T>(
  httpClient: HttpClient.HttpClient,
  apiToken: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Effect.fn.Return<CloudflareApiEnvelope<T>, CloudflareRestError> {
  const baseRequest = HttpClientRequest.make(method)(
    `https://api.cloudflare.com/client/v4${path}`,
  ).pipe(HttpClientRequest.setHeader("authorization", `Bearer ${apiToken}`));
  const request =
    body === undefined
      ? baseRequest
      : yield* HttpClientRequest.bodyJson(baseRequest, body).pipe(
          Effect.mapError(
            (cause) => new CloudflareRestError({ status: 0, codes: [], detail: String(cause) }),
          ),
        );
  const response = yield* httpClient.execute(request).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError(
      (cause) => new CloudflareRestError({ status: 0, codes: [], detail: String(cause) }),
    ),
  );
  const payload = (yield* response.json.pipe(
    Effect.mapError(
      (cause) =>
        new CloudflareRestError({
          status: response.status,
          codes: [],
          detail: String(cause),
        }),
    ),
  )) as unknown as CloudflareApiEnvelope<T>;
  if (response.status >= 400 || !payload.success) {
    const codes = (payload.errors ?? [])
      .map((entry) => entry.code)
      .filter((code): code is number => typeof code === "number");
    const detail =
      payload.errors?.map((entry) => `${entry.code ?? ""}:${entry.message ?? ""}`).join("; ") ||
      `HTTP ${response.status}`;
    return yield* new CloudflareRestError({ status: response.status, codes, detail });
  }
  return payload;
});

function mapTunnel(raw: Record<string, unknown>): ManagedEndpointTunnel {
  return {
    id: typeof raw.id === "string" ? raw.id : null,
    name: typeof raw.name === "string" ? raw.name : null,
    status: typeof raw.status === "string" ? raw.status : null,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
    connsInactiveAt: typeof raw.conns_inactive_at === "string" ? raw.conns_inactive_at : null,
    deletedAt: typeof raw.deleted_at === "string" ? raw.deleted_at : null,
  };
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/u, "");
}

export const resolveCloudflareZoneId = Effect.fn("cloudflareRest.resolveZoneId")(function* (
  apiToken: string,
  zoneName: string,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const envelope = yield* cfRequest<ReadonlyArray<{ readonly id: string; readonly name: string }>>(
    httpClient,
    apiToken,
    "GET",
    `/zones?name=${encodeURIComponent(zoneName)}&per_page=5`,
  );
  const match = envelope.result.find(
    (zone) => normalizeHostname(zone.name) === normalizeHostname(zoneName),
  );
  if (!match) {
    return yield* new CloudflareRestError({
      status: 404,
      codes: [],
      detail: `Cloudflare zone '${zoneName}' not found.`,
    });
  }
  return match.id;
});

export function layerCloudflareRestClients(input: {
  readonly apiToken: string;
  readonly accountId: string;
  readonly zoneId: string;
}) {
  const { apiToken, accountId, zoneId } = input;
  const tunnelBase = `/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`;
  const dnsBase = `/zones/${encodeURIComponent(zoneId)}/dns_records`;

  return Layer.unwrap(
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom;
      const httpClient = yield* HttpClient.HttpClient;

      return Layer.mergeAll(
        layerTunnelClient({
          get: (tunnelId) =>
            cfRequest<Record<string, unknown>>(
              httpClient,
              apiToken,
              "GET",
              `${tunnelBase}/${encodeURIComponent(tunnelId)}`,
            ).pipe(
              Effect.map((res) => mapTunnel(res.result)),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({ operation: "get", tunnelId, cause }),
              ),
            ),
          list: Effect.fn("CloudflareRestClient.list")(function* (request) {
            const params = new URLSearchParams();
            params.set("is_deleted", String(request.isDeleted));
            if (request.name) params.set("name", request.name);
            if (request.includePrefix) params.set("include_prefix", request.includePrefix);
            if (request.status) params.set("status", request.status);
            if (request.existedAt) params.set("existed_at", request.existedAt);
            if (request.wasInactiveAt) params.set("was_inactive_at", request.wasInactiveAt);
            if (request.page !== undefined) params.set("page", String(request.page));
            if (request.perPage !== undefined) params.set("per_page", String(request.perPage));
            return yield* cfRequest<ReadonlyArray<Record<string, unknown>>>(
              httpClient,
              apiToken,
              "GET",
              `${tunnelBase}?${params.toString()}`,
            ).pipe(
              Effect.map((res) => ({
                result: res.result.map(mapTunnel),
                resultInfo: res.result_info
                  ? {
                      page: res.result_info.page ?? null,
                      perPage: res.result_info.per_page ?? null,
                      totalCount: res.result_info.total_count ?? null,
                    }
                  : null,
              })),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({
                    operation: "list",
                    ...(request.name === undefined ? {} : { tunnelName: request.name }),
                    cause,
                  }),
              ),
            );
          }),
          create: (request) =>
            cfRequest<Record<string, unknown>>(httpClient, apiToken, "POST", tunnelBase, {
              name: request.name,
              config_src: request.configSrc,
            }).pipe(
              Effect.map((res) => mapTunnel(res.result)),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({
                    operation: "create",
                    tunnelName: request.name,
                    cause,
                  }),
              ),
            ),
          putConfiguration: (tunnelId, config) =>
            cfRequest(
              httpClient,
              apiToken,
              "PUT",
              `${tunnelBase}/${encodeURIComponent(tunnelId)}/configurations`,
              { config },
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({
                    operation: "put-configuration",
                    tunnelId,
                    cause,
                  }),
              ),
            ),
          getConfiguration: (tunnelId) =>
            cfRequest<{
              readonly config?: {
                readonly ingress?: ReadonlyArray<{
                  readonly hostname?: string | null;
                  readonly path?: string | null;
                  readonly service: string;
                }>;
              };
            }>(
              httpClient,
              apiToken,
              "GET",
              `${tunnelBase}/${encodeURIComponent(tunnelId)}/configurations`,
            ).pipe(
              Effect.map((res) => ({ ingress: res.result?.config?.ingress ?? [] })),
              Effect.catchIf(
                (error) => error.codes.includes(1055),
                () => Effect.succeed({ ingress: [] }),
              ),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({
                    operation: "get-configuration",
                    tunnelId,
                    cause,
                  }),
              ),
            ),
          getToken: (tunnelId) =>
            cfRequest<string>(
              httpClient,
              apiToken,
              "GET",
              `${tunnelBase}/${encodeURIComponent(tunnelId)}/token`,
            ).pipe(
              Effect.map((res) => res.result),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({ operation: "get-token", tunnelId, cause }),
              ),
            ),
          delete: (tunnelId) =>
            cfRequest(
              httpClient,
              apiToken,
              "DELETE",
              `${tunnelBase}/${encodeURIComponent(tunnelId)}`,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({ operation: "delete", tunnelId, cause }),
              ),
            ),
          disconnect: (tunnelId) =>
            random.randomBytes(32).pipe(
              Effect.flatMap((secret) =>
                cfRequest(
                  httpClient,
                  apiToken,
                  "PATCH",
                  `${tunnelBase}/${encodeURIComponent(tunnelId)}`,
                  { tunnel_secret: Base64.encode(secret) },
                ).pipe(
                  Effect.andThen(
                    cfRequest(
                      httpClient,
                      apiToken,
                      "DELETE",
                      `${tunnelBase}/${encodeURIComponent(tunnelId)}/connections`,
                    ),
                  ),
                ),
              ),
              Effect.asVoid,
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointTunnelClientError({
                    operation: "disconnect",
                    tunnelId,
                    cause,
                  }),
              ),
            ),
        }),
        layerDnsClient({
          listRecords: (hostname) =>
            cfRequest<ReadonlyArray<{ readonly id?: string; readonly name?: string }>>(
              httpClient,
              apiToken,
              "GET",
              `${dnsBase}?name=${encodeURIComponent(hostname)}&per_page=20`,
            ).pipe(
              Effect.map((res) =>
                res.result.filter(
                  (record): record is { readonly id: string; readonly name: string } =>
                    typeof record.id === "string" &&
                    typeof record.name === "string" &&
                    normalizeHostname(record.name) === normalizeHostname(hostname),
                ),
              ),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointDnsClientError({ operation: "list-records", hostname, cause }),
              ),
            ),
          createRecord: (request) =>
            cfRequest<{ readonly id: string }>(httpClient, apiToken, "POST", dnsBase, request).pipe(
              Effect.map((res) => ({ id: res.result.id })),
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointDnsClientError({
                    operation: "create-record",
                    hostname: request.name,
                    cause,
                  }),
              ),
            ),
          updateRecord: (dnsRecordId, request) =>
            cfRequest(
              httpClient,
              apiToken,
              "PUT",
              `${dnsBase}/${encodeURIComponent(dnsRecordId)}`,
              request,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointDnsClientError({
                    operation: "update-record",
                    hostname: request.name,
                    dnsRecordId,
                    cause,
                  }),
              ),
            ),
          deleteRecord: (dnsRecordId) =>
            cfRequest(
              httpClient,
              apiToken,
              "DELETE",
              `${dnsBase}/${encodeURIComponent(dnsRecordId)}`,
            ).pipe(
              Effect.mapError(
                (cause) =>
                  new ManagedEndpointDnsClientError({
                    operation: "delete-record",
                    dnsRecordId,
                    cause,
                  }),
              ),
            ),
        }),
      );
    }),
  );
}
