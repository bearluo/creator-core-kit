'use strict';

const path = require('path');

const HANDLER_NAME = 'spine-vat';
const VAT_EXTENSION = '.spinevat';
const ASSET_CLASS = 'spinevat.SkeletonData';

function registerAssetClass() {
  const cc = require('cc');
  if (cc.js.getClassByName(ASSET_CLASS)) return;

  class SpineVatSkeletonData extends cc.Asset {}
  const { property } = cc._decorator;
  // The worker may register this placeholder before the importer script runs.
  // Creator 3.8.7 expects property decorators before ccclass registration.
  property({ visible: false })(SpineVatSkeletonData.prototype, 'manifestJson');
  property({ type: [cc.BufferAsset], visible: false })(SpineVatSkeletonData.prototype, 'positionPages');
  property({ type: [cc.BufferAsset], visible: false })(SpineVatSkeletonData.prototype, 'lightPages');
  property({ type: [cc.BufferAsset], visible: false })(SpineVatSkeletonData.prototype, 'darkPages');
  property({ type: [cc.Texture2D], visible: false })(SpineVatSkeletonData.prototype, 'atlasPages');
  property({ type: cc.EffectAsset, visible: false })(SpineVatSkeletonData.prototype, 'effectAsset');
  property({ type: cc.EffectAsset, visible: false })(SpineVatSkeletonData.prototype, 'uiEffectAsset');
  cc._decorator.ccclass(ASSET_CLASS)(SpineVatSkeletonData);
}

function install() {
  registerAssetClass();

  const assetDbPath = require.resolve('./asset-db');
  delete require.cache[assetDbPath];
  const { registerSpineVatHandler } = require(assetDbPath);
  const managerPath = path.join(
    Editor.App.path,
    'builtin/asset-db/dist/worker/manager/asset-handler-manager.ccc',
  );
  const { assetHandlerManager } = require(managerPath);

  delete assetHandlerManager.name2importer[HANDLER_NAME];
  delete assetHandlerManager.name2handler[HANDLER_NAME];
  assetHandlerManager.add(registerSpineVatHandler(), [VAT_EXTENSION]);

  const registration = {
    ...(assetHandlerManager.name2registerInfo[HANDLER_NAME] || {}),
    pkgName: 'spine-vat-importer',
    name: HANDLER_NAME,
    handler: 'registerSpineVatHandler',
    extnames: [VAT_EXTENSION],
    internal: false,
  };
  assetHandlerManager.name2registerInfo[HANDLER_NAME] = registration;

  for (const [extension, registrations] of Object.entries(assetHandlerManager.extname2registerInfo)) {
    if (extension === VAT_EXTENSION || !Array.isArray(registrations)) continue;
    assetHandlerManager.extname2registerInfo[extension] = registrations
      .filter((item) => item.name !== HANDLER_NAME);
  }

  const vatRegistrations = assetHandlerManager.extname2registerInfo[VAT_EXTENSION] || [];
  assetHandlerManager.extname2registerInfo[VAT_EXTENSION] = [
    ...vatRegistrations.filter((item) => item.name !== HANDLER_NAME),
    registration,
  ];
}

install();

module.exports = { install };
