// 从水果机 Spine 生成剪裁动画测试资源：在 tigger 上分别叠加剪裁附件的激活切换 / 形变 / 凹多边形。
// 用法：node tools/gen-clip-test-spine.mjs   （产物入库，改了本脚本重跑一次）
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../assets/resources/fruit-machine/', import.meta.url);
const src = JSON.parse(readFileSync(new URL('letsparty_tuan_nanwuzhe.json', dir), 'utf8'));
const base = src.animations.letsparty_tuan_nanwuzhe_tigger;
const clip = src.skins[0].attachments.zz.zz;
const local = clip.vertices; // 7 个点，非加权

const withClip = (extra) => {
  const anim = structuredClone(base);
  if (extra.slot) anim.slots = { ...anim.slots, zz: extra.slot };
  if (extra.deform) anim.attachments = {
    ...anim.attachments,
    default: { ...anim.attachments.default, zz: { zz: { deform: extra.deform } } },
  };
  return anim;
};

// 往中心收缩 k 倍的 deform 偏移量
const shrink = (k) => local.map((v) => -v * k);
// 右上角 (193,193) 拉到 (0,0)：形成凹口
const notch = local.map((v, i) => (i === 4 || i === 5 ? -v : 0));

const out = {
  ...src,
  skeleton: { ...src.skeleton, hash: `${src.skeleton.hash}-cliptest` },
  animations: {
    clip_toggle: withClip({
      slot: { attachment: [{ name: 'zz' }, { time: 0.5, name: null }, { time: 1, name: 'zz' }, { time: 1.5, name: null }] },
    }),
    clip_deform: withClip({
      deform: [{}, { time: 1, vertices: shrink(0.35) }, { time: 2 }],
    }),
    clip_concave: withClip({
      deform: [{ vertices: notch }],
    }),
  },
};

writeFileSync(new URL('letsparty_tuan_nanwuzhe_cliptest.json', dir), JSON.stringify(out));
console.log('ok', Object.keys(out.animations));
