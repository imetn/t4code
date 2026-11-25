import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import { T, useGT } from "gt-react";
import { ActivityIcon, CheckCircle2Icon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { usePrimaryCloudLinkState } from "~/cloud/cloudLinkState";
import {
  normalizeClerkPublishableKey,
  readCustomClerkCliOAuthClientIdOverride,
  readCustomClerkPublishableKeyOverride,
  readCustomRelayUrlOverride,
  resolveDefaultRelayUrl,
  writeWebCustomCloudConfigOverride,
} from "~/cloud/publicConfig";
import { m } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  latencyToneClassName,
  probeRelayHealth,
  relayHostLabel,
  resolveRelayVerificationState,
  type RelayProbeResult,
} from "./CustomRelayUrlSetting.logic";
import { SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const OFFICIAL_RELAY_FALLBACK = "https://relay.t3.codes";

type ProbeState =
  | { readonly status: "idle" }
  | { readonly status: "probing"; readonly targetHost: string | null }
  | {
      readonly status: "done";
      readonly targetHost: string | null;
      readonly result: RelayProbeResult;
    };

function probeFailureLabel(
  result: Extract<RelayProbeResult, { readonly ok: false }>,
  gt: ReturnType<typeof useGT>,
): string {
  switch (result.reason) {
    case "timeout":
      return gt("Timed out");
    case "http-error":
      return result.status !== null
        ? gt("HTTP {status}", { status: result.status })
        : gt("Error response");
    case "invalid-response":
      return gt("Not a T3 relay");
    case "invalid-url":
      return gt("Invalid URL");
    case "unreachable":
      return gt("Unreachable");
  }
}

export function CustomRelayUrlSetting() {
  const searchableSetting = useSearchableSetting();
  const search = searchableSetting("custom-relay-url");
  const gt = useGT();
  const defaultRelayUrl = resolveDefaultRelayUrl();
  const isDesktop = typeof window !== "undefined" && window.desktopBridge !== undefined;
  const setDesktopCustomCloudConfig = window.desktopBridge?.setCustomCloudConfig;
  const desktopProbeRelay = window.desktopBridge?.probeRelay;

  const [savedRelayUrl, setSavedRelayUrl] = useState<string | null>(() =>
    readCustomRelayUrlOverride(),
  );
  const [savedClerkKey, setSavedClerkKey] = useState<string | null>(() =>
    readCustomClerkPublishableKeyOverride(),
  );
  const [savedCliClientId, setSavedCliClientId] = useState<string | null>(() =>
    readCustomClerkCliOAuthClientIdOverride(),
  );

  const [relayDraft, setRelayDraft] = useState(() => savedRelayUrl ?? "");
  const [clerkKeyDraft, setClerkKeyDraft] = useState(() => savedClerkKey ?? "");
  const [cliClientIdDraft, setCliClientIdDraft] = useState(() => savedCliClientId ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeState, setProbeState] = useState<ProbeState>({ status: "idle" });
  const probeSerialRef = useRef(0);

  const relayInputId = useId();
  const clerkKeyInputId = useId();
  const cliClientIdInputId = useId();

  const cloudLinkState = usePrimaryCloudLinkState();
  const effectiveDefaultRelayUrl = defaultRelayUrl ?? OFFICIAL_RELAY_FALLBACK;

  const trimmedRelay = relayDraft.trim();
  const normalizedRelay = trimmedRelay === "" ? null : normalizeSecureRelayUrl(trimmedRelay);
  const isRelayInvalid = trimmedRelay !== "" && normalizedRelay === null;

  const trimmedClerkKey = clerkKeyDraft.trim();
  const normalizedClerkKey =
    trimmedClerkKey === "" ? null : normalizeClerkPublishableKey(trimmedClerkKey);
  const isClerkKeyInvalid = trimmedClerkKey !== "" && normalizedClerkKey === null;

  const normalizedCliClientId = cliClientIdDraft.trim() || null;

  const hasSavedOverride =
    savedRelayUrl !== null || savedClerkKey !== null || savedCliClientId !== null;
  const hasChanges =
    normalizedRelay !== savedRelayUrl ||
    normalizedClerkKey !== savedClerkKey ||
    (isDesktop && normalizedCliClientId !== savedCliClientId);

  const verification = resolveRelayVerificationState({
    savedRelayUrl,
    defaultRelayUrl: effectiveDefaultRelayUrl,
    savedClerkKey,
    savedCliClientId,
    isDesktop,
    cloudLink: cloudLinkState.data,
  });

  const draftNeedsClerkKey =
    normalizedRelay !== null &&
    normalizedRelay !== effectiveDefaultRelayUrl &&
    normalizedClerkKey === null;

  const probeTargetUrl = !isRelayInvalid
    ? (normalizedRelay ?? verification.activeRelayUrl ?? effectiveDefaultRelayUrl)
    : null;

  const runProbe = async (targetUrl: string) => {
    const serial = probeSerialRef.current + 1;
    probeSerialRef.current = serial;
    const targetHost = relayHostLabel(targetUrl);
    setProbeState({ status: "probing", targetHost });
    const result = await probeRelayHealth(
      targetUrl,
      desktopProbeRelay ? { desktopProbe: desktopProbeRelay } : {},
    );
    if (probeSerialRef.current !== serial) return;
    setProbeState({ status: "done", targetHost, result });
  };

  const initialProbeUrl = verification.activeRelayUrl;
  const probeInitialRelay = useEffectEvent(() => {
    if (initialProbeUrl === null) return;
    const serial = probeSerialRef.current + 1;
    probeSerialRef.current = serial;
    const targetHost = relayHostLabel(initialProbeUrl);
    void probeRelayHealth(
      initialProbeUrl,
      desktopProbeRelay ? { desktopProbe: desktopProbeRelay } : {},
    ).then((result) => {
      if (probeSerialRef.current !== serial) return;
      setProbeState({ status: "done", targetHost, result });
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- probes the active relay once on mount so reachability and RTT are visible immediately
  useEffect(() => {
    probeInitialRelay();
    return () => {
      probeSerialRef.current += 1;
    };
  }, []);

  const applyConfig = async (next: {
    readonly relayUrl: string | null;
    readonly clerkPublishableKey: string | null;
    readonly clerkCliOAuthClientId: string | null;
  }) => {
    setIsSaving(true);
    setError(null);
    try {
      if (isDesktop && setDesktopCustomCloudConfig) {
        await setDesktopCustomCloudConfig(next);
      } else {
        writeWebCustomCloudConfigOverride({
          relayUrl: next.relayUrl,
          clerkPublishableKey: next.clerkPublishableKey,
        });
        setSavedRelayUrl(next.relayUrl);
        setSavedClerkKey(next.clerkPublishableKey);
        setSavedCliClientId(null);
        setRelayDraft(next.relayUrl ?? "");
        setClerkKeyDraft(next.clerkPublishableKey ?? "");
        setCliClientIdDraft("");
        window.location.reload();
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? (thrownErrorMessage(cause, m) ?? cause.message)
          : gt("Couldn't update the custom relay configuration."),
      );
      setIsSaving(false);
    }
  };

  const isProbing = probeState.status === "probing";
  const headerHost =
    probeState.status !== "idle" && probeState.targetHost
      ? probeState.targetHost
      : (verification.activeHost ?? "relay.t3.codes");
  const statusDotClassName =
    probeState.status === "done" && !probeState.result.ok
      ? "bg-destructive"
      : verification.linkAlignment === "mismatched"
        ? "bg-warning"
        : probeState.status === "done" && probeState.result.ok
          ? "bg-success"
          : "bg-muted-foreground/40";

  const showMissingClerkWarning = verification.missingClerkKeyWarning || draftNeedsClerkKey;
  const tunnelHostname = cloudLinkState.data?.tunnelHostname ?? null;

  const verificationBanner =
    verification.linkAlignment === "mismatched" ? (
      <div className="flex items-start gap-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-4">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
        <p>
          {gt(
            "This machine is still linked to {linkedHost}. Unlink and re-link T3 Connect in Sharing & access to switch to {activeHost}.",
            {
              linkedHost: verification.linkedHost ?? gt("another relay"),
              activeHost: verification.activeHost ?? "relay.t3.codes",
            },
          )}
        </p>
      </div>
    ) : showMissingClerkWarning ? (
      <div className="flex items-start gap-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-4">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
        <p>
          <T>
            Self-hosted relays usually require a matching Clerk publishable key. After saving, sign
            out and sign back in so tunnels are provisioned on your relay.
          </T>
        </p>
      </div>
    ) : verification.isCustomRelay && verification.linkAlignment === "revoked" ? (
      <div className="flex items-start gap-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-4">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
        <p>
          {gt(
            "Using {activeHost}, but this machine's T3 Connect link was revoked. Re-link in Sharing & access.",
            { activeHost: verification.activeHost ?? "" },
          )}
        </p>
      </div>
    ) : verification.isCustomRelay && verification.linkAlignment === "matched" ? (
      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        <CheckCircle2Icon className="size-3.5 shrink-0 text-success-foreground" />
        <p className="min-w-0 truncate">
          <span className="font-medium text-foreground">
            <T>Active on this machine</T>
          </span>
          {tunnelHostname ? (
            <>
              <span aria-hidden> · </span>
              <span className="font-mono">{tunnelHostname}</span>
            </>
          ) : null}
        </p>
      </div>
    ) : verification.isCustomRelay && verification.linkAlignment === "unlinked" ? (
      <div className="flex items-start gap-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-4">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p>
          {gt(
            "Configured for {activeHost}. Turn on T3 Connect in Sharing & access to provision a tunnel on this relay.",
            { activeHost: verification.activeHost ?? "" },
          )}
        </p>
      </div>
    ) : null;

  return (
    <SettingsSection
      id={search.id}
      title={search.title}
      titleAction={
        <div className="ms-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", statusDotClassName)} />
          <span className="truncate font-mono">{headerHost}</span>
          <span aria-hidden>·</span>
          {isProbing ? (
            <span>
              <T>Checking…</T>
            </span>
          ) : probeState.status === "done" ? (
            probeState.result.ok ? (
              <span
                className={cn(
                  "shrink-0 font-mono tabular-nums",
                  latencyToneClassName(probeState.result.latencyMs),
                )}
              >
                {gt("{ms} ms", { ms: probeState.result.latencyMs })}
              </span>
            ) : (
              <span className="shrink-0 text-destructive">
                {probeFailureLabel(probeState.result, gt)}
              </span>
            )
          ) : verification.isCustomRelay ? (
            <span>
              <T>Custom</T>
            </span>
          ) : (
            <span>
              <T>Default</T>
            </span>
          )}
        </div>
      }
      headerAction={
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={isProbing || isSaving || probeTargetUrl === null}
          onClick={() => {
            if (probeTargetUrl !== null) void runProbe(probeTargetUrl);
          }}
        >
          {isProbing ? <Spinner size="xs" /> : <ActivityIcon className="size-3" />}
          {isProbing
            ? gt("Testing…")
            : gt("Test", { $context: "button: test relay reachability and latency" })}
        </Button>
      }
    >
      {verificationBanner}
      <div className="space-y-2 px-3 py-3.5 sm:px-4">
        <div className="space-y-0.5">
          <label htmlFor={relayInputId} className="block text-sm font-medium text-foreground">
            <T>Relay URL</T>
          </label>
          <p className="text-xs text-muted-foreground">
            {gt("HTTPS origin for your T3 Connect relay. Leave empty to use {url}.", {
              url: effectiveDefaultRelayUrl,
            })}
          </p>
        </div>
        <Input
          id={relayInputId}
          font="mono"
          value={relayDraft}
          onChange={(event) => {
            setRelayDraft(event.currentTarget.value);
            setError(null);
          }}
          placeholder="https://relay.example.com"
          aria-label={gt("Relay URL")}
          aria-invalid={isRelayInvalid || undefined}
          disabled={isSaving}
          spellCheck={false}
          autoComplete="off"
        />
        {isRelayInvalid ? (
          <p className="text-xs text-destructive">
            <T>Enter a valid HTTPS origin (for example, https://relay.example.com).</T>
          </p>
        ) : null}
      </div>

      <div className="space-y-2 px-3 py-3.5 sm:px-4">
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={clerkKeyInputId} className="text-sm font-medium text-foreground">
              <T>Clerk publishable key</T>
            </label>
            <span className="text-xs text-muted-foreground">
              <T>Optional</T>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            <T>Match the Clerk instance configured on your self-hosted relay.</T>
          </p>
        </div>
        <Input
          id={clerkKeyInputId}
          font="mono"
          value={clerkKeyDraft}
          onChange={(event) => {
            setClerkKeyDraft(event.currentTarget.value);
            setError(null);
          }}
          placeholder={gt("pk_live_… or pk_test_…")}
          aria-label={gt("Clerk publishable key")}
          aria-invalid={isClerkKeyInvalid || undefined}
          disabled={isSaving}
          spellCheck={false}
          autoComplete="off"
        />
        {isClerkKeyInvalid ? (
          <p className="text-xs text-destructive">
            <T>Enter a valid Clerk publishable key starting with pk_live_ or pk_test_.</T>
          </p>
        ) : null}
      </div>

      {isDesktop ? (
        <div className="space-y-2 px-3 py-3.5 sm:px-4">
          <div className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={cliClientIdInputId} className="text-sm font-medium text-foreground">
                <T>CLI OAuth client ID</T>
              </label>
              <span className="text-xs text-muted-foreground">
                <T>Optional</T>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              <T>Public Clerk OAuth client ID used when linking environments from the t3 CLI.</T>
            </p>
          </div>
          <Input
            id={cliClientIdInputId}
            font="mono"
            value={cliClientIdDraft}
            onChange={(event) => {
              setCliClientIdDraft(event.currentTarget.value);
              setError(null);
            }}
            placeholder={gt("Clerk OAuth client ID")}
            aria-label={gt("CLI OAuth client ID")}
            disabled={isSaving}
            spellCheck={false}
            autoComplete="off"
          />
          {verification.missingCliClientIdHint && normalizedCliClientId === null ? (
            <p className="text-xs text-muted-foreground">
              <T>Leave blank unless you also sign in from the t3 CLI.</T>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : hasChanges ? (
            <p className="text-xs text-muted-foreground">
              {isDesktop
                ? gt("T3 Code restarts to apply changes.")
                : gt("This page reloads to apply changes.")}
            </p>
          ) : verification.clerkHostname ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {gt("Clerk · {host}", { host: verification.clerkHostname })}
            </p>
          ) : null}
        </div>
        <div className="ms-auto flex items-center gap-2">
          {hasSavedOverride ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSaving}
              onClick={() =>
                void applyConfig({
                  relayUrl: null,
                  clerkPublishableKey: null,
                  clerkCliOAuthClientId: null,
                })
              }
            >
              <T>Reset to official</T>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={isSaving || isRelayInvalid || isClerkKeyInvalid || !hasChanges}
            onClick={() =>
              void applyConfig({
                relayUrl: normalizedRelay,
                clerkPublishableKey: normalizedClerkKey,
                clerkCliOAuthClientId: normalizedCliClientId,
              })
            }
          >
            {isSaving ? (
              <>
                <Spinner size="sm" />
                <T>Restarting…</T>
              </>
            ) : isDesktop ? (
              <T>Save &amp; restart</T>
            ) : (
              <T>Save &amp; reload</T>
            )}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
