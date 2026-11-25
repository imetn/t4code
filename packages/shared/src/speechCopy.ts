import { CLOUD_SPEECH_PROVIDER_NAMES, type CloudSpeechProvider } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** @public */
export function cloudSpeechDisclosure(
  provider: CloudSpeechProvider,
  environment: string,
  resolve: MFunctionType = mFallback,
  options?: { readonly endpoint?: string | undefined },
) {
  if (provider === "openrouter") {
    return resolve(
      msg(
        "After you stop, {environment} sends the recording to OpenRouter. OpenRouter chooses who runs your model. T3 requests zero data retention; your OpenRouter account may allow safety retention.",
        { environment },
      ),
    );
  }
  if (provider === "custom") {
    let host = "";
    try {
      host = options?.endpoint ? new URL(options.endpoint).host : "";
    } catch {
      host = "";
    }
    return host
      ? resolve(
          msg("After you stop, {environment} sends your recording to your endpoint at {host}.", {
            environment,
            host,
          }),
        )
      : resolve(
          msg(
            "After you stop, {environment} sends your recording to the custom endpoint configured on it.",
            { environment },
          ),
        );
  }
  return resolve(
    msg(
      "After you stop, {environment} sends your recording and vocabulary hints, including project names, to {provider}.",
      { environment, provider: CLOUD_SPEECH_PROVIDER_NAMES[provider] },
    ),
  );
}
