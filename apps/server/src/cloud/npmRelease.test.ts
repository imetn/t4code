import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";

import * as NpmRelease from "./npmRelease.ts";

const stableVersion = "0.1.12-t4.10";
const nightlyVersion = "0.1.12-nightly.20261127.1";

const makeService = Effect.fnUntraced(function* (
  handler: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse>,
) {
  return yield* NpmRelease.make().pipe(
    Effect.provideService(HttpClient.HttpClient, HttpClient.make(handler)),
  );
});

it.effect("reads latest and nightly tracks from imetn/t4code GitHub releases and caches them", () =>
  Effect.gen(function* () {
    const urls: string[] = [];
    const service = yield* makeService((request) => {
      urls.push(request.url);
      const body = JSON.stringify([
        { tag_name: "v0.1.12-t4.11", draft: true },
        {
          tag_name: `v${stableVersion}`,
          draft: false,
          body: "Release notes\nt3code-database-migration: 42\n",
        },
        { tag_name: `v${nightlyVersion}`, draft: false, body: "Nightly notes" },
      ]);
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body)));
    });

    expect(yield* service.get({ spec: "latest" })).toEqual({
      version: stableVersion,
      databaseMigration: 42,
    });
    expect(yield* service.get({ spec: "latest" })).toEqual({
      version: stableVersion,
      databaseMigration: 42,
    });
    expect(yield* service.get({ spec: "nightly" })).toEqual({
      version: nightlyVersion,
    });
    expect(urls).toEqual([
      "https://api.github.com/repos/imetn/t4code/releases?per_page=100&page=1",
      "https://api.github.com/repos/imetn/t4code/releases?per_page=100&page=1",
    ]);

    yield* TestClock.adjust("1 minute");
    expect(yield* service.get({ spec: "latest" })).toEqual({
      version: stableVersion,
      databaseMigration: 42,
    });
    expect(urls).toHaveLength(3);
  }),
);

it.effect("returns null for nightly when imetn/t4code has no nightly releases", () =>
  Effect.gen(function* () {
    const urls: string[] = [];
    const service = yield* makeService((request) => {
      urls.push(request.url);
      const body = JSON.stringify([{ tag_name: `v${stableVersion}`, draft: false }]);
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body)));
    });

    expect(yield* service.get({ spec: "nightly" })).toBeNull();
    // Stops after a partial page (< 100 entries) without fetching an extra empty page.
    expect(urls).toEqual([
      "https://api.github.com/repos/imetn/t4code/releases?per_page=100&page=1",
    ]);
  }),
);

it.effect("reports a clear rate-limit error on GitHub 429 or exhausted 403", () =>
  Effect.gen(function* () {
    const service = yield* makeService((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
        ),
      ),
    );
    const found = yield* service.get({ spec: "latest" }).pipe(Effect.result);
    expect(Result.isFailure(found)).toBe(true);
    if (Result.isFailure(found)) {
      expect(found.failure).toBeInstanceOf(ServerNpmReleaseError);
      expect(found.failure.message).toContain("rate limit");
    }
  }),
);

it.effect(
  "resolves exact versions via GitHub release tag lookup and treats 404 or draft as null",
  () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const service = yield* makeService((request) => {
        urls.push(request.url);
        if (request.url.endsWith(`/v${stableVersion}`)) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  tag_name: `v${stableVersion}`,
                  draft: false,
                  body: "t3code-database-migration: 55",
                }),
              ),
            ),
          );
        }
        if (request.url.endsWith("/v0.1.12-t4.99")) {
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ tag_name: "v0.1.12-t4.99", draft: true })),
            ),
          );
        }
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("{}", { status: 404 })),
        );
      });

      expect(yield* service.get({ spec: stableVersion })).toEqual({
        version: stableVersion,
        databaseMigration: 55,
      });
      expect(yield* service.get({ spec: "0.1.12-t4.99" })).toBeNull();
      expect(yield* service.get({ spec: "9.9.9" })).toBeNull();
      expect(urls).toEqual([
        `https://api.github.com/repos/imetn/t4code/releases/tags/v${stableVersion}`,
        "https://api.github.com/repos/imetn/t4code/releases/tags/v0.1.12-t4.99",
        "https://api.github.com/repos/imetn/t4code/releases/tags/v9.9.9",
      ]);
    }),
);

it.effect.each([
  new Response("not json"),
  new Response(JSON.stringify({ tag_name: "v9.9.9" })),
  new Response('{"message":"sensitive token"}', { status: 500 }),
  new Response('{"message":"rate limited"}', { status: 403 }),
])("reports an unavailable lookup without leaking upstream error details", (response) =>
  Effect.gen(function* () {
    const service = yield* makeService((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, response.clone())),
    );
    const found = yield* service.get({ spec: stableVersion }).pipe(Effect.result);
    expect(Result.isFailure(found)).toBe(true);
    if (Result.isFailure(found)) {
      expect(found.failure).toBeInstanceOf(ServerNpmReleaseError);
      expect(found.failure.message).not.toContain("sensitive");
    }
  }),
);

it.effect("times out stalled GitHub release lookups", () =>
  Effect.gen(function* () {
    const service = yield* makeService((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(new ReadableStream()))),
    );
    const stalled = yield* service.get({ spec: "latest" }).pipe(Effect.result, Effect.forkChild);
    yield* TestClock.adjust("15 seconds");
    expect(Result.isFailure(yield* Fiber.join(stalled))).toBe(true);
  }),
);

it.effect("runs at most two release lookups at once", () =>
  Effect.gen(function* () {
    const started = yield* Queue.unbounded<void>();
    const release = yield* Deferred.make<void>();
    let running = 0;
    let peak = 0;
    const service = yield* makeService((request) =>
      Effect.gen(function* () {
        peak = Math.max(peak, ++running);
        yield* Queue.offer(started, undefined);
        yield* Deferred.await(release);
        running--;
        return HttpClientResponse.fromWeb(request, new Response("{}", { status: 404 }));
      }),
    );
    const lookups = yield* Effect.forEach(
      ["1.0.0", "1.0.1", "1.0.2"],
      (spec) => service.get({ spec }),
      { concurrency: "unbounded" },
    ).pipe(Effect.forkChild);
    yield* Queue.take(started);
    yield* Queue.take(started);
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(lookups)).toEqual([null, null, null]);
    expect(peak).toBe(2);
  }),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "rejects invalid release specs before making HTTP requests: %s",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* makeService(() =>
        Effect.die("invalid specs must not call GitHub releases"),
      );
      expect(Result.isFailure(yield* service.get({ spec }).pipe(Effect.result))).toBe(true);
    }),
);
