'use strict';

const path = require('path');

const LOG_PREFIX = '[Spine VAT Bake]';

async function bake(info, alphaMode) {
  const name = path.basename(info.file, path.extname(info.file));
  const outDir = path.join(path.dirname(info.file), `${name}-vat`);
  const outUrl = `${path.posix.dirname(info.url)}/${name}-vat`;
  console.log(`${LOG_PREFIX} ${info.url}（${alphaMode}）→ ${outUrl}`);
  try {
    const summary = await Editor.Message.request('scene', 'execute-scene-script', {
      name: 'spine-vat-importer',
      method: 'bake',
      args: [info.uuid, alphaMode, outDir, path.dirname(info.file)],
    });
    await Editor.Message.request('asset-db', 'refresh-asset', outUrl);
    console.log(`${LOG_PREFIX} 完成 ${outUrl}/manifest.spinevat ${summary}`);
  } catch (error) {
    console.error(`${LOG_PREFIX} 失败 ${info.url}`, error);
  }
}

exports.onAssetMenu = function onAssetMenu(info) {
  if (!info || info.type !== 'sp.SkeletonData' || !info.file) return [];
  return ['straight', 'premultiplied'].map((alphaMode) => ({
    label: `烘焙 Spine VAT（${alphaMode}）`,
    click: () => void bake(info, alphaMode),
  }));
};
