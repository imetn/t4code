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
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const DEFAULT_RELEASE_REPOSITORY = "imetn/t4code";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+-t4\.\d+$/u;
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

class DirtyWorktreeError extends Schema.TaggedError<DirtyWorktreeError>()("DirtyWorktreeError", {
  status: Schema.String,
}) {
  override get message(): string {
    return `Refusing to publish from a dirty git worktree:\n${this.status}`;
  }
}

class UnsignedPublishForbiddenError extends Schema.TaggedError<UnsignedPublishForbiddenError>()(
  "UnsignedPublishForbiddenError",
  {},
) {
  override get message(): string {
    return "Refusing to publish an unsigned macOS release (breaks Squirrel.Mac auto-updates and Gatekeeper).";
  }
}

class MissingSigningEnvError extends Schema.TaggedError<MissingSigningEnvError>()(
  "MissingSigningEnvError",
  { missing: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Missing required macOS signing/notarization environment variables: ${this.missing.join(", ")}. Export them before building, or pass --unsigned for an unpublished local build.`;
  }
}

class ReleaseVerificationError extends Schema.TaggedError<ReleaseVerificationError>()(
  "ReleaseVerificationError",
  { check: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Signed macOS artifact verification failed (${this.check}):\n${this.detail}`;
  }
}

const hasNonEmptyEnv = (name: string): boolean => (process.env[name]?.trim().length ?? 0) > 0;

const assertSigningAndNotaryEnv = Effect.fn("release-t4.assertSigningAndNotaryEnv")(function* () {
  const missing: string[] = [];
  if (!hasNonEmptyEnv("CSC_LINK") && !hasNonEmptyEnv("CSC_NAME")) {
    missing.push("CSC_LINK (or CSC_NAME)");
  }

  const hasApiKeyNotary =
    hasNonEmptyEnv("APPLE_API_KEY") &&
    hasNonEmptyEnv("APPLE_API_KEY_ID") &&
    hasNonEmptyEnv("APPLE_API_ISSUER");
  const hasAppleIdNotary =
    hasNonEmptyEnv("APPLE_ID") &&
    hasNonEmptyEnv("APPLE_APP_SPECIFIC_PASSWORD") &&
    hasNonEmptyEnv("APPLE_TEAM_ID");

  if (!hasApiKeyNotary && !hasAppleIdNotary) {
    missing.push(
      "APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER (or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID)",
    );
  }

  if (missing.length > 0) {
    return yield* new MissingSigningEnvError({ missing });
  }
});

const spawnAndCollect = Effect.fn("release-t4.spawnAndCollect")(function* (
  command: ChildProcess.Command,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(command);
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      child.stdout.pipe(Stream.decodeText(), Stream.mkString),
      child.stderr.pipe(Stream.decodeText(), Stream.mkString),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode } as const;
});

// electron-builder staples the .app bundle inside the DMG rather than the outer DMG itself.
const verifySignedMacDmg = Effect.fn("release-t4.verifySignedMacDmg")(function* (dmgPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* Effect.scoped(
    Effect.gen(function* () {
      const mountDir = yield* Effect.acquireRelease(
        fs.makeTempDirectory({ prefix: "t4-release-verify-" }),
        (dir) => fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
      );

      yield* Effect.acquireRelease(
        spawnAndCollect(
          ChildProcess.make("hdiutil", [
            "attach",
            "-readonly",
            "-nobrowse",
            "-mountpoint",
            mountDir,
            dmgPath,
          ]),
        ).pipe(
          Effect.flatMap((result) =>
            result.exitCode === 0
              ? Effect.void
              : Effect.fail(
                  new ReleaseVerificationError({
                    check: "hdiutil attach",
                    detail: `${result.stdout}\n${result.stderr}`.trim(),
                  }),
                ),
          ),
        ),
        () =>
          spawnAndCollect(ChildProcess.make("hdiutil", ["detach", mountDir, "-force"])).pipe(
            Effect.ignore,
          ),
      );

      const appPath = path.join(mountDir, "T4 Code.app");
      if (!(yield* fs.exists(appPath))) {
        return yield* new ReleaseVerificationError({
          check: "app bundle",
          detail: `Expected 'T4 Code.app' inside mounted DMG at ${mountDir}.`,
        });
      }

      const codesign = yield* spawnAndCollect(
        ChildProcess.make("codesign", ["-dv", "--verbose=2", appPath]),
      );
      const codesignOutput = `${codesign.stdout}\n${codesign.stderr}`.trim();
      if (
        codesign.exitCode !== 0 ||
        !codesignOutput.includes("Authority=Developer ID Application:")
      ) {
        return yield* new ReleaseVerificationError({
          check: "codesign Developer ID Application",
          detail: codesignOutput || `codesign exited with code ${codesign.exitCode}`,
        });
      }

      const stapler = yield* spawnAndCollect(
        ChildProcess.make("xcrun", ["stapler", "validate", appPath]),
      );
      if (stapler.exitCode !== 0) {
        return yield* new ReleaseVerificationError({
          check: "xcrun stapler validate",
          detail: `${stapler.stdout}\n${stapler.stderr}`.trim(),
        });
      }

      const spctl = yield* spawnAndCollect(ChildProcess.make("spctl", ["-a", "-vvv", appPath]));
      if (spctl.exitCode !== 0) {
        return yield* new ReleaseVerificationError({
          check: "spctl assessment",
          detail: `${spctl.stdout}\n${spctl.stderr}`.trim(),
        });
      }
    }),
  );

  yield* Effect.log(
    `[release-t4] Verified Developer ID signature, Apple notarization staple, and Gatekeeper assessment for ${path.basename(dmgPath)}.`,
  );
});

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

const runCommandOutput = Effect.fn("release-t4.runCommandOutput")(function* (
  command: ChildProcess.Command,
  label: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdout = yield* spawner
    .string(command)
    .pipe(Effect.mapError(() => new ReleaseCommandFailedError({ command: label, exitCode: 1 })));
  return stdout.trim();
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
  readonly notesFile: Option.Option<string>;
}) {
  const normalizedVersion = input.version.trim().replace(/^v/u, "");
  if (!SEMVER_PATTERN.test(normalizedVersion)) {
    return yield* new InvalidReleaseVersionError({ version: input.version });
  }
  if (input.publish && input.unsigned) {
    return yield* new UnsignedPublishForbiddenError();
  }
  if (!input.unsigned) {
    yield* assertSigningAndNotaryEnv();
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

  if (!input.unsigned) {
    yield* verifySignedMacDmg(
      path.join(outputDir, `T4-Code-${normalizedVersion}-${input.arch}.dmg`),
    );
  }

  if (!input.publish) {
    yield* Effect.log("[release-t4] Build complete (dry run; pass --publish to upload via gh).");
    return;
  }

  const gitStatus = yield* runCommandOutput(
    ChildProcess.make("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repoRoot }),
    "git status",
  );
  if (gitStatus.length > 0) {
    return yield* new DirtyWorktreeError({ status: gitStatus });
  }
  const targetSha = yield* runCommandOutput(
    ChildProcess.make("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    "git rev-parse HEAD",
  );

  const entries = yield* fs.readDirectory(outputDir);
  const versionNeedle = `-${normalizedVersion}-`;
  const uploadAssets = entries
    .filter(
      (entry) =>
        entry === "latest-mac.yml" ||
        (entry.includes(versionNeedle) &&
          (entry.endsWith(".dmg") ||
            entry.endsWith(".zip") ||
            entry.endsWith(".blockmap") ||
            entry.endsWith(".tar.gz"))),
    )
    .sort()
    .map((entry) => path.join(outputDir, entry));

  const tag = `v${normalizedVersion}`;
  const notesArgs = Option.match(input.notesFile, {
    onNone: () => ["--generate-notes"],
    onSome: (file) => ["--notes-file", path.resolve(repoRoot, file)],
  });
  const ghArgs = [
    "release",
    "create",
    tag,
    ...uploadAssets,
    "--repo",
    repository,
    "--target",
    targetSha,
    "--title",
    `T4 Code ${tag}`,
    ...notesArgs,
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
    notesFile: Flag.String("notes-file").pipe(
      Flag.optional,
      Flag.withDescription("Optional path to a release notes file (defaults to --generate-notes)."),
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
