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

// ---- 拖 VAT 资源进层级面板 / 场景视图生成节点 ----
// 内置的「拖资源出节点」只认场景进程里写死的类型表，扩展类型要经 contributions.hierarchy|scene.drop 自己建。
// 回调参数没有文档，这里按形状找：带 uuid/value 的是资源，带 target/parent/to 的是父节点。

const UI_2D = 1 << 25;

function collectDropped(args) {
  const assets = [];
  let parent = '';
  let position = null;
  const seen = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const uuid = value.value || value.uuid;
    if (typeof uuid === 'string' && value.type === ASSET_TYPE) assets.push(uuid);
    const target = value.target || value.parent || value.to;
    if (!parent && typeof target === 'string') parent = target;
    if (!position && typeof value.x === 'number' && typeof value.y === 'number') position = value;
    for (const key of Object.keys(value)) visit(value[key], depth + 1);
  };
  args.forEach((arg) => visit(arg, 0));
  return { assets: Array.from(new Set(assets)), parent, position };
}

async function createVatNode(assetUuid, target, position) {
  const request = Editor.Message.request;
  const info = await request('asset-db', 'query-asset-info', assetUuid);
  const name = info ? path.basename(path.dirname(info.file)) : 'Spine VAT';
  // 只建 2D（UiSkeleton），挂在落点下；没有落点挂场景根（不传的话编辑器会挂到当前选中节点下）。
  const parent = target || (await request('scene', 'query-node-tree')).uuid;
  const uuid = await request('scene', 'create-node', { parent, name });
  let dump = await request('scene', 'query-node', uuid);
  if (!dump.__comps__.some((comp) => comp.type === 'cc.UITransform')) {
    await request('scene', 'create-component', { uuid, component: 'cc.UITransform' });
  }
  await request('scene', 'create-component', { uuid, component: 'spinevat.UiSkeleton' });
  dump = await request('scene', 'query-node', uuid);
  const index = dump.__comps__.findIndex((comp) => comp.type === 'spinevat.UiSkeleton');
  const set = (propertyPath, type, value) => request('scene', 'set-property', { uuid, path: propertyPath, dump: { type, value } });
  await set(`__comps__.${index}.skeletonData`, ASSET_TYPE, { uuid: assetUuid });
  await set(`__comps__.${index}.initialClipIndex`, 'Enum', 1);
  await set('layer', 'Enum', UI_2D);
  // ponytail: 落点按本地坐标写，父节点有变换时会偏；要准再改成在场景进程里 setWorldPosition。
  if (position) await set('position', 'cc.Vec3', { x: position.x, y: position.y, z: 0 });
  return uuid;
}

async function onDrop(kind, args) {
  const { assets, parent, position } = collectDropped(args);
  if (!assets.length) {
    console.warn(`${LOG_PREFIX} ${kind} drop 没认出资源，参数：${JSON.stringify(args).slice(0, 800)}`);
    return;
  }
  for (const uuid of assets) {
    try {
      await createVatNode(uuid, parent, kind === 'scene' ? position : null);
    } catch (error) {
      console.error(`${LOG_PREFIX} 拖入创建节点失败，参数：${JSON.stringify(args).slice(0, 800)}`, error);
    }
  }
}

let bakeTarget = '';

module.exports = {
  methods: {
    // 烘焙面板要烘的资源：面板打开时来取；面板已开着就直接通知它换资源。
    setBakeTarget(uuid) {
      bakeTarget = uuid;
      Editor.Message.send('spine-vat-importer', 'bake-target-changed', uuid);
    },
    queryBakeTarget() { return bakeTarget; },
    dropHierarchy(...args) { return onDrop('hierarchy', args); },
    dropScene(...args) { return onDrop('scene', args); },
  },

  load() {
    startupTimer = setTimeout(() => void runStartupImport(), 500);
  },

  unload() {
    if (startupTimer) clearTimeout(startupTimer);
    startupTimer = null;
  },
};
