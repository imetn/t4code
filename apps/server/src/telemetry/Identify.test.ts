import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_LINKED_USER_ID } from "../cloud/config.ts";
import * as ServerConfig from "../config.ts";
import * as Identify from "./Identify.ts";

const layerIdentity = (prefix: string) =>
  Layer.provideMerge(ServerSecretStore.layer, ServerConfig.layerTest(process.cwd(), { prefix }));

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("telemetry identity", (it) => {
  it.effect("always returns null identity and never creates an anonymous-id file", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      assert.deepEqual(yield* Identify.getTelemetryIdentity, {
        distinctId: null,
        installId: null,
      });
      assert.isFalse(yield* fileSystem.exists(config.anonymousIdPath));
    }).pipe(Effect.provide(layerIdentity("t3-telemetry-identify-disabled-"))),
  );

  it.effect("ignores any pre-existing anonymous-id file on disk", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.writeFileString(config.anonymousIdPath, "persisted-anonymous-id");

      assert.deepEqual(yield* Identify.getTelemetryIdentity, {
        distinctId: null,
        installId: null,
      });
    }).pipe(Effect.provide(layerIdentity("t3-telemetry-identify-existing-"))),
  );

  it.effect("never reports server owners even when a Connect account is linked", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* secrets.set(CLOUD_LINKED_USER_ID, new TextEncoder().encode("user_connect"));

      assert.deepEqual(yield* Identify.getServerOwners, []);
    }).pipe(Effect.provide(layerIdentity("t3-telemetry-identify-owners-"))),
  );
});
