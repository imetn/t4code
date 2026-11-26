#!/usr/bin/env node
/**
 * Local T4 Code macOS release helper (strictly env-var driven, zero telemetry).
 *
 * Builds the signed macOS DMG, ZIP, and latest-mac.yml via build-desktop-artifact.ts
 * and optionally publishes them with any staged Linux CLI archives via `gh release`.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const DEFAULT_RELEASE_REPOSITORY = "imetn/t4code";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const MacArch = Schema.Literals(["arm64", "x64", "universal"]);

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);

class InvalidReleaseVersionError extends Schema.TaggedError<InvalidReleaseVersionError>()(
  "InvalidReleaseVersionError",
  { version: Schema.String },
) {
  override get message(): string {
    return `Invalid release version '${this.version}'. Expected semver (for example 0.1.14-t4.1).`;
  }
}

class ReleaseCommandFailedError extends Schema.TaggedError<ReleaseCommandFailedError>()(
  "ReleaseCommandFailedError",
  { command: Schema.String, exitCode: Schema.Int },
) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}.`;
  }
}

class MissingReleaseAssetError extends Schema.TaggedError<MissingReleaseAssetError>()(
  "MissingReleaseAssetError",
  { missing: Schema.Array(Schema.String), outputDir: Schema.String },
) {
  override get message(): string {
    return `Missing expected release assets in ${this.outputDir}: ${this.missing.join(", ")}`;
  }
}

const runCommand = Effect.fn("release-t4.runCommand")(function* (
  command: ChildProcess.Command,
  label: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new ReleaseCommandFailedError({ command: label, exitCode });
  }
});

const releaseT4 = Effect.fn("release-t4.run")(function* (input: {
  readonly version: string;
  readonly arch: typeof MacArch.Type;
  readonly outputDir: string;
  readonly unsigned: boolean;
  readonly skipBuild: boolean;
  readonly verbose: boolean;
  readonly publish: boolean;
  readonly draft: boolean;
}) {
  const normalizedVersion = input.version.trim().replace(/^v/u, "");
  if (!SEMVER_PATTERN.test(normalizedVersion)) {
    return yield* new InvalidReleaseVersionError({ version: input.version });
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const outputDir = path.resolve(repoRoot, input.outputDir);

  const repository = yield* Config.String("T3CODE_DESKTOP_UPDATE_REPOSITORY").pipe(
    Config.withDefault(DEFAULT_RELEASE_REPOSITORY),
  );

  const buildArgs = [
    path.join(repoRoot, "scripts/build-desktop-artifact.ts"),
    "--platform",
    "mac",
    "--arch",
    input.arch,
    "--target",
    "dmg",
    "--build-version",
    normalizedVersion,
    "--output-dir",
    outputDir,
    ...(input.unsigned ? [] : ["--signed"]),
    ...(input.skipBuild ? ["--skip-build"] : []),
    ...(input.verbose ? ["--verbose"] : []),
  ];

  yield* Effect.log(
    `[release-t4] Building T4 Code v${normalizedVersion} (mac/${input.arch}, repo=${repository}, signed=${String(!input.unsigned)})...`,
  );

  yield* runCommand(
    ChildProcess.make(process.execPath, buildArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        T3CODE_TELEMETRY_CHANNEL: "dev",
        T3CODE_DESKTOP_UPDATE_REPOSITORY: repository,
      },
      stdout: "inherit",
      stderr: "inherit",
    }),
    "build-desktop-artifact",
  );

  const expectedAssets = [
    `T4-Code-${normalizedVersion}-${input.arch}.dmg`,
    `T4-Code-${normalizedVersion}-${input.arch}.zip`,
    "latest-mac.yml",
  ];
  const missing: string[] = [];
  for (const name of expectedAssets) {
    if (!(yield* fs.exists(path.join(outputDir, name)))) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    return yield* new MissingReleaseAssetError({ missing, outputDir });
  }

  yield* Effect.log(`[release-t4] Verified macOS release assets in ${outputDir}.`);

  if (!input.publish) {
    yield* Effect.log("[release-t4] Build complete (dry run; pass --publish to upload via gh).");
    return;
  }

  const entries = yield* fs.readDirectory(outputDir);
  const uploadAssets = entries
    .filter(
      (entry) =>
        entry.endsWith(".dmg") ||
        entry.endsWith(".zip") ||
        entry.endsWith(".blockmap") ||
        entry === "latest-mac.yml" ||
        entry.endsWith(".tar.gz") ||
        entry === "SHA256SUMS",
    )
    .sort()
    .map((entry) => path.join(outputDir, entry));

  const tag = `v${normalizedVersion}`;
  const ghArgs = [
    "release",
    "create",
    tag,
    ...uploadAssets,
    "--repo",
    repository,
    "--title",
    `T4 Code ${tag}`,
    "--generate-notes",
    ...(input.draft ? ["--draft"] : ["--latest"]),
  ];

  yield* Effect.log(
    `[release-t4] Publishing ${tag} to ${repository} (${uploadAssets.length} files)...`,
  );
  yield* runCommand(
    ChildProcess.make("gh", ghArgs, {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    }),
    "gh release create",
  );
});

const command = Command.make(
  "release-t4",
  {
    version: Flag.String("release-version").pipe(
      Flag.withDescription("Release version without leading v (for example 0.1.14-t4.1)."),
    ),
    arch: Flag.Literals("arch", MacArch.literals).pipe(
      Flag.withDefault("arm64"),
      Flag.withDescription("macOS target architecture (default: arm64)."),
    ),
    outputDir: Flag.String("output-dir").pipe(
      Flag.withDefault("release"),
      Flag.withDescription("Directory for built release artifacts (default: release)."),
    ),
    unsigned: Flag.Boolean("unsigned").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Skip Developer ID signing and notarization."),
    ),
    skipBuild: Flag.Boolean("skip-build").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Reuse existing dist-electron and server dist bundles."),
    ),
    verbose: Flag.Boolean("verbose").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Stream build and signing logs."),
    ),
    publish: Flag.Boolean("publish").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Create and upload the GitHub Release via gh."),
    ),
    draft: Flag.Boolean("draft").pipe(
      Flag.withDefault(false),
      Flag.withDescription("When publishing, create the GitHub Release as a draft."),
    ),
  },
  (input) => releaseT4(input).pipe(Effect.scoped),
).pipe(Command.withDescription("Build and optionally publish a T4 Code release."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
