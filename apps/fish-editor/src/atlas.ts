/**
 * TexturePacker 的 cocos2d `.plist` 图集 —— 解析 + 往 canvas 上画一帧。
 *
 * 为什么要自己写：Cocos 侧这一步是 `SpriteFrame` 白给的，DOM 侧得自己来。**这是搬去 HTML
 * 唯一真的要补的东西**（40 来行）。补它是值得的：编辑器里的鱼因此跟游戏里**同一张图、
 * 同一帧、同一尺寸**，而不是拿判定半径糊一个方框 —— 后者正是旧编辑器跟游戏对不上的地方。
 *
 * 只支持这份图集用到的 format 3 子集：`spriteOffset` / `spriteSize` / `textureRect` /
 * `textureRotated`。**旋转必须处理** —— 167 帧里 65 帧是转着存的，鱼占 39 帧（`fish_yellow_run_0`
 * 就是），不处理会看到一堆侧躺的鱼。本图集没有 trim（`spriteSize === spriteSourceSize`、
 * `spriteOffset` 全是 `{0,0}`），所以偏移照解析但实际都为 0；换图集时它会自己生效。
 */

export interface AtlasFrame {
  /** 图集上的左上角。 */
  readonly x: number;
  readonly y: number;
  /** **画出来**的尺寸（未旋转）。图集里若是转着存的，占的区域是 `h × w`。 */
  readonly w: number;
  readonly h: number;
  /** 相对中心的偏移（本图集全 0）。 */
  readonly ox: number;
  readonly oy: number;
  /** 图集里顺时针转了 90° 存。 */
  readonly rotated: boolean;
}

const pair = (s: string): [number, number] => {
  const m = /\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

/** `{{x,y},{w,h}}` → `[x, y, w, h]`。 */
const rect = (s: string): [number, number, number, number] => {
  const m = /\{\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\}/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : [0, 0, 0, 0];
};

/**
 * 解析 plist。键名去掉 `.png` 后缀 —— 跟 Cocos 侧 `atlas.getSpriteFrame('fish_red_run_0')`
 * 用的是同一个名字，这样 `render-map.fishFrame()` 两边都能直接喂。
 *
 * 零 DOM，node 里可测。
 */
export function parseAtlasPlist(xml: string): Map<string, AtlasFrame> {
  const out = new Map<string, AtlasFrame>();
  const framesAt = xml.indexOf('<key>frames</key>');
  if (framesAt < 0) return out;
  // 每帧是「<key>名字.png</key> <dict>…</dict>」，dict 里只有 array/string/bool，不再嵌 dict
  const re = /<key>([^<]+)\.png<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml.slice(framesAt))) !== null) {
    const body = m[2];
    const str = (key: string): string => {
      const r = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(body);
      return r ? r[1] : '';
    };
    const [x, y] = rect(str('textureRect'));
    const [w, h] = pair(str('spriteSize'));
    const [ox, oy] = pair(str('spriteOffset'));
    out.set(m[1], {
      x,
      y,
      w,
      h,
      ox,
      oy,
      rotated: /<key>textureRotated<\/key>\s*<true\/>/.test(body),
    });
  }
  return out;
}

export interface Atlas {
  readonly image: HTMLImageElement;
  readonly frames: Map<string, AtlasFrame>;
}

export async function loadAtlas(pngUrl: string, plistXml: string): Promise<Atlas> {
  const image = new Image();
  image.src = pngUrl;
  await image.decode();
  return { image, frames: parseAtlasPlist(plistXml) };
}

/**
 * 把一帧画到 `(cx, cy)`（画布坐标），带世界朝向。
 *
 * 坐标系换算说明（错一处鱼就侧躺或者反着游）：画布是 **y 向下**、世界是 **y 向上**，
 * 所以世界里逆时针转 `deg` 在画布上是顺时针 —— `ctx.rotate(-rad)`。`flipY` 是绕鱼自己的
 * 长轴翻（`render-map.fishFacing` 定的那条：转过 90° 就翻，别肚皮朝天），在旋转之后做。
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  name: string,
  cx: number,
  cy: number,
  scale: number,
  deg: number,
  flipY: boolean,
): boolean {
  const f = atlas.frames.get(name);
  if (!f) return false;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-deg * Math.PI) / 180);
  if (flipY) ctx.scale(1, -1);
  ctx.scale(scale, scale);
  ctx.translate(f.ox, -f.oy);
  if (f.rotated) {
    // 图集里顺时针转了 90° 存，画之前先转回来；占的区域是 h × w
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(atlas.image, f.x, f.y, f.h, f.w, -f.h / 2, -f.w / 2, f.h, f.w);
  } else {
    ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, -f.w / 2, -f.h / 2, f.w, f.h);
  }
  ctx.restore();
  return true;
}
