'use strict';

// 资源右键「烘焙 Spine VAT…」：记下目标资源并打开烘焙面板（参数与烘焙都在面板里，见 panels/bake.js）。
exports.onAssetMenu = function onAssetMenu(info) {
  if (!info || info.type !== 'sp.SkeletonData' || !info.file) return [];
  return [{
    label: '烘焙 Spine VAT…',
    async click() {
      await Editor.Message.request('spine-vat-importer', 'set-bake-target', info.uuid);
      await Editor.Panel.open('spine-vat-importer.bake');
    },
  }];
};
