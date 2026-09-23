'use strict';

const fs = require('fs');
const path = require('path');
module.paths.push(path.join(Editor.App.path, 'node_modules'));
const { Importer } = require('@editor/asset-db');

const ASSET_CLASS = 'spinevat.SkeletonData';

function ensureAssetClass() {
  const cc = require('cc');
  if (cc.js.getClassByName(ASSET_CLASS)) return;
  class SpineVatSkeletonData extends cc.Asset {}
  const { property } = cc._decorator;
  property({ visible: false })(SpineVatSkeletonData.prototype, 'manifestJson');
  property({ type: [cc.BufferAsset], visible: false })(SpineVatSkeletonData.prototype, 'positionPages');
  property({ type: [cc.BufferAsset], visible: false })(SpineVatSkeletonData.prototype, 'lightPages');
  property({ type: [cc.BufferAsset], visible: false })(SpineVatSkeletonData.prototype, 'darkPages');
  property({ type: [cc.Texture2D], visible: false })(SpineVatSkeletonData.prototype, 'atlasPages');
  property({ type: cc.EffectAsset, visible: false })(SpineVatSkeletonData.prototype, 'effectAsset');
  cc._decorator.ccclass(ASSET_CLASS)(SpineVatSkeletonData);
}

ensureAssetClass();

function readManifest(source) {
  const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
  return manifest && manifest.format === 'spine-vat-2' ? manifest : null;
}

function resolveSibling(asset, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('VAT manifest 包含空的依赖路径');
  }

  const sourceDirectory = path.dirname(asset.source);
  const absolute = path.resolve(sourceDirectory, relativePath);
  const relative = path.relative(sourceDirectory, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`VAT 资源路径越出当前目录: ${relativePath}`);
  }

  const dependency = asset._assetDB.path2asset.get(absolute);
  if (!dependency) {
    throw new Error(`找不到 VAT 依赖文件: ${relativePath}`);
  }
  return { absolute, dependency };
}

function bufferReference(uuid) {
  return {
    __uuid__: uuid,
    __expectedType__: 'cc.BufferAsset',
  };
}

function textureReference(uuid) {
  return {
    __uuid__: uuid,
    __expectedType__: 'cc.Texture2D',
  };
}

function effectReference(uuid) {
  return {
    __uuid__: uuid,
    __expectedType__: 'cc.EffectAsset',
  };
}

function resolveRuntimeEffect(asset) {
  const absolute = path.resolve(__dirname, '..', 'assets', 'spine-vat-v2.effect');
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(`${absolute}.meta`, 'utf8'));
  } catch {
    throw new Error('找不到 VAT Runtime Effect: db://spine-vat-importer/spine-vat-v2.effect');
  }
  if (meta.importer !== 'effect' || typeof meta.uuid !== 'string' || !meta.uuid) {
    throw new Error('VAT Runtime Effect 的 .meta 无效');
  }
  return { absolute, dependency: { uuid: meta.uuid } };
}

function findTextureUuid(imageAsset, absoluteImagePath, relativePath) {
  const texture = Object.values(imageAsset.subAssets || {})
    .find((subAsset) => subAsset.meta && subAsset.meta.importer === 'texture');
  if (texture) {
    return texture.uuid;
  }

  try {
    const imageMeta = JSON.parse(fs.readFileSync(`${absoluteImagePath}.meta`, 'utf8'));
    const textureMeta = Object.values(imageMeta.subMetas || {})
      .find((subMeta) => subMeta && subMeta.importer === 'texture' && subMeta.uuid);
    if (textureMeta) {
      return textureMeta.uuid;
    }
  } catch {}

  throw new Error(`图片没有 Texture2D 子资源: ${relativePath}`);
}

async function importSpineVatAsset(asset) {
  try {
    const manifest = readManifest(asset.source);
    if (!manifest) return false;

    const positionPages = [];
    const lightPages = [];
    const darkPages = [];
    const atlasPages = [];
    const depends = new Set();
    const effectInfo = resolveRuntimeEffect(asset);
    addDependency(asset, effectInfo, depends);

    for (const page of manifest.texturePages || []) {
      const dependencyInfo = resolveSibling(asset, page.path);
      addDependency(asset, dependencyInfo, depends);
      const reference = bufferReference(dependencyInfo.dependency.uuid);
      if (page.semantic === 'position') positionPages.push(reference);
      else if (page.semantic === 'light') lightPages.push(reference);
      else if (page.semantic === 'dark') darkPages.push(reference);
    }

    for (const page of manifest.atlasPages || []) {
      const dependencyInfo = resolveSibling(asset, page.path);
      addDependency(asset, dependencyInfo, depends);
      const textureUuid = findTextureUuid(
        dependencyInfo.dependency,
        dependencyInfo.absolute,
        page.path,
      );
      depends.add(textureUuid);
      page.id = textureUuid;
      atlasPages.push(textureReference(textureUuid));
    }

    const serialized = JSON.stringify({
      __type__: 'spinevat.SkeletonData',
      _name: asset.basename || 'Spine VAT',
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      manifestJson: JSON.stringify(manifest),
      positionPages,
      lightPages,
      darkPages,
      atlasPages,
      effectAsset: effectReference(effectInfo.dependency.uuid),
    }, null, 2);

    await asset.saveToLibrary('.json', `${serialized}\n`);
    asset.setData('depends', Array.from(depends));
    return true;
  } catch (error) {
    const details = error && error.stack ? error.stack : String(error);
    console.error(`[Spine VAT Importer] ${asset.source}\n${details}`);
    return false;
  }
}

class SpineVatImporter380 extends Importer {
  get assetType() {
    return 'spinevat.SkeletonData';
  }

  get version() {
    return '1.4.1';
  }

  get name() {
    return 'spine-vat';
  }

  get migrations() {
    return [];
  }

  async import(asset) {
    return importSpineVatAsset(asset);
  }
}

function addDependency(asset, dependencyInfo, depends) {
  asset.depend(dependencyInfo.absolute);
  depends.add(dependencyInfo.dependency.uuid);
}

exports.registerSpineVatHandler = function registerSpineVatHandler() {
  return {
    name: 'spine-vat',
    displayName: 'Spine VAT SkeletonData',
    assetType: 'spinevat.SkeletonData',

    async validate(asset) {
      if (asset.isDirectory()) return false;
      try {
        return Boolean(readManifest(asset.source));
      } catch {
        return false;
      }
    },

    importer: {
      version: '1.4.1',
      import: importSpineVatAsset,
    },
  };
};

exports.methods = {
  async registerSpineVatImporter380() {
    return {
      extname: ['.spinevat'],
      importer: SpineVatImporter380,
    };
  },
};
