'use strict';

const PROPERTY_NAMES = [
  'skeletonData',
  'initialClipIndex',
  'loop',
  'timeScale',
  'previewInEditor',
];

exports.template = `
<section class="spine-vat-component">
  <div class="notice">
    <ui-icon value="info"></ui-icon>
    <span>一个组件只渲染一个 VAT 实例，位置、旋转和缩放由当前节点控制。</span>
  </div>
  <div class="properties"></div>
</section>
`;

exports.style = `
.spine-vat-component { display: block; }
.properties ui-prop { margin-top: 4px; }
.notice {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 7px;
  align-items: start;
  margin: 2px 0 8px;
  padding: 8px;
  color: var(--color-normal-contrast-weakest);
  background: var(--color-normal-fill-emphasis);
  border-radius: 3px;
  line-height: 1.45;
}
.notice ui-icon { color: var(--color-focus-fill); }
`;

exports.$ = {
  properties: '.properties',
};

exports.update = function update(dump) {
  this.dump = dump;
  this.propertyElements = this.propertyElements || {};
  const children = [];

  for (const name of PROPERTY_NAMES) {
    const propertyDump = dump.value && dump.value[name];
    if (!propertyDump || !propertyDump.visible) continue;
    let element = this.propertyElements[name];
    if (!element) {
      element = document.createElement('ui-prop');
      element.setAttribute('type', 'dump');
      this.propertyElements[name] = element;
    }
    element.render(propertyDump);
    children.push(element);
  }

  for (const child of children) this.$.properties.appendChild(child);
  for (const child of Array.from(this.$.properties.children)) {
    if (!children.includes(child)) child.remove();
  }
};

exports.close = function close() {
  this.propertyElements = null;
};
