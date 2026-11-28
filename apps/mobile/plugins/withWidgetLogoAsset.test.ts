// @effect-diagnostics nodeBuiltinImport:off - verifies widget asset catalog files on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import withWidgetLogoAsset from "./withWidgetLogoAsset.cjs";

const mobileRoot = NodePath.resolve(__dirname, "..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

describe("withWidgetLogoAsset", () => {
  it("writes T3Mark and all provider icon image sets into ExpoWidgetsTarget/Assets.xcassets", () => {
    const platformRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "widget-assets-"));
    tempDirs.push(platformRoot);

    const catalogDir = withWidgetLogoAsset.writeWidgetAssetCatalog(mobileRoot, platformRoot);
    expect(NodeFS.existsSync(NodePath.join(catalogDir, "Contents.json"))).toBe(true);

    const expectedNames = [
      "T3Mark",
      "ProviderCodex",
      "ProviderClaude",
      "ProviderAntigravity",
      "ProviderCursor",
      "ProviderGrok",
      "ProviderOpenCode",
      "ProviderPi",
      "ProviderMuse",
    ];
    expect(withWidgetLogoAsset.WIDGET_ASSETS.map((asset) => asset.name)).toEqual(expectedNames);

    for (const asset of withWidgetLogoAsset.WIDGET_ASSETS) {
      const imageSetDir = NodePath.join(catalogDir, `${asset.name}.imageset`);
      const ext = NodePath.extname(asset.source);
      const assetFile = NodePath.join(imageSetDir, `${asset.name}${ext}`);
      expect(NodeFS.existsSync(assetFile)).toBe(true);

      const contents = JSON.parse(
        NodeFS.readFileSync(NodePath.join(imageSetDir, "Contents.json"), "utf8"),
      ) as {
        images: Array<{ idiom: string; filename: string }>;
        properties: Record<string, unknown>;
      };
      expect(contents.images).toEqual([{ idiom: "universal", filename: `${asset.name}${ext}` }]);
      expect(contents.properties["template-rendering-intent"]).toBe(asset.renderingIntent);
      if (ext === ".svg") {
        expect(contents.properties["preserves-vector-representation"]).toBe(true);
      } else {
        expect(contents.properties["preserves-vector-representation"]).toBeUndefined();
      }
    }
  });
});
