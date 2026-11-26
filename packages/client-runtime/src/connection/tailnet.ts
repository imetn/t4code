import {
  type AuthClientPresentationMetadata,
  type EnvironmentId,
  TailnetIpv4,
  type TailnetPeerEnvironment,
  TAILNET_APP_CAPABILITY,
  TAILNET_POLICY_URL,
  type TailnetSignInRefusedReason,
} from "@t3tools/contracts";
import { isSharedAddressSpaceHost, normalizeHostname } from "@t3tools/shared/hostClassification";
import * as Schema from "effect/Schema";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import { ConnectionBlockedError, ConnectionTransientError } from "./model.ts";
import { connectionRoutes, routeHttpBaseUrl } from "./routes.ts";

/** Where `t3 up` and the desktop "Tailscale sign-in" switch listen. */
export const TAILNET_SIGN_IN_PORT = 3773;

const SINGLE_LABEL_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const isTailnetIpv4 = Schema.is(TailnetIpv4);

function isTailnetName(hostname: string): boolean {
  if (hostname.endsWith(".ts.net")) return true;
  return SINGLE_LABEL_HOST.test(hostname) && !/^\d+$/u.test(hostname) && hostname !== "localhost";
}

/**
 * The direct tailnet address to sign in at, from what a user typed or scanned:
 * `studio`, `studio.tailnet.ts.net`, or `100.x.y.z`, each with an optional
 * port, or a plain `http://` URL with no pairing code (the `t3 up` QR). Null
 * for anything else, which goes to the pairing-code flow.
 */
export function tailnetSignInBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || url.username !== "" || url.password !== "") return null;
  // A path, query, or fragment is a pairing link, not a bare address.
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  const hostname = normalizeHostname(url.hostname);
  if (!isSharedAddressSpaceHost(hostname) && !isTailnetName(hostname)) return null;
  // A bare host means T3 Code's port. A URL with no port means port 80, as `http://` says, so a
  // saved address parsed again keeps its port; URL drops a typed `:80` the same way.
  const typedPort = /^(?:[a-z][a-z\d+.-]*:\/\/)?[^/?#]*:\d+(?:[/?#]|$)/iu.test(trimmed);
  const port =
    url.port !== "" ? url.port : hasScheme || typedPort ? "80" : String(TAILNET_SIGN_IN_PORT);
  return `http://${hostname}:${port}/`;
}

/** Hosts refuse browser origins, and a page on plain `http://100.x` cannot make a DPoP key. */
export function supportsTailnetSignIn(metadata: AuthClientPresentationMetadata): boolean {
  return metadata.surface === "desktop" || metadata.surface === "mobile";
}

// Off Tailscale, a pinned name can resolve to a LAN address the host refuses; it
// works again once Tailscale is back, like the other two.
const TRANSIENT_REFUSALS: ReadonlySet<TailnetSignInRefusedReason> = new Set([
  "not_direct_tailnet",
  "tailscale_unavailable",
  "rate_limited",
  // Ends on its own once the host can read the policy again.
  "policy_unknown",
]);

export function tailnetRefusalError(
  reason: TailnetSignInRefusedReason,
  traceId?: string,
  suggestedGrant?: string,
) {
  // Forms show the detail as is, before the machine has a label.
  const { headline, steps } = tailnetRefusalVerdict("that machine", reason);
  const sentence = `${headline.charAt(0).toUpperCase()}${headline.slice(1)}. ${steps.join(" ")}`;
  const fields = {
    detail:
      suggestedGrant === undefined
        ? sentence
        : mFallback(
            msg("{sentence}\n\nAdd this to your tailnet policy:\n{suggestedGrant}", {
              sentence,
              suggestedGrant,
            }),
          ),
    hop: "server" as const,
    via: "direct" as const,
    tailnetRefusal: reason,
    ...(traceId === undefined ? {} : { traceId }),
    ...(suggestedGrant === undefined ? {} : { suggestedGrant }),
  };
  return TRANSIENT_REFUSALS.has(reason)
    ? new ConnectionTransientError({ reason: "remote-unavailable", ...fields })
    : new ConnectionBlockedError({ reason: "permission", ...fields });
}

export type DiscoveredMachineAction =
  | { readonly _tag: "Add" }
  | { readonly _tag: "Skip" }
  /** A saved environment answered at an address it was never saved with. */
  | { readonly _tag: "Conflict"; readonly label: string };

function routeHosts(entry: ConnectionCatalogEntry): ReadonlySet<string> {
  return new Set(
    connectionRoutes(entry).flatMap((route) => {
      const url = routeHttpBaseUrl(route);
      return url !== null && URL.canParse(url) ? [normalizeHostname(new URL(url).hostname)] : [];
    }),
  );
}

/**
 * What to do with a machine found on the tailnet. A removed machine stays
 * removed, and a found address never joins a saved environment's routes: the
 * public descriptor does not prove which machine answered.
 */
export function discoveredMachineAction(input: {
  readonly machine: Pick<TailnetPeerEnvironment, "environmentId" | "tailnetIpv4" | "magicDnsName">;
  readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
  readonly dismissed: ReadonlySet<EnvironmentId>;
}): DiscoveredMachineAction {
  const { machine } = input;
  // A connected host could name a LAN address; sign-in goes only to a tailnet one.
  if (!isTailnetIpv4(machine.tailnetIpv4)) return { _tag: "Skip" };
  if (input.dismissed.has(machine.environmentId)) return { _tag: "Skip" };
  const saved = input.entries.get(machine.environmentId);
  if (saved === undefined) return { _tag: "Add" };
  const hosts = routeHosts(saved);
  const dnsName = machine.magicDnsName === null ? null : normalizeHostname(machine.magicDnsName);
  const known =
    hosts.has(normalizeHostname(machine.tailnetIpv4)) ||
    (dnsName !== null && (hosts.has(dnsName) || hosts.has(dnsName.split(".")[0]!)));
  // Without a direct address to compare, T3 Connect and SSH routes cannot conflict.
  if (known || hosts.size === 0) return { _tag: "Skip" };
  return { _tag: "Conflict", label: saved.target.label };
}

/** Machines with `tailnetSignIn` that `discoveredMachineAction` would add, once per environment. */
export function machinesToAdd<
  Machine extends Pick<TailnetPeerEnvironment, "environmentId" | "tailnetIpv4" | "magicDnsName">,
>(input: {
  readonly machines: ReadonlyArray<Machine>;
  readonly entries: ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>;
  readonly dismissed: ReadonlySet<EnvironmentId>;
}): {
  readonly add: ReadonlyArray<Machine>;
  readonly conflicts: ReadonlyArray<{ readonly machine: Machine; readonly label: string }>;
} {
  const seen = new Set<EnvironmentId>();
  const add: Machine[] = [];
  const conflicts: Array<{ readonly machine: Machine; readonly label: string }> = [];
  for (const machine of input.machines) {
    if (seen.has(machine.environmentId)) continue;
    seen.add(machine.environmentId);
    const action = discoveredMachineAction({ ...input, machine });
    if (action._tag === "Add") add.push(machine);
    if (action._tag === "Conflict") conflicts.push({ machine, label: action.label });
  }
  return { add, conflicts };
}

/** Why a host refused this device's Tailscale sign-in, and the fix. */
export function tailnetRefusalVerdict(
  host: string,
  reason: TailnetSignInRefusedReason,
  resolve: MFunctionType = mFallback,
): { readonly headline: string; readonly steps: ReadonlyArray<string> } {
  const pairInstead = resolve(msg("Or pair this device with a code instead."));
  const grant = resolve(
    msg("Grant this device `{capability}` on {host} in your tailnet policy at {url}.", {
      capability: TAILNET_APP_CAPABILITY,
      host,
      url: TAILNET_POLICY_URL,
    }),
  );
  switch (reason) {
    case "disabled":
      return {
        headline: resolve(msg("Tailscale sign-in is off on {host}", { host })),
        steps: [
          resolve(
            msg("On {host}, run `npx t3 up --tailscale`, or turn on Tailscale sign-in in Settings.", {
              host,
            }),
          ),
          pairInstead,
        ],
      };
    case "browser_request":
      return {
        headline: resolve(
          msg("{host} accepts Tailscale sign-in only from the desktop and mobile apps", { host }),
        ),
        steps: [resolve(msg("Pair this browser with a code."))],
      };
    case "not_direct_tailnet":
      return {
        headline: resolve(
          msg("{host} did not see this device on its Tailscale address", { host }),
        ),
        steps: [
          resolve(
            msg(
              "Turn on Tailscale on this device, and log in to it again if it asks. Saved machines retry on their own.",
            ),
          ),
          resolve(
            msg("Add {host} by its Tailscale name or 100.x address, not a LAN or HTTPS address.", {
              host,
            }),
          ),
        ],
      };
    case "tailscale_unavailable":
      return {
        headline: resolve(msg("{host} could not ask Tailscale who this device is", { host })),
        steps: [
          resolve(msg("On {host}, check that Tailscale runs, or run `t3 tailscale status`.", { host })),
        ],
      };
    case "tailscale_outdated":
      return {
        headline: resolve(msg("{host} runs a Tailscale too old for sign-in", { host })),
        steps: [resolve(msg("Update Tailscale on {host}.", { host }))],
      };
    case "owner_unknown":
      return {
        headline: resolve(msg("{host} does not know who owns it", { host })),
        steps: [
          grant,
          resolve(
            msg("Or, on {host}, run {command}.", {
              host,
              command: "`npx t3 up --owner <your login>`",
            }),
          ),
        ],
      };
    case "tagged_device":
      return {
        headline: resolve(
          msg("This device is tagged, and no grant lets it into {host}", { host }),
        ),
        steps: [grant, pairInstead],
      };
    case "shared_device":
      return {
        headline: resolve(
          msg("This device is shared in from another tailnet, and no grant lets it into {host}", {
            host,
          }),
        ),
        steps: [grant, pairInstead],
      };
    case "other_user":
      return {
        headline: resolve(
          msg("This device belongs to another Tailscale user, and no grant lets it into {host}", {
            host,
          }),
        ),
        steps: [grant, pairInstead],
      };
    case "own_node":
      return {
        headline: resolve(msg("This device is {host}", { host })),
        steps: [resolve(msg("Use this device's own T3 Code instead."))],
      };
    case "routes_for_others":
      return {
        headline: resolve(msg("This device is a subnet router, so it cannot sign in")),
        steps: [
          resolve(
            msg(
              "Traffic it forwards could arrive as this device, so no grant lets it in. Stop advertising routes on it.",
            ),
          ),
          pairInstead,
        ],
      };
    case "no_grant":
      return {
        headline: resolve(
          msg("{host} lets in only devices its tailnet policy grants T3 Code", { host }),
        ),
        steps: [grant],
      };
    case "grant_unusable":
      return {
        headline: resolve(
          msg("This device's T3 Code grant on {host} names no scope T3 Code knows", { host }),
        ),
        steps: [
          resolve(
            msg(
              'In your tailnet policy at {url}, fix the scopes in that grant. The list takes "read", "standard", "admin", or single scopes such as "orchestration:read".',
              { url: TAILNET_POLICY_URL },
            ),
          ),
        ],
      };
    case "policy_unknown":
      return {
        headline: resolve(
          msg(
            "{host} cannot tell whether your tailnet policy grants T3 Code, so it lets in only granted devices",
            { host },
          ),
        ),
        steps: [
          resolve(
            msg("On {host}, run `t3 tailscale require-grant` to see why. Saved machines retry on their own.", {
              host,
            }),
          ),
          grant,
        ],
      };
    case "blocked":
      return {
        headline: resolve(msg("{host} blocked this device", { host })),
        steps: [
          resolve(
            msg(
              "Unblock this device in Settings > Sharing & access on {host}, or in Settings > Environments on another device that can manage access there.",
              { host },
            ),
          ),
          resolve(
            msg(
              "A device can manage access when it has access:write and orchestration:read on {host}. Devices paired with a default t3 pair code have them, as do devices granted admin, and yours while nothing is granted and grants are not required.",
              { host },
            ),
          ),
          resolve(
            msg(
              "Then try again on this device: press Retry now (the reconnect button on mobile) for a saved machine, or submit the form again if you were adding it.",
            ),
          ),
          resolve(
            msg(
              "Or run `t3 pair --scope orchestration:read --scope access:write` on {host}. On this device, paste the link it prints into Add route under {host} in Settings > Environments, or into Add environment if {host} is not saved. If the link names a LAN address, enter its code at {exampleUrl} instead (`tailscale ip -4` on {host}, or its Tailscale menu, shows the address).",
              { host, exampleUrl: `http://<Tailscale address of ${host}>:<port>` },
            ),
          ),
          resolve(
            msg(
              "Then unblock this device, and revoke that pairing in Settings > Sharing & access on {host} so this device signs in through Tailscale again. On a headless host, run `t3 auth session list` and {revokeCommand} there, then restart T3 Code on this device.",
              { host, revokeCommand: "`t3 auth session revoke <id>`" },
            ),
          ),
        ],
      };
    case "rate_limited":
      return {
        headline: resolve(msg("{host} asked this device to slow down", { host })),
        steps: [resolve(msg("Wait a minute, then try again. Saved machines retry on their own."))],
      };
  }
}
