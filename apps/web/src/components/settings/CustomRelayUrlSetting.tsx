import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import { T, useGT } from "gt-react";
import { useState } from "react";

import {
  normalizeClerkPublishableKey,
  readCustomClerkCliOAuthClientIdOverride,
  readCustomClerkPublishableKeyOverride,
  readCustomRelayUrlOverride,
  resolveDefaultRelayUrl,
  writeWebCustomCloudConfigOverride,
} from "~/cloud/publicConfig";
import { m } from "~/i18n/messages";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function CustomRelayUrlSetting() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const defaultRelayUrl = resolveDefaultRelayUrl();
  const isDesktop = typeof window !== "undefined" && window.desktopBridge !== undefined;
  const setDesktopCustomCloudConfig = window.desktopBridge?.setCustomCloudConfig;

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

  return (
    <SettingsRow
      {...searchableSetting("custom-relay-url")}
      description={
        savedRelayUrl
          ? gt("Using custom self-hosted relay: {url}. Clear to use the default relay.", {
              url: savedRelayUrl,
            })
          : gt(
              "Optional self-hosted T3 Connect relay and Clerk instance. Leave empty to use the official defaults ({url}).",
              { url: defaultRelayUrl ?? "https://relay.t3.codes" },
            )
      }
    >
      <div className="flex w-full flex-col gap-2">
        <Input
          value={relayDraft}
          onChange={(event) => {
            setRelayDraft(event.currentTarget.value);
            setError(null);
          }}
          placeholder={defaultRelayUrl ?? "https://relay.t3.codes"}
          aria-label={gt("Custom relay URL")}
          size="sm"
          disabled={isSaving}
        />
        <Input
          value={clerkKeyDraft}
          onChange={(event) => {
            setClerkKeyDraft(event.currentTarget.value);
            setError(null);
          }}
          placeholder={gt("Optional Clerk publishable key (pk_live_... or pk_test_...)")}
          aria-label={gt("Custom Clerk publishable key")}
          size="sm"
          disabled={isSaving}
        />
        {isDesktop ? (
          <Input
            value={cliClientIdDraft}
            onChange={(event) => {
              setCliClientIdDraft(event.currentTarget.value);
              setError(null);
            }}
            placeholder={gt("Optional CLI OAuth client ID")}
            aria-label={gt("Custom CLI OAuth client ID")}
            size="sm"
            disabled={isSaving}
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hasSavedOverride ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSaving}
              onClick={() =>
                void applyConfig({
                  relayUrl: null,
                  clerkPublishableKey: null,
                  clerkCliOAuthClientId: null,
                })
              }
            >
              <T>Use default</T>
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
        {isRelayInvalid ? (
          <p className="text-xs text-destructive">
            <T>Enter a valid HTTPS origin (for example, https://relay.example.com).</T>
          </p>
        ) : null}
        {isClerkKeyInvalid ? (
          <p className="text-xs text-destructive">
            <T>Enter a valid Clerk publishable key starting with pk_live_ or pk_test_.</T>
          </p>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}
