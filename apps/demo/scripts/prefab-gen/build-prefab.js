/**
 * prefab 生成器 —— **在 Cocos Creator 的 scene 进程里执行**（funplay MCP `execute_scene_script`），
 * 吃一份 JSON 描述（同目录 `*.prefab.json`）吐一个 `.prefab` 资源。
 *
 * 为什么要它：约定是「UI 一律走 prefab」，但**首次创建**手点效率太低、也不可复现。
 * 于是描述用 JSON 版本化，建树 + 落盘交给本文件；**改已有 prefab 请走 MCP**，别重跑本脚本覆盖别人的编辑。
 *
 * 为什么不自己把 JSON 直接写成 `.prefab` 文件：裸序列化 `Node` 出来的资源缺 `PrefabInfo`，
 * 运行时能 `instantiate`、编辑器一打开就崩（reading 'instance'）。所以必须借编辑器原生
 * `scene · create-prefab` 消息落盘 —— 它才会补齐 `PrefabInfo` / `CompPrefabInfo`。
 *
 * 用法：`execute_scene_script({ code: <本文件内容>, args: <描述 JSON> | { specs: [描述, …] } })`
 *
 * ⚠️ 四条硬约束（都踩过）：
 *  1. **一律 `cc.` 前缀、别解构**——`director` / `Node` / `scene` 等已是进程全局，
 *     `const { director } = cc` 直接抛 "Identifier 'director' has already been declared"。
 *  2. 顶层变量统一加 `_pg` 前缀，同理避开全局重名。
 *  3. **跑之前先停掉编辑器预览**（Game View 在播放中时 `create-prefab` **静默失败**：
 *     返回 null、不抛错、不落盘）。返回结果里 `created` 是 null 就是这个。
 *  4. **同名资源已存在也是静默失败**（同样返回 null）。重新生成前先删掉旧的。
 *  5. ⚠️ **ScrollView 要三层节点**：`scroll`（挂 ScrollView）→ `view`（挂 Mask，裁剪就是它）
 *     → `content`（真正装列表项、Layout 挂这儿）。本脚本按**约定名**接线：带 `scroll` 的节点
 *     其子节点必须叫 `view`，`view` 的子节点必须叫 `content`，缺一个就抛 —— 静默接不上的话
 *     表现是「列表画出来了但滚不动」，那种 bug 极难从现象反推。
 *
 * 描述 schema（够用即可，缺什么加什么）：
 *   { url, root: Node }
 *   Node = {
 *     name, pos?: [x,y], size?: [w,h], anchor?: [x,y], active?: bool,
 *     label?:  { string?, fontSize?, lineHeight?, color?: [r,g,b,a?], align?: 'left'|'center'|'right' },
 *     sprite?: { frame: <uuid>, type?: 'simple'|'sliced'|'filled', fill?: 'horizontal'|'vertical',
 *                fillStart?: 0..1, fillRange?: 0..1, color?: [r,g,b,a?], sizeMode?: 'custom'|'trimmed'|'raw' },
 *     editBox?: { placeholder?, string?, password?: bool, maxLength?, fontSize?,
 *                 color?: [r,g,b,a?], placeholderColor?: [r,g,b,a?], frame?: <uuid>, bgColor?: [r,g,b,a?] },
 *     button?:  { transition?: 'color'|'none', normal?, hover?, pressed?, disabled?: [r,g,b,a?] },
 *     toggle?:  { checked?: bool },        // 父节点自动挂 ToggleContainer（页签互斥全靠它）
 *     slider?:  { progress?: 0..1, direction?: 'horizontal'|'vertical', handle?: <子节点名> },
 *     layout?:  { type?: 'horizontal'|'vertical'|'grid', spacing?, padding?: [l,r,t,b],
 *                 resize?: 'none'|'container'|'children', cell?: [w,h] },
 *     scroll?:  { vertical?: bool, horizontal?: bool, inertia?: bool },  // 见下「⚠️ ScrollView」
 *     widget?:  { left?, right?, top?, bottom?, hCenter?: bool, vCenter?: bool },
 *     graphics?: true,                     // 画布：Graphics 组件（曲线 / 控制点由代码画）
 *     comp?: '<@ccclass 名>',   // 挂一个项目脚本组件（如 'LoginView'）
 *     children?: Node[],
 *   }
 */
const _pgArgs = typeof args !== 'undefined' && args ? args : null;
const _pgSpecs = _pgArgs && _pgArgs.specs ? _pgArgs.specs : _pgArgs ? [_pgArgs] : [];
if (!_pgSpecs.length) throw new Error('build-prefab: 缺 args.{url,root} 描述（或 args.specs 数组）');

const _pgColor = (c) => new cc.Color(c[0], c[1], c[2], c.length > 3 ? c[3] : 255);
const _pgHAlign = { left: cc.Label.HorizontalAlign.LEFT, center: cc.Label.HorizontalAlign.CENTER, right: cc.Label.HorizontalAlign.RIGHT };
const _pgType = { simple: cc.Sprite.Type.SIMPLE, sliced: cc.Sprite.Type.SLICED, filled: cc.Sprite.Type.FILLED };
const _pgFill = { horizontal: cc.Sprite.FillType.HORIZONTAL, vertical: cc.Sprite.FillType.VERTICAL };
const _pgSizeMode = { custom: cc.Sprite.SizeMode.CUSTOM, trimmed: cc.Sprite.SizeMode.TRIMMED, raw: cc.Sprite.SizeMode.RAW };
const _pgLayoutType = { none: cc.Layout.Type.NONE, horizontal: cc.Layout.Type.HORIZONTAL, vertical: cc.Layout.Type.VERTICAL, grid: cc.Layout.Type.GRID };
const _pgResize = { none: cc.Layout.ResizeMode.NONE, container: cc.Layout.ResizeMode.CONTAINER, children: cc.Layout.ResizeMode.CHILDREN };
const _pgSliderDir = { horizontal: cc.Slider.Direction.Horizontal, vertical: cc.Slider.Direction.Vertical };

/** 按 uuid 取资源（scene 进程走 editor 的资源管线，缓存没有就异步拉一次）。 */
const _pgLoad = (uuid) =>
  new Promise((resolve, reject) =>
    cc.assetManager.loadAny({ uuid }, (err, asset) => (err ? reject(err) : resolve(asset))),
  );

async function _pgBuild(desc, parent) {
  const node = new cc.Node(desc.name);
  node.layer = cc.Layers.Enum.UI_2D; // 不设就是 DEFAULT → UI 相机 visibility 不含它 → 整个界面不可见
  parent.addChild(node);
  if (desc.pos) node.setPosition(new cc.Vec3(desc.pos[0], desc.pos[1], 0));
  if (desc.active === false) node.active = false;

  const ui = node.addComponent(cc.UITransform);
  if (desc.size) ui.setContentSize(desc.size[0], desc.size[1]);
  if (desc.anchor) ui.setAnchorPoint(desc.anchor[0], desc.anchor[1]);

  if (desc.label) {
    const l = desc.label;
    const label = node.addComponent(cc.Label);
    label.string = l.string ?? '';
    if (l.fontSize !== undefined) label.fontSize = l.fontSize;
    label.lineHeight = l.lineHeight ?? (l.fontSize !== undefined ? l.fontSize + 8 : label.lineHeight);
    if (l.color) label.color = _pgColor(l.color);
    label.horizontalAlign = _pgHAlign[l.align ?? 'center'];
    label.verticalAlign = cc.Label.VerticalAlign.CENTER;
  }

  if (desc.sprite) {
    const s = desc.sprite;
    const sprite = node.addComponent(cc.Sprite);
    sprite.spriteFrame = await _pgLoad(s.frame);
    sprite.type = _pgType[s.type ?? 'simple'];
    sprite.sizeMode = _pgSizeMode[s.sizeMode ?? 'custom']; // custom：尺寸听 UITransform 的，不被贴图尺寸顶掉
    if (sprite.type === cc.Sprite.Type.FILLED) {
      sprite.fillType = _pgFill[s.fill ?? 'horizontal'];
      sprite.fillStart = s.fillStart ?? 0;
      sprite.fillRange = s.fillRange ?? 1;
    }
    if (s.color) sprite.color = _pgColor(s.color);
    if (desc.size) ui.setContentSize(desc.size[0], desc.size[1]); // spriteFrame 会重设尺寸，设完再压回去
  }

  if (desc.editBox) {
    const e = desc.editBox;
    // addComponent 当场自建 TEXT_LABEL / PLACEHOLDER_LABEL 两个子节点 + 一个背景 Sprite，
    // 所以这里**不要**再自己加 Sprite（一个节点两个 Sprite 会互相顶掉）。
    const eb = node.addComponent(cc.EditBox);
    eb.inputMode = cc.EditBox.InputMode.SINGLE_LINE;
    eb.placeholder = e.placeholder ?? '';
    eb.string = e.string ?? '';
    if (e.maxLength !== undefined) eb.maxLength = e.maxLength;
    if (e.password) eb.inputFlag = cc.EditBox.InputFlag.PASSWORD;
    const bg = node.getComponent(cc.Sprite);
    if (bg && e.frame) {
      bg.spriteFrame = await _pgLoad(e.frame);
      bg.type = cc.Sprite.Type.SLICED;
      bg.sizeMode = cc.Sprite.SizeMode.CUSTOM;
      if (e.bgColor) bg.color = _pgColor(e.bgColor);
    }
    for (const label of [eb.textLabel, eb.placeholderLabel]) {
      if (!label) continue;
      if (e.fontSize !== undefined) {
        label.fontSize = e.fontSize;
        label.lineHeight = e.fontSize + 8;
      }
      // ⚠️ 锚点必须掰成左上角：EditBox 的 `_resizeChildNodes` 把标签摆在 (-w/2, h/2)，
      // 那是**按锚点 (0,1) 算的**；而 addComponent 建出来的标签节点锚点是 (0.5,0.5)，
      // 两边对不上 → 文字整个跑到输入框左上角外面（编辑器菜单加的 EditBox 没这问题，
      // 它用的是配好的节点模板）。这一步不做，输入框看着就是「字在框外」。
      label.node.getComponent(cc.UITransform).setAnchorPoint(0, 1);
      label.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
      label.verticalAlign = cc.Label.VerticalAlign.CENTER;
    }
    if (eb.textLabel && e.color) eb.textLabel.color = _pgColor(e.color);
    if (eb.placeholderLabel && e.placeholderColor) {
      eb.placeholderLabel.color = _pgColor(e.placeholderColor);
    }
    if (desc.size) ui.setContentSize(desc.size[0], desc.size[1]); // 背景图会重设尺寸，设完压回去
  }

  if (desc.graphics) node.addComponent(cc.Graphics);

  if (desc.layout) {
    const l = desc.layout;
    const layout = node.addComponent(cc.Layout);
    layout.type = _pgLayoutType[l.type ?? 'vertical'];
    if (l.spacing !== undefined) {
      layout.spacingX = l.spacing;
      layout.spacingY = l.spacing;
    }
    if (l.padding) {
      layout.paddingLeft = l.padding[0];
      layout.paddingRight = l.padding[1];
      layout.paddingTop = l.padding[2];
      layout.paddingBottom = l.padding[3];
    }
    layout.resizeMode = _pgResize[l.resize ?? 'none'];
    if (l.cell) {
      layout.cellSize = new cc.Size(l.cell[0], l.cell[1]);
    }
  }

  if (desc.widget) {
    const w = desc.widget;
    const widget = node.addComponent(cc.Widget);
    for (const k of ['left', 'right', 'top', 'bottom']) {
      if (w[k] === undefined) continue;
      widget['isAlign' + k[0].toUpperCase() + k.slice(1)] = true;
      widget[k] = w[k];
    }
    if (w.hCenter) widget.isAlignHorizontalCenter = true;
    if (w.vCenter) widget.isAlignVerticalCenter = true;
    widget.alignMode = cc.Widget.AlignMode.ALWAYS; // ONCE 只在第一帧算，父节点后来改尺寸就对不上了
  }

  if (desc.button) {
    const b = desc.button;
    const btn = node.addComponent(cc.Button);
    btn.transition = b.transition === 'none' ? cc.Button.Transition.NONE : cc.Button.Transition.COLOR;
    btn.target = node; // 不指就是 null ⇒ 点了没有任何反馈，且不报错
    if (b.normal) btn.normalColor = _pgColor(b.normal);
    if (b.hover) btn.hoverColor = _pgColor(b.hover);
    if (b.pressed) btn.pressedColor = _pgColor(b.pressed);
    if (b.disabled) btn.disabledColor = _pgColor(b.disabled);
  }

  if (desc.toggle) {
    const tg = node.addComponent(cc.Toggle);
    tg.isChecked = !!desc.toggle.checked;
    // 互斥归**父节点**的 ToggleContainer 管：谁都不挂的话两个页签能同时选中
    const box = parent.getComponent(cc.ToggleContainer) ?? parent.addComponent(cc.ToggleContainer);
    box.allowSwitchOff = false;
  }

  if (desc.slider) {
    const s = desc.slider;
    const sl = node.addComponent(cc.Slider);
    sl.direction = _pgSliderDir[s.direction ?? 'horizontal'];
    sl.progress = s.progress ?? 0;
    // handle 得等子节点建完才拿得到，记下来最后接（下面 children 循环之后）
    node._pgSliderHandle = s.handle ?? 'Handle';
  }

  if (desc.scroll) {
    const s = desc.scroll;
    const sv = node.addComponent(cc.ScrollView);
    sv.vertical = s.vertical ?? true;
    sv.horizontal = s.horizontal ?? false;
    sv.inertia = s.inertia ?? true;
    node._pgScroll = sv;
  }

  // 项目脚本组件（界面薄壳）。名字是 @ccclass 注册名——编辑器已编译项目脚本，取不到就是名字写错了。
  if (desc.comp) {
    if (!cc.js.getClassByName(desc.comp)) throw new Error(`build-prefab: 找不到组件类 '${desc.comp}'`);
    node.addComponent(desc.comp);
  }

  for (const child of desc.children ?? []) await _pgBuild(child, node);

  // —— 要等子节点存在才接得上的两处 ——
  if (node._pgSliderHandle) {
    const handle = node.getChildByName(node._pgSliderHandle);
    if (!handle) throw new Error(`build-prefab: '${desc.name}' 的 slider 找不到 handle 子节点 '${node._pgSliderHandle}'`);
    const sl = node.getComponent(cc.Slider);
    sl.handle = handle.getComponent(cc.Button) ?? handle.addComponent(cc.Button);
    sl.handle.transition = cc.Button.Transition.NONE;
    delete node._pgSliderHandle;
  }
  if (node._pgScroll) {
    const view = node.getChildByName('view');
    const content = view && view.getChildByName('content');
    if (!content) throw new Error(`build-prefab: '${desc.name}' 的 scroll 缺 view/content 子节点（约定名，见文件头约束 5）`);
    if (!view.getComponent(cc.Mask)) view.addComponent(cc.Mask); // 不裁剪的话列表会画到面板外面
    node._pgScroll.content = content;
    delete node._pgScroll;
  }

  return node;
}

const _pgScene = cc.director.getScene();
if (!_pgScene) throw new Error('build-prefab: 没有活动场景');

const _pgOut = [];
for (const spec of _pgSpecs) {
  // 同名残留先清（重跑本脚本时）
  const stale = _pgScene.getChildByName(spec.root.name);
  if (stale) stale.destroy();

  const root = await _pgBuild(spec.root, _pgScene);
  let created;
  try {
    created = await Editor.Message.request('scene', 'create-prefab', root.uuid, spec.url);
  } catch (e) {
    created = await Editor.Message.request('scene', 'create-prefab', { uuid: root.uuid, url: spec.url });
  }
  root.destroy(); // 临时节点不留在场景里
  _pgOut.push({ url: spec.url, created: created ?? null });
}

// ⚠️ 跑完**别保存当前场景**：`create-prefab` 会把那个临时节点转成 prefab 实例，
// `destroy()` 要下一帧才生效，此时 save 会把它连同一堆 PropertyOverrideInfo 写进场景文件。
// 保险做法是生成后重新 `open_scene` 丢弃内存改动。
return _pgOut;
