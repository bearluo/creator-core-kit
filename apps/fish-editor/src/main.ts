/**
 * 鱼阵编辑器的 View —— DOM + canvas。**逻辑一行都不在这儿**：
 *
 * | 要什么 | 从哪来 |
 * |---|---|
 * | 编的是什么（草稿 / 拖点 / 分段 / 导出 / 落盘） | `EditorVM` |
 * | 路径求值、弧长恒速 | `@game/content/paths` |
 * | 鱼阵怎么放、鱼怎么走、什么时候离场 | `@game/FishVM`（**游戏本体那个**，不是仿的） |
 * | 帧号、朝向、场地怎么裁 | `@game/render-map`（游戏 View 读的是同一份） |
 * | 鱼长什么样 | `@game/art/textures.plist` + `.png`（游戏用的同一张图集、同一帧） |
 *
 * 所以「编辑器里看到的就是游戏里的」不靠人记得同步，靠这张表里每一行都只有一个实现。
 */
import { effect } from '@cck/core';
import { defineQuery, Position } from '@cck/ecs-bitecs';
import { CONTENT } from '@game/content/content';
import { FISH_KINDS, fishKind } from '@game/content/fish-kinds';
import { FIELD, makeFishPath, pointAt, segmentCount } from '@game/content/paths';
import { Angle, Fish } from '@game/ecs/components';
import { FishVM } from '@game/FishVM';
import { fishFacing, fishFrame, visibleField } from '@game/render-map';
import { waveFeeder } from '@game/seams/feeder';
import atlasPng from '@game/art/textures.png';
import atlasPlist from '@game/art/textures.plist?raw';
import { drawFrame, loadAtlas, type Atlas } from './atlas';
import { EditorVM, type DraftGroup, type EditorStorage } from './EditorVM';

// ——————————————————————————————————————————————————————————————
// 起手：VM + 草稿存储
// ——————————————————————————————————————————————————————————————

/**
 * 草稿落盘。**key 带来源前缀**：同一台机器上开着别的分支 / 别的工程的编辑器时，
 * 草稿不该互相盖。`location.pathname` 就够 —— 这是内部工具，不是多租户系统。
 */
function browserStorage(): EditorStorage {
  return {
    read: (k) => localStorage.getItem(k),
    write: (k, v) => localStorage.setItem(k, v),
    clear: (k) => localStorage.removeItem(k),
  };
}

const vm = new EditorVM(CONTENT, {
  storage: browserStorage(),
  storageKey: `cck.fishEditorDraft:${location.pathname}`,
});

// ——————————————————————————————————————————————————————————————
// View 自己的状态 —— **一个字节都不进 content.ts**
// ——————————————————————————————————————————————————————————————

let tab: 'path' | 'wave' = 'path';
/** 正在拖 `p` 里第几对坐标。 */
let drag: number | null = null;
let playing = false;
let clock = 0;
let last = 0;
/** 预览用的运行时。换阵 / 改队 / 拖点都要重建它。 */
let preview: FishVM | undefined;
let atlas: Atlas | undefined;

/**
 * 被隐藏的路径 id。**用 id 不用下标** —— 删一条路径之后下标错位，隐藏状态会静默跳到别的路径上。
 */
const hidden = new Set<string>();
const visible = (id: string): boolean => !hidden.has(id);
/** 名称筛选，两页各记各的。 */
let filterPath = '';
let filterWave = '';
/** 可见区叠加（cover 会裁掉 FIELD 的边，默认不画免得干扰）。 */
let showSafe = false;

const fishQuery = defineQuery([Fish, Position]);

// ——————————————————————————————————————————————————————————————
// 画布
// ——————————————————————————————————————————————————————————————

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round = (v: number): number => Math.round(v * 1000) / 1000;

const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d')!;
/** 缩放 1 时的世界→画布倍率。2480 ≈ 场地 1920 再留出两边各 280 的余量。 */
const BASE = cv.width / 2480;
/** 视野：画布中心对着世界哪一点、放大多少。控制点可以被拖到场地外很远，没有它就够不着。 */
const camera = { cx: 0, cy: 0, z: 1 };
const S = (): number => BASE * camera.z;
const toS = (x: number, y: number): [number, number] => [
  cv.width / 2 + (x - camera.cx) * S(),
  cv.height / 2 - (y - camera.cy) * S(),
];
const toW = (sx: number, sy: number): [number, number] => [
  camera.cx + (sx - cv.width / 2) / S(),
  camera.cy - (sy - cv.height / 2) / S(),
];
/** 画布坐标（不是 CSS 坐标）—— 画布被 CSS 缩放过，两者不等。 */
function evToCanvas(e: { clientX: number; clientY: number }): [number, number] {
  const r = cv.getBoundingClientRect();
  return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
}

const showZoom = (): void => {
  $('zoom').textContent = `${Math.round(camera.z * 100)}%`;
};

/** 把所有路径 + 场地一起装进视野。点被甩飞之后靠它一键找回。 */
function fitView(): void {
  let x0 = -FIELD.width / 2;
  let y0 = -FIELD.height / 2;
  let x1 = FIELD.width / 2;
  let y1 = FIELD.height / 2;
  for (const path of vm.draft.paths) {
    for (let i = 0; i < path.p.length; i += 2) {
      x0 = Math.min(x0, path.p[i]);
      x1 = Math.max(x1, path.p[i]);
      y0 = Math.min(y0, path.p[i + 1]);
      y1 = Math.max(y1, path.p[i + 1]);
    }
  }
  const pad = 150;
  camera.cx = (x0 + x1) / 2;
  camera.cy = (y0 + y1) / 2;
  camera.z = Math.min(
    cv.width / (BASE * (x1 - x0 + pad * 2)),
    cv.height / (BASE * (y1 - y0 + pad * 2)),
  );
  draw();
  showZoom();
}

/** 路径缓存：`makeFishPath` 会建弧长 LUT，别每帧重建。草稿一动就整表作废。 */
let lut = new Map<string, ReturnType<typeof makeFishPath>>();
function pathOf(id: string): ReturnType<typeof makeFishPath> | undefined {
  const hit = lut.get(id);
  if (hit) return hit;
  const src = vm.draft.paths.find((p) => p.id === id);
  if (!src) return undefined;
  const made = makeFishPath(src.p);
  lut.set(id, made);
  return made;
}

function draw(): void {
  ctx.fillStyle = '#0d1c26';
  ctx.fillRect(0, 0, cv.width, cv.height);

  // 场地框
  const [fx, fy] = toS(-FIELD.width / 2, FIELD.height / 2);
  ctx.strokeStyle = '#22404f';
  ctx.lineWidth = 2;
  ctx.strokeRect(fx, fy, FIELD.width * S(), FIELD.height * S());
  ctx.fillStyle = '#4d6b7d';
  ctx.font = '20px "IBM Plex Mono",monospace';
  ctx.fillText(`${FIELD.width} × ${FIELD.height} 场地`, fx + 10, fy + 26);

  if (showSafe) drawSafeArea();

  // 鱼阵页只画**这一阵用到的**路线 —— 别的跟这阵没关系，画出来全是干扰
  const wave = vm.draft.waves[vm.selectedWave];
  const used = tab === 'wave' ? new Set((wave?.groups ?? []).map((g) => g.path)) : null;

  vm.draft.paths.forEach((path, i) => {
    if (!visible(path.id)) return;
    if (used && !used.has(path.id)) return;
    const on = i === vm.selectedPath;
    const geom = pathOf(path.id);
    if (!geom) return;

    ctx.strokeStyle = on ? (tab === 'path' ? '#f0a03c' : '#47c8c0') : '#243f4f';
    ctx.lineWidth = on ? 4 : 2;
    ctx.beginPath();
    for (let s = 0; s <= 160; s++) {
      const q = pointAt(geom, s / 160);
      const [x, y] = toS(q.x, q.y);
      if (s) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();

    if (!on) return;

    ctx.fillStyle = '#7d9aab';
    ctx.font = '19px "IBM Plex Mono",monospace';
    const head = pointAt(geom, 0.02);
    const [hx, hy] = toS(head.x, head.y);
    ctx.fillText(path.id, hx + 8, hy - 10);

    // 弧长刻点：等距 = 恒速的可视证据
    ctx.fillStyle = '#47c8c088';
    for (let s = 0; s <= 24; s++) {
      const q = pointAt(geom, s / 24);
      const [x, y] = toS(q.x, q.y);
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, 7);
      ctx.fill();
    }

    if (tab !== 'path') return;
    drawControls(path.p);
  });

  if (tab === 'wave') drawFish();
}

/** cover 之后各比例屏幕都看得见的那块。摆在它外面的鱼，窄屏上会被裁掉。 */
function drawSafeArea(): void {
  const wide = visibleField(2400, 1080); // 20:9
  const tall = visibleField(1440, 1080); // 4:3
  const w = Math.min(wide.width, tall.width);
  const h = Math.min(wide.height, tall.height);
  const [x, y] = toS(-w / 2, h / 2);
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = '#f0a03c99';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w * S(), h * S());
  ctx.fillStyle = '#f0a03c99';
  ctx.font = '18px "IBM Plex Mono",monospace';
  ctx.fillText(`安全区 ${w} × ${h}（4:3 ~ 20:9 都看得见）`, x + 10, y + 26);
  ctx.restore();
}

/** 选中路径的控制点、手柄、折角。 */
function drawControls(p: readonly number[]): void {
  const n = segmentCount(p);
  const cornerAt = new Set(vm.corners().map((c) => c.seg));

  // 选中段加粗一层
  const k = vm.selectedSegment * 6;
  ctx.strokeStyle = '#ffc987';
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let s = 0; s <= 40; s++) {
    const t = s / 40;
    const u = 1 - t;
    const b = (i: number): number =>
      u * u * u * p[k + i] + 3 * u * u * t * p[k + i + 2] + 3 * u * t * t * p[k + i + 4] + t * t * t * p[k + i + 6];
    const [x, y] = toS(b(0), b(1));
    if (s) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();

  // 手柄连线
  ctx.strokeStyle = '#f0a03c77';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let s = 0; s < n; s++) {
    const b = s * 6;
    for (const [a, c] of [
      [b, b + 2],
      [b + 4, b + 6],
    ]) {
      const [ax, ay] = toS(p[a], p[a + 1]);
      const [cx, cy] = toS(p[c], p[c + 1]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(cx, cy);
    }
  }
  ctx.stroke();

  // 锚点大圆（折角接点画方块）、手柄小圆
  for (let i = 0; i < p.length / 2; i++) {
    const isAnchor = i % 3 === 0;
    const isCorner = isAnchor && cornerAt.has(i / 3);
    const [x, y] = toS(p[i * 2], p[i * 2 + 1]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = isCorner ? '#e0574f' : '#f0a03c';
    ctx.fillStyle = isAnchor ? (isCorner ? '#e0574f' : '#ffe0b0') : '#0d1c26';
    ctx.beginPath();
    if (isCorner) ctx.rect(x - 9, y - 9, 18, 18);
    else ctx.arc(x, y, isAnchor ? 10 : 7.5, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
}

/** 把 `FishVM` 世界里的鱼画出来。**位置、朝向、帧号全是运行时给的**，一处都不是仿的。 */
function drawFish(): void {
  const world = preview?.world;
  if (!world) {
    $('live').textContent = '场上 0';
    return;
  }
  let live = 0;
  for (const eid of fishQuery(world)) {
    live++;
    const kind = fishKind(Fish.kind[eid]);
    const [x, y] = toS(Position.x[eid], Position.y[eid]);
    const facing = fishFacing(Angle.v[eid]);
    const drawn =
      atlas && drawFrame(ctx, atlas, fishFrame(kind, clock), x, y, S(), facing.deg, facing.flipY);
    if (!drawn) {
      // 图集还没到 / 帧名对不上：画个圈占位，别让人以为鱼没生出来
      ctx.fillStyle = '#47c8c0';
      ctx.beginPath();
      ctx.arc(x, y, kind.r * S(), 0, 7);
      ctx.fill();
    }
  }
  $('live').textContent = `场上 ${live}`;
}

// ——————————————————————————————————————————————————————————————
// 平移 / 缩放 / 拖点
// ——————————————————————————————————————————————————————————————

let pan: { sx: number; sy: number; cx: number; cy: number } | null = null;
let space = false;

addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || space) return;
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return; // 输入框里空格是空格
  space = true;
  cv.style.cursor = 'grab';
  e.preventDefault();
});
addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  space = false;
  if (!pan) cv.style.cursor = 'crosshair';
});

cv.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [sx, sy] = evToCanvas(e);
    const [wx, wy] = toW(sx, sy);
    camera.z = clamp(camera.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.15, 6);
    const [nx, ny] = toW(sx, sy); // 光标底下那个世界点保持不动
    camera.cx += wx - nx;
    camera.cy += wy - ny;
    draw();
    showZoom();
  },
  { passive: false },
);

cv.addEventListener('pointerdown', (e) => {
  if (space || e.button === 1) {
    // 平移优先于选点
    e.preventDefault();
    pan = { sx: e.clientX, sy: e.clientY, cx: camera.cx, cy: camera.cy };
    cv.style.cursor = 'grabbing';
    cv.setPointerCapture(e.pointerId);
    return;
  }
  if (tab !== 'path') return;
  const [wx, wy] = toW(...evToCanvas(e));
  // 命中半径在**屏幕上**恒定：放大之后不该更难点中
  const hit = vm.hitTest(wx, wy, 24 / S());
  if (hit === null) return;
  drag = hit;
  vm.selectedSegment = vm.segmentOf(hit);
  cv.setPointerCapture(e.pointerId);
  renderAll();
});

cv.addEventListener('pointermove', (e) => {
  if (pan) {
    const r = cv.getBoundingClientRect();
    const k = cv.width / r.width / S();
    camera.cx = pan.cx - (e.clientX - pan.sx) * k;
    camera.cy = pan.cy + (e.clientY - pan.sy) * k;
    draw();
    return;
  }
  if (drag === null) return;
  const [wx, wy] = toW(...evToCanvas(e));
  vm.dragPoint(drag, Math.round(wx), Math.round(wy), { mirror: !e.altKey });
  // 拖的时候只重画布 + 回填那两个坐标框：整栏重建会每帧抢走输入焦点
  const p = vm.draft.paths[vm.selectedPath].p;
  const cx = document.getElementById('cx') as HTMLInputElement | null;
  const cy = document.getElementById('cy') as HTMLInputElement | null;
  if (cx) cx.value = String(p[drag * 2]);
  if (cy) cy.value = String(p[drag * 2 + 1]);
});

addEventListener('pointerup', () => {
  if (pan) {
    pan = null;
    cv.style.cursor = space ? 'grab' : 'crosshair';
  }
  if (drag !== null) {
    drag = null;
    restartPreview();
    renderAll();
  }
});

// ——————————————————————————————————————————————————————————————
// 左右两栏
// ——————————————————————————————————————————————————————————————

/**
 * 只重画列表行，**不碰筛选框** —— 整栏 `innerHTML` 重建会每敲一个字就抢走焦点和光标位置。
 */
function renderRows(): void {
  const q = (tab === 'path' ? filterPath : filterWave).trim().toLowerCase();
  const hit = (id: string): boolean => !q || id.toLowerCase().includes(q);
  const ul = document.getElementById(tab === 'path' ? 'plist' : 'wlist');
  if (!ul) return;
  const keepTop = ul.scrollTop;
  ul.innerHTML = '';
  let shown = 0;

  if (tab === 'path') {
    vm.draft.paths.forEach((p, i) => {
      if (!hit(p.id)) return;
      shown++;
      const li = document.createElement('li');
      const on = visible(p.id);
      li.className = `row${i === vm.selectedPath ? ' on' : ''}${on ? '' : ' off'}`;
      li.innerHTML =
        `<button class="eye" title="显影">${on ? '◉' : '○'}</button>` +
        `<span class="nm">${esc(p.id)}</span><span class="meta">${segmentCount(p.p)} 段</span>`;
      li.querySelector<HTMLButtonElement>('.eye')!.onclick = (e) => {
        e.stopPropagation(); // 点眼睛只切显影，不改选中
        if (on) hidden.add(p.id);
        else hidden.delete(p.id);
        renderRows();
        draw();
        syncLinesBtn();
      };
      // 选中一条被隐藏的 ⇒ 自动显影：编看不见的东西没有意义
      li.onclick = () => {
        vm.selectedPath = i;
        vm.selectedSegment = 0;
        hidden.delete(p.id);
        renderAll();
      };
      ul.appendChild(li);
    });
    $('pcount').textContent = q ? `${shown} / ${vm.draft.paths.length}` : String(vm.draft.paths.length);
  } else {
    vm.draft.waves.forEach((w, i) => {
      if (!hit(w.id)) return;
      shown++;
      const li = document.createElement('li');
      li.className = `row wave${i === vm.selectedWave ? ' on' : ''}`;
      const n = w.groups.reduce((a, g) => a + g.count, 0);
      li.innerHTML = `<span class="nm">${esc(w.id)}</span><span class="meta">${n} 条</span>`;
      li.onclick = () => {
        vm.selectedWave = i;
        restartPreview();
        renderAll();
      };
      ul.appendChild(li);
    });
    $('wcount').textContent = q ? `${shown} / ${vm.draft.waves.length}` : String(vm.draft.waves.length);
  }
  ul.scrollTop = keepTop;
  if (!shown) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `没有名字含「${q}」的`;
    ul.appendChild(li);
  }
}

function renderLeft(): void {
  const el = $('left');
  if (tab === 'path') {
    el.innerHTML =
      '<h2>路径 <span id="pcount"></span></h2>' +
      `<input class="filter" id="pfilter" type="text" placeholder="筛选名称…" value="${esc(filterPath)}">` +
      '<ul id="plist" class="list"></ul>' +
      '<button id="copyPath" style="width:100%;margin-bottom:5px">＋ 复制这条</button>' +
      '<button class="danger" id="delPath" style="width:100%">－ 删掉这条</button>';
    $<HTMLInputElement>('pfilter').oninput = (e) => {
      filterPath = (e.target as HTMLInputElement).value;
      renderRows();
    };
    renderRows();
    $('copyPath').onclick = () => {
      vm.copyPath();
      const list = document.getElementById('plist');
      if (list) list.scrollTop = list.scrollHeight;
    };
    $('delPath').onclick = () => vm.removePath();
  } else {
    el.innerHTML =
      '<h2>鱼阵 <span id="wcount"></span></h2>' +
      `<input class="filter" id="wfilter" type="text" placeholder="筛选名称…" value="${esc(filterWave)}">` +
      '<ul id="wlist" class="list"></ul>' +
      '<button id="addWave" style="width:100%;margin-bottom:5px">＋ 新阵</button>' +
      '<button class="danger" id="delWave" style="width:100%">－ 删掉这阵</button>';
    $<HTMLInputElement>('wfilter').oninput = (e) => {
      filterWave = (e.target as HTMLInputElement).value;
      renderRows();
    };
    renderRows();
    $('addWave').onclick = () => {
      vm.addWave();
      restartPreview();
    };
    $('delWave').onclick = () => {
      vm.removeWave();
      restartPreview();
    };
  }
}

function renderRight(): void {
  const el = $('right');
  // ⚠️ 重建 innerHTML 会把 scrollTop 打回 0 —— 于是「加一队鱼」之后视图跳回顶部、
  //    新那队在下面看不见，看起来就像根本没滚动。改完先把位置存下来。
  const keepTop = el.scrollTop;

  if (tab === 'path') {
    const path = vm.draft.paths[vm.selectedPath];
    const p = path.p;
    const n = segmentCount(p);
    const cs = vm.corners();
    let h =
      '<h2>路径</h2>' +
      fieldText('id', path.id, 'pid') +
      `<h2>段 ${n}</h2>` +
      '<div class="seg"><button class="step" id="segPrev">◀</button>' +
      `<span class="now">第 ${vm.selectedSegment + 1} / ${n} 段</span>` +
      '<button class="step" id="segNext">▶</button></div>' +
      '<button id="addSeg" style="width:100%;margin-bottom:5px">＋ 在尾巴接一段</button>' +
      `<button class="danger" id="delSeg" style="width:100%"${n < 2 ? ' disabled' : ''}>－ 删掉末段</button>`;
    const sel = drag ?? vm.selectedSegment * 3;
    h +=
      `<h2>控制点 ${sel + 1}</h2>` +
      fieldNum('x', p[sel * 2], 10, 'cx') +
      fieldNum('y', p[sel * 2 + 1], 10, 'cy') +
      '<p class="hint">拖锚点：两侧手柄跟着走。<br>拖手柄：对面自动镜像 —— 按住 <kbd>Alt</kbd> 打断、故意折。</p>';
    if (cs.length) {
      h +=
        `<div class="warnbox">这条路有 <b>${cs.length} 个折角</b>：` +
        cs.map((c) => `第 ${c.seg}↔${c.seg + 1} 段 <b>${c.deg}°</b>`).join('、') +
        '。鱼到那里会瞬间转头 —— 想要就留着，不想要按住 Alt 之外拖一下手柄即可拉平。</div>';
    }
    el.innerHTML = h;
    el.scrollTop = keepTop;

    $<HTMLInputElement>('pid').oninput = (e) => {
      path.id = (e.target as HTMLInputElement).value;
      lut = new Map();
      renderLeft();
      draw();
    };
    $('segPrev').onclick = () => {
      vm.selectedSegment = (vm.selectedSegment - 1 + n) % n;
      renderAll();
    };
    $('segNext').onclick = () => {
      vm.selectedSegment = (vm.selectedSegment + 1) % n;
      renderAll();
    };
    $('addSeg').onclick = () => vm.addSegment();
    $('delSeg').onclick = () => vm.removeSegment();
    bindNum('cx', (v) => vm.dragPoint(sel, v, p[sel * 2 + 1]), 10);
    bindNum('cy', (v) => vm.dragPoint(sel, p[sel * 2], v), 10);
  } else {
    const w = vm.draft.waves[vm.selectedWave];
    const known = new Set(vm.draft.paths.map((p) => p.id));
    let h = `<h2>鱼阵</h2>${fieldText('id', w.id, 'wid')}<h2>队 ${w.groups.length}</h2>`;
    w.groups.forEach((g, i) => {
      h +=
        `<div class="group"><div class="ghead"><span>队 ${i + 1}</span>` +
        `<button class="step" data-jump="${i}" title="去改这条路">↗</button>` +
        `<button class="step danger" data-del="${i}">✕</button></div>` +
        fieldPick('路径', g.path, `gp${i}`, !known.has(g.path)) +
        fieldPick('鱼种', g.kind.replace('fish_', ''), `gk${i}`, false) +
        fieldNum('入场', g.at, 0.1, `ga${i}`) +
        fieldNum('条数', g.count, 1, `gc${i}`) +
        fieldNum('间隔', g.gap, 0.05, `gg${i}`) +
        fieldNum('速度', g.speed, 10, `gs${i}`) +
        '</div>';
    });
    h += '<button id="addGroup" style="width:100%">＋ 加一队鱼</button>';
    el.innerHTML = h;
    el.scrollTop = keepTop;

    $<HTMLInputElement>('wid').oninput = (e) => {
      w.id = (e.target as HTMLInputElement).value;
      renderLeft();
    };
    el.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.onclick = () => {
        vm.removeGroup(Number(b.dataset.del));
        restartPreview();
      };
    });
    el.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach((b) => {
      b.onclick = () => {
        const id = w.groups[Number(b.dataset.jump)].path;
        const k = vm.draft.paths.findIndex((p) => p.id === id);
        if (k >= 0) {
          vm.selectedPath = k;
          vm.selectedSegment = 0;
        }
        setTab('path');
      };
    });
    $('addGroup').onclick = () => {
      vm.addGroup();
      restartPreview();
      el.scrollTop = el.scrollHeight; // 新那队在最下面，滚过去让人看见
    };
    w.groups.forEach((g, i) => {
      pick(`gp${i}`, vm.draft.paths.map((p) => p.id), g.path, (v) => patch(i, { path: v }));
      pick(
        `gk${i}`,
        FISH_KINDS.map((k) => k.id.replace('fish_', '')),
        g.kind.replace('fish_', ''),
        (v) => patch(i, { kind: `fish_${v}` }),
      );
      bindNum(`ga${i}`, (v) => patch(i, { at: clamp(v, 0, 120) }), 0.1);
      bindNum(`gc${i}`, (v) => patch(i, { count: Math.round(clamp(v, 1, 60)) }), 1);
      bindNum(`gg${i}`, (v) => patch(i, { gap: clamp(v, 0, 10) }), 0.05);
      bindNum(`gs${i}`, (v) => patch(i, { speed: clamp(v, 10, 600) }), 10);
    });
  }
}

function patch(index: number, p: Partial<DraftGroup>): void {
  vm.patchGroup(index, p);
  restartPreview();
}

// —— 控件工厂 ——————————————————————————————————————————————

const fieldText = (label: string, val: string, id: string): string =>
  `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${esc(val)}"></div>`;

const fieldNum = (label: string, val: number, step: number, id: string): string =>
  `<div class="field"><label>${label}</label><div class="num">` +
  `<button class="step" data-dec="${id}">◀</button>` +
  `<input type="number" id="${id}" value="${val}" step="${step}">` +
  `<button class="step" data-inc="${id}">▶</button></div></div>`;

const fieldPick = (label: string, val: string, id: string, bad: boolean): string =>
  `<div class="field"><label>${label}</label>` +
  `<div class="pick" id="${id}"><button class="${bad ? 'bad' : ''}">${esc(val)}</button></div></div>`;

/** 数字：能敲也能 ◀▶；**夹紧不拒绝** —— 失焦解析，NaN 回退原值。 */
function bindNum(id: string, apply: (v: number) => void, step: number): void {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  const orig = el.value;
  const fire = (): void => {
    const v = parseFloat(el.value);
    apply(Number.isFinite(v) ? v : parseFloat(orig));
  };
  el.onchange = fire;
  el.onkeydown = (e) => {
    if (e.key === 'Enter') fire();
  };
  const root = el.closest('.field')!;
  root.querySelector<HTMLButtonElement>('[data-dec]')!.onclick = () =>
    apply(round(parseFloat(el.value) - step));
  root.querySelector<HTMLButtonElement>('[data-inc]')!.onclick = () =>
    apply(round(parseFloat(el.value) + step));
}

/** 下拉：点当前值弹一张小列表 + 全屏遮罩关闭。 */
function pick(id: string, options: readonly string[], cur: string, apply: (v: string) => void): void {
  const box = document.getElementById(id);
  if (!box) return;
  (box.firstElementChild as HTMLButtonElement).onclick = () => {
    closePop();
    const r = box.getBoundingClientRect();
    const veil = document.createElement('div');
    veil.className = 'veil';
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.style.left = `${r.left}px`;
    pop.style.width = `${r.width}px`;
    pop.style.top = `${r.bottom + 3}px`;
    veil.onclick = closePop;
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o;
      if (o === cur) b.className = 'on';
      b.onclick = () => {
        closePop();
        apply(o);
      };
      pop.appendChild(b);
    }
    document.body.appendChild(veil);
    document.body.appendChild(pop);
    // 下面塞不下就翻到触发按钮上方
    const h = pop.getBoundingClientRect().height;
    if (r.bottom + 3 + h > innerHeight) pop.style.top = `${Math.max(6, r.top - 3 - h)}px`;
  };
}

const closePop = (): void => {
  document.querySelectorAll('.pop,.veil').forEach((n) => n.remove());
};
// fixed 定位跟不上滚动/缩放，那就关掉它 —— 比让它飘在错的位置强
addEventListener('scroll', closePop, true);
addEventListener('resize', closePop);

// ——————————————————————————————————————————————————————————————
// 预览与走带（只在鱼阵页）
// ——————————————————————————————————————————————————————————————

/**
 * 重建预览。**跑的是游戏本体的 `FishVM`**（`aiAgents: []` ⇒ 只剩玩家那门炮，
 * 而它不 `aim()` 就永不开火 ⇒ 无子弹、无结算、只有鱼在游）。
 */
function restartPreview(): void {
  lut = new Map();
  clock = 0;
  const wave = vm.draft.waves[vm.selectedWave];
  if (!wave) {
    preview = undefined;
    return;
  }
  // 引用不到的路径会让 waveFeeder 当场抛 —— 那正是要的，但编辑器不能因此崩掉
  try {
    preview = new FishVM({
      feeder: waveFeeder(vm.toContent(), { order: [wave.id], loop: false }),
      aiAgents: [],
    });
    $('hint').dataset.err = '';
  } catch (e) {
    preview = undefined;
    $('hint').dataset.err = '这个阵还有解析不到的路径引用，先修再预览';
    console.warn('[fish-editor] 这个阵还有解析不到的引用，先修再预览', e);
  }
}

/**
 * 这一阵要放多久。**按草稿的几何算**（`makeFishPath(draft.p).length`），不是按
 * `content.ts` 里烘好的那份 —— 否则刚把路径拖长，走带还按旧长度收尾。
 */
function duration(): number {
  const wave = vm.draft.waves[vm.selectedWave];
  if (!wave) return 8;
  let end = 3;
  for (const g of wave.groups) {
    const geom = pathOf(g.path);
    if (!geom) continue;
    const travel = geom.length / Math.max(1, g.speed);
    for (let i = 0; i < g.count; i++) end = Math.max(end, g.at + i * g.gap + travel);
  }
  return Math.ceil(Math.min(120, end + 0.5) * 10) / 10;
}

function setPlay(v: boolean): void {
  playing = v;
  $('play').textContent = v ? '⏸ 暂停' : '▶ 播放';
  if (v) last = performance.now();
}

/** 跳到某一秒：**从头重跑到那儿**。ECS 世界没有倒带，只能重放。 */
function seek(t: number): void {
  const d = duration();
  const target = clamp(t, 0, d);
  restartPreview();
  const step = 1 / 60;
  for (let s = 0; s < target; s += step) preview?.tick(step);
  clock = target;
  syncTransport();
  draw();
}

function syncTransport(): void {
  const d = duration();
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(d);
  scrub.value = String(clock);
  $('clock').textContent = `${clock.toFixed(2)} / ${d.toFixed(1)} s`;
}

function loop(now: number): void {
  if (playing && tab === 'wave') {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const d = duration();
    if (clock + dt >= d) {
      clock = d;
      setPlay(false);
    } else {
      clock += dt;
      preview?.tick(dt);
    }
    syncTransport();
    draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

$('play').onclick = () => {
  if (!playing && clock >= duration()) seek(0);
  setPlay(!playing);
};
$('home').onclick = () => {
  setPlay(false);
  seek(0);
};
$('stepB').onclick = () => {
  setPlay(false);
  seek(clock - 0.1);
};
$('stepF').onclick = () => {
  setPlay(false);
  seek(clock + 0.1);
};
$<HTMLInputElement>('scrub').oninput = () => {
  setPlay(false);
  seek(Number($<HTMLInputElement>('scrub').value));
};

// ——————————————————————————————————————————————————————————————
// 页签 / 导出 / 草稿
// ——————————————————————————————————————————————————————————————

function setTab(t: 'path' | 'wave'): void {
  tab = t;
  $('tabPath').className = t === 'path' ? 'on' : '';
  $('tabWave').className = t === 'wave' ? 'on' : '';
  $('transport').style.display = t === 'wave' ? 'flex' : 'none';
  if (t === 'path') setPlay(false);
  else restartPreview();
  renderAll();
}
$('tabPath').onclick = () => setTab('path');
$('tabWave').onclick = () => setTab('wave');

$('btnExport').onclick = () => {
  const text = vm.exportText();
  $('out').textContent = text;
  const done = (ok: boolean): void => {
    $('btnExport').textContent = ok ? `已复制 rev ${vm.draft.rev}` : '⚠ 复制不了 → 看下面';
    setTimeout(() => {
      $('btnExport').textContent = '⧉ 复制 content.ts 全文';
    }, 1800);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => done(true),
      () => done(false),
    );
  } else {
    done(false);
  }
};

$('btnDraft').onclick = () => {
  vm.saveDraft();
  syncBanner();
};
$('btnRestore').onclick = () => {
  vm.restoreDraft();
  restartPreview();
  syncBanner();
};
$('btnDiscard').onclick = () => {
  vm.discardDraft();
  syncBanner();
};

/** 有草稿只**提示**，不自动恢复 —— 怕拿旧草稿盖掉别人贴回 `content.ts` 的内容。 */
function syncBanner(): void {
  const info = vm.draftInfo();
  $('banner').style.display = info ? 'flex' : 'none';
  if (info) {
    const mins = Math.round((Date.now() - info.savedAt) / 60000);
    $('bannerText').innerHTML =
      `有一份未导出的草稿（基于 rev ${info.rev} · ${mins < 1 ? '刚刚' : `${mins} 分钟前`}）` +
      ' —— <b>默认不自动恢复</b>，怕拿旧草稿盖掉别人贴回的内容';
  }
}

// ——————————————————————————————————————————————————————————————
// 「路线」批量显影
// ——————————————————————————————————————————————————————————————

/** 「路线」按钮管的那一批：鱼阵页 = 这一阵用到的，路径页 = 全部（正在编的那条不许被批量隐掉）。 */
function poolPaths(): { id: string }[] {
  if (tab === 'wave') {
    const used = new Set((vm.draft.waves[vm.selectedWave]?.groups ?? []).map((g) => g.path));
    return vm.draft.paths.filter((p) => used.has(p.id));
  }
  return vm.draft.paths.filter((_, i) => i !== vm.selectedPath);
}

function syncLinesBtn(): void {
  const pool = poolPaths();
  const any = pool.some((p) => visible(p.id));
  const b = $('lines');
  b.textContent = `${any ? '◉' : '○'} 路线`;
  b.className = any ? 'go' : '';
  b.title = any ? '全部隐藏' : '全部显示';
}

$('lines').onclick = () => {
  const pool = poolPaths();
  const any = pool.some((p) => visible(p.id));
  for (const p of pool) {
    if (any) hidden.add(p.id);
    else hidden.delete(p.id);
  }
  renderLeft();
  draw();
  syncLinesBtn();
};

$('fit').onclick = fitView;

$('safe').onclick = () => {
  showSafe = !showSafe;
  $('safe').className = showSafe ? 'go' : '';
  draw();
};

// ——————————————————————————————————————————————————————————————
// 整体重画 + 起手
// ——————————————————————————————————————————————————————————————

function renderAll(): void {
  lut = new Map();
  // 拖点的时候整栏重建会每帧抢走输入焦点，只重画布
  if (drag !== null) {
    draw();
    return;
  }
  renderLeft();
  renderRight();
  draw();
  $('rev').textContent = String(vm.draft.rev);
  syncLinesBtn();
  const err = $('hint').dataset.err;
  $('hint').innerHTML =
    err ||
    (tab === 'path'
      ? '画布两页共用。灰线是别的路径 —— 排新路时要对照着看挤不挤，用左边每行的 <b>◉</b> 单独收起来。<b style="color:#47c8c0">青色小点</b>是弧长等距采样：它们均匀，就是鱼恒速的证据。'
      : '<b>只画这一阵用到的</b>路线，别的跟这阵无关。走带只在这一页 —— 跑的是游戏本体的运行时。');
  if (tab === 'wave') syncTransport();
}

// 整体重画：编辑器不是每帧刷新的东西，细粒度绑定不值那个代码量
effect(() => {
  void vm.changed.value; // 订阅它
  renderAll();
});

syncBanner();
setTab('path');
fitView();
$('out').textContent =
  '（点上面「复制 content.ts 全文」，导出的文本会出现在这里 —— 剪贴板在非安全上下文用不了时的兜底）';

// 图集是异步的：先把界面画出来，鱼到了再重画一次，别为一张图 block 住整个工具
loadAtlas(atlasPng, atlasPlist).then(
  (a) => {
    atlas = a;
    draw();
  },
  (e) => console.warn('[fish-editor] 图集没load上，鱼先用圆圈占位', e),
);
