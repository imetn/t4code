"use strict";

// Precede expo-widgets so its reverse-ordered mods create and wipe the target before assets are added.

const path = require("path");
const fs = require("fs");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const { addWidgetAssetCatalog } = require("./lib/addWidgetAssetCatalog.cjs");

const TARGET_NAME = "ExpoWidgetsTarget";
const CATALOG_NAME = "Assets.xcassets";

const WIDGET_ASSETS = [
  { name: "T3Mark", source: "assets/widget/T3Mark.svg", renderingIntent: "template" },
  { name: "ProviderCodex", source: "assets/widget/ProviderCodex.svg", renderingIntent: "template" },
  {
    name: "ProviderClaude",
    source: "assets/widget/ProviderClaude.svg",
    renderingIntent: "template",
  },
  {
    name: "ProviderAntigravity",
    source: "assets/antigravity.png",
    renderingIntent: "original",
  },
  {
    name: "ProviderCursor",
    source: "assets/widget/ProviderCursor.svg",
    renderingIntent: "template",
  },
  { name: "ProviderGrok", source: "assets/widget/ProviderGrok.svg", renderingIntent: "template" },
  {
    name: "ProviderOpenCode",
    source: "assets/widget/ProviderOpenCode.svg",
    renderingIntent: "template",
  },
  { name: "ProviderPi", source: "assets/widget/ProviderPi.svg", renderingIntent: "template" },
  { name: "ProviderMuse", source: "assets/widget/ProviderMuse.svg", renderingIntent: "template" },
];

const CATALOG_CONTENTS = JSON.stringify({ info: { author: "expo", version: 1 } }, null, 2) + "\n";

function imageSetContents(filename, renderingIntent) {
  const isVector = filename.endsWith(".svg") || filename.endsWith(".pdf");
  return (
    JSON.stringify(
      {
        images: [{ idiom: "universal", filename }],
        info: { author: "expo", version: 1 },
        properties: {
          ...(isVector ? { "preserves-vector-representation": true } : {}),
          "template-rendering-intent": renderingIntent,
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function writeWidgetAssetCatalog(projectRoot, platformProjectRoot) {
  const catalogDir = path.join(platformProjectRoot, TARGET_NAME, CATALOG_NAME);
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(path.join(catalogDir, "Contents.json"), CATALOG_CONTENTS);

  for (const asset of WIDGET_ASSETS) {
    const sourcePath = path.join(projectRoot, asset.source);
    const ext = path.extname(asset.source);
    const filename = `${asset.name}${ext}`;
    const imageSetDir = path.join(catalogDir, `${asset.name}.imageset`);
    fs.mkdirSync(imageSetDir, { recursive: true });
    fs.writeFileSync(
      path.join(imageSetDir, "Contents.json"),
      imageSetContents(filename, asset.renderingIntent),
    );
    fs.copyFileSync(sourcePath, path.join(imageSetDir, filename));
  }
  return catalogDir;
}

function withAssetFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      writeWidgetAssetCatalog(cfg.modRequest.projectRoot, cfg.modRequest.platformProjectRoot);
      return cfg;
    },
  ]);
}

function withAssetWiring(config) {
  return withXcodeProject(config, (cfg) => {
    addWidgetAssetCatalog(cfg.modResults, { targetName: TARGET_NAME });
    return cfg;
  });
}

function withWidgetLogoAsset(config) {
  return withAssetWiring(withAssetFiles(config));
}

withWidgetLogoAsset.WIDGET_ASSETS = WIDGET_ASSETS;
withWidgetLogoAsset.writeWidgetAssetCatalog = writeWidgetAssetCatalog;

module.exports = withWidgetLogoAsset;
