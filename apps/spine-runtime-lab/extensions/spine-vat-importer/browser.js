'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[Spine VAT Importer]';
const IMPORTER_NAME = 'spine-vat';
const ASSET_TYPE = 'spinevat.SkeletonData';
const IMPORTER_VERSION = '1.5.0';
const VAT_EXTENSION = '.spinevat';
let startupTimer = null;

function isVatManifest(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && value.format === 'spine-vat-2';
  } catch {
    return false;
  }
}

function collectVatManifests(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectVatManifests(absolute, output);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === VAT_EXTENSION && isVatManifest(absolute)) {
      output.push(absolute);
    }
  }
}

function toAssetUrl(assetsPath, absolute) {
  const relative = path.relative(assetsPath, absolute).split(path.sep).join('/');
  return `db://assets/${relative}`;
}

function isImportedVatAsset(info) {
  return Boolean(
    info
    && info.importer === IMPORTER_NAME
    && info.type === ASSET_TYPE
    && info.imported
    && info.library
    && typeof info.library['.json'] === 'string'
    && info.library['.json'],
  );
}

function readMeta(manifestPath) {
  return JSON.parse(fs.readFileSync(`${manifestPath}.meta`, 'utf8'));
}

function writeMeta(manifestPath, meta) {
  fs.writeFileSync(`${manifestPath}.meta`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

async function refreshMeta(manifestPath) {
  await Editor.Message.request('asset-db', 'refresh-asset', `${manifestPath}.meta`);
}

async function reimportExistingVatAssets() {
  const projectPath = global.Editor && Editor.Project && Editor.Project.path;
  if (!projectPath) return;

  const assetsPath = path.join(projectPath, 'assets');
  const manifests = [];
  collectVatManifests(assetsPath, manifests);

  let imported = 0;
  let failed = 0;
  for (const manifestPath of manifests) {
    try {
      const url = toAssetUrl(assetsPath, manifestPath);
      const info = await Editor.Message.request('asset-db', 'query-asset-info', url);
      const meta = readMeta(manifestPath);
      if (isImportedVatAsset(info) && meta.importer === IMPORTER_NAME && meta.ver === IMPORTER_VERSION) {
        continue;
      }
      writeMeta(manifestPath, {
        ...meta,
        importer: IMPORTER_NAME,
        ver: IMPORTER_VERSION,
        imported: false,
      });
      await refreshMeta(manifestPath);

      let importedInfo = await Editor.Message.request('asset-db', 'query-asset-info', url);
      if (!isImportedVatAsset(importedInfo)) {
        await Editor.Message.request('asset-db', 'reimport-asset', url);
        importedInfo = await Editor.Message.request('asset-db', 'query-asset-info', url);
      }
      if (isImportedVatAsset(importedInfo)) {
        imported += 1;
        continue;
      }

      failed += 1;
      console.error(
        `${LOG_PREFIX} ${url} 导入失败：期望可用的 ${IMPORTER_NAME}/${ASSET_TYPE}，`
        + `实际为 ${importedInfo?.importer || 'unknown'}/${importedInfo?.type || 'unknown'}，`
        + `Library=${JSON.stringify(importedInfo?.library || {})}。`,
      );
    } catch (error) {
      failed += 1;
      console.error(`${LOG_PREFIX} ${manifestPath} 导入失败`, error);
    }
  }

  if (imported > 0) {
    console.log(`${LOG_PREFIX} 已将 ${imported} 个现有 VAT manifest 重新导入为 ${ASSET_TYPE}。`);
  }
  if (failed > 0) {
    console.error(`${LOG_PREFIX} ${failed} 个 VAT manifest 缺少依赖或未生成 Library 文件。`);
  }
  return failed === 0;
}

async function runStartupImport(attempt = 0) {
  try {
    if (!await reimportExistingVatAssets()) {
      throw new Error('VAT manifest 导入尚未成功');
    }
  } catch (error) {
    if (attempt < 20) {
      startupTimer = setTimeout(() => void runStartupImport(attempt + 1), 1000);
      return;
    }
    console.error(`${LOG_PREFIX} 自动重新导入失败`, error);
    return;
  }
}

module.exports = {
  load() {
    startupTimer = setTimeout(() => void runStartupImport(), 500);
  },

  unload() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
  },
};
