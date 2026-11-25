import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import { T, useGT } from "gt-react";
import { useState } from "react";

import {
  readCustomRelayUrlOverride,
  resolveDefaultRelayUrl,
  writeWebCustomRelayUrlOverride,
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
  const setDesktopCustomRelayUrl = window.desktopBridge?.setCustomRelayUrl;
  const [savedUrl, setSavedUrl] = useState<string | null>(() => readCustomRelayUrlOverride());
  const [draft, setDraft] = useState(() => savedUrl ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedDraft = draft.trim();
  const normalizedDraft = trimmedDraft === "" ? null : normalizeSecureRelayUrl(trimmedDraft);
  const isInvalid = trimmedDraft !== "" && normalizedDraft === null;
  const hasChanges = normalizedDraft !== savedUrl;

  const applyRelayUrl = async (nextUrl: string | null) => {
    setIsSaving(true);
    setError(null);
    try {
      if (isDesktop && setDesktopCustomRelayUrl) {
        await setDesktopCustomRelayUrl(nextUrl);
      } else {
        writeWebCustomRelayUrlOverride(nextUrl);
        setSavedUrl(nextUrl);
        setDraft(nextUrl ?? "");
        window.location.reload();
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? (thrownErrorMessage(cause, m) ?? cause.message)
          : gt("Couldn't update the custom relay URL."),
      );
      setIsSaving(false);
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("custom-relay-url")}
      description={
        savedUrl
          ? gt("Using custom self-hosted relay: {url}. Clear to use the default relay.", {
              url: savedUrl,
            })
          : gt(
              "Optional HTTPS origin for a self-hosted T3 Connect relay. Leave empty to use the official default ({url}).",
              { url: defaultRelayUrl ?? "https://relay.t3.codes" },
            )
      }
    >
      <div className="flex w-full flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setError(null);
            }}
            placeholder={defaultRelayUrl ?? "https://relay.t3.codes"}
            aria-label={gt("Custom relay URL")}
            size="sm"
            className="min-w-0 flex-1"
            disabled={isSaving}
          />
          {savedUrl ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSaving}
              onClick={() => void applyRelayUrl(null)}
            >
              <T>Use default</T>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={isSaving || isInvalid || !hasChanges}
            onClick={() => void applyRelayUrl(normalizedDraft)}
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
        {isInvalid ? (
          <p className="text-xs text-destructive">
            <T>Enter a valid HTTPS origin (for example, https://relay.example.com).</T>
          </p>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}
