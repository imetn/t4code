import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import * as Dialog from "../components/ui/Dialog";
import type { MediaActionsSource } from "../lib/mediaActionsSource";
import { useNavigation } from "@react-navigation/native";
import { msg, useGT } from "gt-react-native";
import { m } from "../i18n/messages";
import {
  formatFilePathForClipboard,
  type MediaActionId,
} from "@t3tools/client-runtime/media-actions";
import {
  AuthFilesystemReadScope,
  type EnvironmentId,
  sessionGrantsScope,
  type SessionGrantInput,
} from "@t3tools/contracts";
import { imageMimeType } from "@t3tools/shared/image";
import { assetImageCacheKey } from "../lib/assetImageSource";
import { normalizeNativeMarkdownUrl } from "../lib/markdownLinks";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { assetEnvironment, useRefreshAssetUrl } from "./assets";
import { appAtomRegistry } from "./atom-registry";
import { useEnvironmentQuery } from "./query";
import { environmentSession } from "./session";
import {
  downloadAndShareAttachment,
  downloadAttachmentForPreview,
  shareLocalAttachment,
} from "../lib/attachmentDownload";
import { copyTextWithHaptic } from "../lib/copyTextWithHaptic";
import { loadLocalAttachmentPreview } from "../lib/localAttachmentPreview";
import { canSaveImageToLibrary, saveImageToLibrary } from "../lib/saveImageToLibrary";

function allowsHostMedia(session: SessionGrantInput | null) {
  return session === null || sessionGrantsScope(session, AuthFilesystemReadScope);
}

function canReadHostMedia(environmentId: EnvironmentId | null): boolean {
  if (environmentId === null) return true;
  const result = appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId));
  return result._tag !== "Failure" && allowsHostMedia(AsyncResult.getOrElse(result, () => null));
}

export type QuoteMediaHandler = (input: {
  readonly uri: string;
  readonly name: string;
}) => Promise<boolean>;

export const QuoteMediaContext = createContext<QuoteMediaHandler | null>(null);

export function useMediaActions(
  source: MediaActionsSource | undefined,
  onOpenFile?: () => void,
  options?: {
    readonly getSaveImageSignal?: () => AbortSignal;
    readonly onQuoted?: () => void;
  },
) {
  const navigation = useNavigation();
  const gt = useGT();
  const onQuoteImage = useContext(QuoteMediaContext);
  const hostEnvironmentId =
    source &&
    "resource" in source &&
    (source.resource._tag === "workspace-file" || source.resource._tag === "media-file")
      ? source.environmentId
      : null;
  const fileSession = useEnvironmentQuery(
    hostEnvironmentId === null ? null : environmentSession.sessionStateAtom(hostEnvironmentId),
  );
  const canReadMedia =
    hostEnvironmentId === null ||
    (fileSession.error === null && fileSession.data !== null && allowsHostMedia(fileSession.data));
  const refresh = useRefreshAssetUrl(
    source && "environmentId" in source ? source.environmentId : null,
    source && "resource" in source ? source.resource : null,
  );
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<"share" | "save-image" | "quote-image" | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels page-owned work and stops updating busy state on unmount
  useEffect(() => () => controller.current?.abort(), []);

  const run = (
    kind: "share" | "save-image" | "quote-image",
    task: (source: MediaActionsSource, signal: AbortSignal) => Promise<void>,
  ) => {
    if (!source || controller.current || !canReadHostMedia(hostEnvironmentId)) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(kind);
    const signal =
      kind === "save-image" && options?.getSaveImageSignal
        ? options.getSaveImageSignal()
        : request.signal;
    return task(source, signal)
      .catch((error: unknown) => {
        if (!signal.aborted) {
          Dialog.alert(
            kind === "share"
              ? m(msg("Could not share file"))
              : kind === "quote-image"
                ? m(msg("Could not quote image"))
                : m(msg("Could not save image")),
            errorDisplayMessage(error, m) ?? m(msg("Try again.")),
          );
        }
      })
      .finally(() => {
        if (controller.current === request) {
          controller.current = null;
          if (!request.signal.aborted) setBusy(null);
        }
      });
  };

  const cachedHostUrl = (source: MediaActionsSource): string | null => {
    if (!("environmentId" in source && "resource" in source)) return null;
    try {
      if (!assetEnvironment?.createUrl || !environmentSession?.preparedConnectionValueAtom) {
        return null;
      }
      const queryResult = appAtomRegistry.get(
        assetEnvironment.createUrl({
          environmentId: source.environmentId,
          input: { resource: source.resource },
        }),
      );
      if (!AsyncResult.isSuccess(queryResult)) return null;
      if (queryResult.value.expiresAt <= Date.now() + 30_000) return null;
      const connection = appAtomRegistry.get(
        environmentSession.preparedConnectionValueAtom(source.environmentId),
      );
      if (connection._tag !== "Some") return null;
      const state = assetUrlStateFromResult(queryResult, connection.value.httpBaseUrl);
      return state._tag === "Success" ? state.url : null;
    } catch {
      return null;
    }
  };

  const resolveCachedImageFile = async (source: MediaActionsSource) => {
    try {
      const [{ Image }, { File }] = await Promise.all([
        import("expo-image"),
        import("expo-file-system"),
      ]);
      const candidates: string[] = [];
      if ("uri" in source) {
        const normalized = normalizeNativeMarkdownUrl(source.uri);
        if (normalized) candidates.push(normalized);
      } else if ("environmentId" in source && "resource" in source) {
        const staticKey = assetImageCacheKey(source.environmentId, source.resource);
        if (staticKey) candidates.push(staticKey);
        const queryResult = appAtomRegistry.get(
          assetEnvironment.createUrl({
            environmentId: source.environmentId,
            input: { resource: source.resource },
          }),
        );
        if (AsyncResult.isSuccess(queryResult)) {
          const revKey = assetImageCacheKey(
            source.environmentId,
            source.resource,
            queryResult.value.fileRevision,
          );
          if (revKey && revKey !== staticKey) candidates.push(revKey);
          const connection = appAtomRegistry.get(
            environmentSession.preparedConnectionValueAtom(source.environmentId),
          );
          if (connection._tag === "Some") {
            const state = assetUrlStateFromResult(queryResult, connection.value.httpBaseUrl);
            if (state._tag === "Success") candidates.push(state.url);
          }
        }
      }
      for (const candidate of candidates) {
        const path = await Image.getCachePathAsync(candidate);
        if (!path) continue;
        const uri = path.startsWith("file:") ? path : `file://${path}`;
        if (new File(uri).exists) {
          return { uri, dispose: () => {} };
        }
      }
    } catch {
      // Cache inspection is best-effort; fall back to downloading the asset.
    }
    return null;
  };

  const hostUri = async (
    source: MediaActionsSource,
    signal: AbortSignal,
    options?: { readonly preferCachedUrl?: boolean },
  ) => {
    const uri =
      "uri" in source
        ? normalizeNativeMarkdownUrl(source.uri)
        : ((options?.preferCachedUrl ? cachedHostUrl(source) : null) ?? (await refresh()));
    if (signal.aborted || !canReadHostMedia(hostEnvironmentId)) return null;
    if (uri === null) {
      throw new Error(m(msg("The file could not be loaded. Reconnect and try again.")));
    }
    return uri;
  };

  const share = () =>
    run("share", async (source, signal) => {
      if ("attachment" in source) {
        const preview = await loadLocalAttachmentPreview(source.attachment, signal);
        if (!preview) return;
        const shared = await settlePromise(() => preview.share(signal, source.sourceIdentifier));
        preview.dispose();
        if (AsyncResult.isFailure(shared)) throw squashAtomCommandFailure(shared);
        return;
      }
      const uri = await hostUri(source, signal);
      if (uri === null) return;
      const input = {
        attachment: { name: source.name, mimeType: source.mimeType },
        signal,
        sourceIdentifier: source.sourceIdentifier,
      };
      if (/^(file|content):/i.test(uri)) await shareLocalAttachment({ ...input, uri });
      else await downloadAndShareAttachment({ ...input, url: uri });
    });

  const localImageFile = async (
    source: MediaActionsSource,
    signal: AbortSignal,
    options?: { readonly preferCachedUrl?: boolean },
  ) => {
    if ("attachment" in source) return loadLocalAttachmentPreview(source.attachment, signal);
    const uri = await hostUri(source, signal, options);
    if (uri === null) return null;
    if (/^(file|content):/i.test(uri)) return { uri, dispose: () => {} };
    return downloadAttachmentForPreview({
      url: uri,
      attachment: { name: source.name, mimeType: source.mimeType },
      signal,
    });
  };

  const saveImage = () =>
    run("save-image", async (source, signal) => {
      const file = await localImageFile(source, signal);
      if (!file) return;
      const saved = signal.aborted
        ? null
        : await settlePromise(() => saveImageToLibrary(file.uri, source.mimeType, source.name));
      file.dispose();
      if (saved === null) return;
      if (AsyncResult.isFailure(saved)) throw squashAtomCommandFailure(saved);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    });

  const quoteImage = () =>
    run("quote-image", async (source, signal) => {
      if (!onQuoteImage) return;
      const file =
        ("attachment" in source ? null : await resolveCachedImageFile(source)) ??
        (await localImageFile(source, signal, { preferCachedUrl: true }));
      if (!file) return;
      const quoted = signal.aborted
        ? null
        : await settlePromise(() => onQuoteImage({ uri: file.uri, name: source.name }));
      file.dispose();
      if (quoted === null) return;
      if (AsyncResult.isFailure(quoted)) throw squashAtomCommandFailure(quoted);
      if (quoted.value) {
        options?.onQuoted?.();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    });

  const isQuotableImage =
    source !== undefined &&
    source.quotable !== false &&
    onQuoteImage !== null &&
    (source.mimeType.startsWith("image/") || imageMimeType(source) !== null);
  const reference = source?.reference;
  const relativePath = reference?.kind === "file" ? reference.relativePath : undefined;
  const threadId = source && "threadId" in source ? source.threadId : undefined;
  const actions: { id: MediaActionId; title: string; run: () => void; disabled?: boolean }[] =
    source
      ? [
          ...(isQuotableImage
            ? [
                {
                  id: "quote-image" as const,
                  title:
                    busy === "quote-image"
                      ? gt("Quoting image…")
                      : gt("Quote image", {
                          $context: "verb, context menu item that quotes an image in the composer",
                        }),
                  run: quoteImage,
                  disabled: busy !== null || !canReadMedia,
                },
              ]
            : []),
          ...(reference?.kind === "file"
            ? [
                {
                  id: "copy-full-path" as const,
                  title: relativePath ? gt("Copy full path") : gt("Copy path"),
                  run: () => copyTextWithHaptic(formatFilePathForClipboard(reference.path)),
                },
              ]
            : []),
          ...(relativePath && reference?.kind === "file"
            ? [
                {
                  id: "copy-relative-path" as const,
                  title: gt("Copy relative path"),
                  run: () =>
                    copyTextWithHaptic(formatFilePathForClipboard(relativePath, reference.path)),
                },
              ]
            : []),
          ...(reference?.kind === "url"
            ? [
                {
                  id: "copy-url" as const,
                  title: gt("Copy URL"),
                  run: () => copyTextWithHaptic(reference.url),
                },
              ]
            : []),
          ...(relativePath && "environmentId" in source && threadId !== undefined
            ? [
                {
                  id: "open-file" as const,
                  title: gt("Open in file viewer"),
                  disabled: !canReadMedia,
                  run: () => {
                    if (!canReadHostMedia(hostEnvironmentId)) return;
                    onOpenFile?.();
                    navigation.navigate("ThreadFile", {
                      environmentId: String(source.environmentId),
                      threadId: String(threadId),
                      path: relativePath.split("/"),
                    });
                  },
                },
              ]
            : []),
          ...(canSaveImageToLibrary(source.mimeType)
            ? [
                {
                  id: "save-image" as const,
                  title: busy === "save-image" ? gt("Saving image…") : gt("Save image"),
                  run: saveImage,
                  disabled: busy !== null || !canReadMedia,
                },
              ]
            : []),
          {
            id: "save" as const,
            title:
              busy === "share"
                ? gt("Opening share sheet…")
                : canSaveImageToLibrary(source.mimeType)
                  ? gt("Share", { $context: "verb, opens the system share sheet" })
                  : gt("Save or share"),
            run: share,
            disabled: busy !== null || !canReadMedia,
          },
        ]
      : [];
  return {
    title: reference?.kind === "file" ? reference.path : reference?.url,
    actions,
    sharing: busy === "share",
    share,
  };
}
