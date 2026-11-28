import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import * as Dialog from "./Dialog";
import { requireNativeModule } from "expo";
import { msg, useGT } from "gt-react-native";
import { useContext, useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { m } from "../../i18n/messages";
import { QuoteMediaContext } from "../../state/mediaActions";
import type {
  FilePreviewImage,
  FilePreviewModalProps,
  FilePreviewViewerProps,
} from "./FilePreviewModal.types";
import { FilePreviewSession } from "./FilePreviewSession";

export type {
  FilePreviewItem,
  FilePreviewSource,
  ResolvedFilePreviewSource,
} from "./FilePreviewModal.types";

const NativeControls = requireNativeModule<{
  presentFile(
    uri: string,
    name: string,
    sourceIdentifier: string,
    identifier: string,
  ): Promise<void>;
  presentFiles(
    uris: readonly (string | null)[],
    names: readonly string[],
    selectedIndex: number,
    sourceIdentifiers: readonly string[],
    identifier: string,
    canQuote?: boolean,
    quoteTitle?: string,
  ): Promise<void>;
  updateFile(identifier: string, index: number, uri: string | null): Promise<void>;
  dismissFile(identifier: string): Promise<void>;
  isFilePreviewFinished(identifier: string): boolean;
  addListener(
    event: "imageViewerQuote",
    listener: (event: { identifier: string; index: number; uri: string; name: string }) => void,
  ): { remove(): void };
}>("T3NativeControls");

async function cleanupTempQuoteFile(uri: string) {
  try {
    const { File } = await import("expo-file-system");
    const file = new File(uri);
    const parent = file.parentDirectory;
    if (parent.name.startsWith("t3-quote-")) {
      parent.delete();
    } else if (file.exists) {
      file.delete();
    }
  } catch {
    // Best-effort cleanup of the native quote copy.
  }
}

// Null tells the viewer an image failed; undefined means its URL has not arrived yet.
const nativeUri = (image: FilePreviewImage) => (image.failed ? null : image.uri);

function NativeFilePreview(props: FilePreviewViewerProps) {
  const gt = useGT();
  const identifier = useId();
  const onQuoteImage = useContext(QuoteMediaContext);
  // Later URLs reach the native presentation through updateFile instead of presenting again.
  const [presented] = useState(props.source);
  const quoteTitle = gt("Quote image", {
    $context: "verb, context menu item that quotes an image in the composer",
  });
  // Freeze quote availability at opening so a brief reconnect never dismisses the viewer.
  const [initialQuote] = useState(() => ({
    canQuote:
      presented.kind === "image" &&
      onQuoteImage !== null &&
      props.quotable !== false &&
      presented.images.some((image) => image.actionsSource?.quotable !== false),
    title: quoteTitle,
  }));
  const delivered = useRef<(string | null | undefined)[]>([]);
  const onRequestClose = useEffectEvent(props.onRequestClose);
  const onPresent = useEffectEvent((isFinished: () => boolean) => props.onPresent?.(isFinished));
  const onOpenError = useEffectEvent((error: unknown) => {
    if (props.onOpenError) props.onOpenError(error);
    else
      Dialog.alert(
        gt("Could not open preview"),
        gt("The file could not be loaded. Please try again."),
      );
  });
  const handleNativeQuote = useEffectEvent((uri: string, name: string) => {
    if (!onQuoteImage) {
      void cleanupTempQuoteFile(uri);
      return;
    }
    void onQuoteImage({ uri, name })
      .catch((error: unknown) => {
        Dialog.alert(
          gt("Could not quote image"),
          errorDisplayMessage(error, m) ?? gt("Try again."),
        );
      })
      .finally(() => {
        void cleanupTempQuoteFile(uri);
      });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- presents the native file preview and dismisses it on cleanup
  useEffect(() => {
    let canceled = false;
    const quoteSubscription =
      presented.kind === "image" && initialQuote.canQuote
        ? NativeControls.addListener("imageViewerQuote", (event) => {
            if (event.identifier !== identifier) return;
            handleNativeQuote(event.uri, event.name);
          })
        : null;
    let presentation: Promise<void>;
    // Images hand over before every URL resolves; other files must download first so Quick Look can refuse them.
    if (presented.kind === "image") {
      const { images, selectedIndex } = presented;
      delivered.current = images.map((image) => image.uri);
      presentation = NativeControls.presentFiles(
        images.map((image) => image.uri ?? null),
        images.map(
          (image) => image.name ?? m(msg("Preview", { $context: "noun, preview window title" })),
        ),
        selectedIndex,
        images.map((image) => image.sourceIdentifier ?? ""),
        identifier,
        initialQuote.canQuote,
        initialQuote.title,
      );
    } else {
      const { uri, name, sourceIdentifier } = presented;
      presentation = NativeControls.presentFile(
        uri,
        name ?? m(msg("Preview", { $context: "noun, preview window title" })),
        sourceIdentifier ?? "",
        identifier,
      );
    }
    onPresent(() => NativeControls.isFilePreviewFinished(identifier));
    void presentation
      .catch((error: unknown) => {
        if (!canceled) onOpenError(error);
      })
      .finally(() => {
        if (!canceled) onRequestClose();
      });
    return () => {
      canceled = true;
      quoteSubscription?.remove();
      void NativeControls.dismissFile(identifier).catch(() => undefined);
    };
  }, [identifier, initialQuote, presented]);

  const images = props.source.kind === "image" ? props.source.images : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands image URLs that resolve after opening to the native viewer
  useEffect(() => {
    images?.forEach((image, index) => {
      const uri = nativeUri(image);
      if (uri === undefined || delivered.current[index] === uri) return;
      delivered.current[index] = uri;
      void NativeControls.updateFile(identifier, index, uri).catch(() => undefined);
    });
  }, [images, identifier]);

  return null;
}

/** Shows images, PDFs and documents full screen in the native viewer (Android: FilePreviewModal.android.tsx). */
export function FilePreviewModal(props: FilePreviewModalProps) {
  return <FilePreviewSession {...props} progressiveGallery Viewer={NativeFilePreview} />;
}
