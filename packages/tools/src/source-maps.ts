/**
 * sourcemap 的两半：**出包时把 `.map` 搬走归档**，**事后拿后台的堆栈还原回源码行**。
 *
 * 为什么要搬：Creator 开了 `sourceMaps` 之后 `.map` 就躺在 `data/` 里，而 `data/` 同时走**三条**
 * 路出去 —— 热更包（manifest 无差别收集）、**APK**（gradle 把 `data/` 整个塞进 assets）、
 * **web 目录**（`cpSync(DATA, webDir)` 全量拷）。⚠️ 最后一条不经 `deployToCdn`，所以闸放在部署那步
 * 挡不住它；搬运必须夹在 **Creator 构建之后、其余一切之前**，一处堵死三条路。
 *
 * 归档布局 = **产物相对路径原样镜像**（`maps/assets/main/index.f8c7f.js.map`）：产物名带 md5
 * （`md5Cache`），所以后台堆栈里那条路径**拼上 `.map` 就是文件位置** —— 零索引表，
 * 而且不必先知道是哪一版（知道版本反而要先 grep `releases/`）。同名即同内容，直接覆盖。
 *
 * 决策见 hlgit #54。
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  LEAST_UPPER_BOUND,
  originalPositionFor,
  sourceContentFor,
  TraceMap,
} from '@jridgewell/trace-mapping';

/**
 * 递归找出 `root` 下全部 `.map`，返回相对 root 的正斜杠路径。
 *
 * ⚠️ **不跳隐藏项**（manifest 那个 `walkFiles` 跳）：gradle 打包与 `cpSync` 都不跳，
 * 一个躺在 `.cache/` 里的 `.map` 照样进 APK。这里的职责是「源码一个字节都别漏出去」，
 * 遍历口径必须比下游任何一条路都宽。
 */
export function findSourceMaps(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.map')) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

/**
 * 归档用的名字：**把产物的内容指纹补进 map 名**。
 *
 * ⚠️ 实测（Creator 3.8.7，`md5Cache: true`）：**指纹只加给 `.js`，`.map` 留的是加之前的名字**
 * —— `assets/main/index.8f281.js` 配的是 `assets/main/index.js.map`。原名归档有两个后果：
 * ① 各版本的 map 在同一个名字上**互相覆盖**，「几个月后还能还原老版本」当场作废；
 * ② 跟后台堆栈里的文件名对不上，`symbolicate` 一份都找不到。
 *
 * 所以按**同目录的兄弟 js** 把指纹补回去。认不出（没有兄弟 / 兄弟不止一个 / 名里本来就有指纹）
 * 就原名归档 —— 宁可让人查不到，也不瞎猜一个名字。
 */
function archiveName(root: string, rel: string): string {
  const cut = rel.lastIndexOf('/');
  const dir = cut < 0 ? '' : rel.slice(0, cut);
  const base = rel.slice(cut + 1, -'.map'.length); // index.js
  if (!base.endsWith('.js')) return rel;
  const stem = base.slice(0, -'.js'.length); // index
  const hashed = readdirSync(join(root, dir)).filter(
    (f) =>
      f.startsWith(`${stem}.`) &&
      f.endsWith('.js') &&
      /^[0-9a-f]+$/.test(f.slice(stem.length + 1, -'.js'.length)),
  );
  if (hashed.length !== 1) return rel;
  return dir === '' ? `${hashed[0]}.map` : `${dir}/${hashed[0]}.map`;
}

/**
 * 把 `root` 下全部 `.map` 搬到 `outDir`，返回**归档后**的相对路径。
 *
 * **搬完原地复扫，还剩就抛** —— 闸跟搬运同居一处，不必指望下游哪个工具替它把关。
 * 用「拷贝 + 删除」而不是 rename：归档目录常在另一个盘（本机是 `E:/fileserve/…`），
 * `rename` 跨设备会 EXDEV。
 */
export function stashSourceMaps(root: string, outDir: string): string[] {
  const moved: string[] = [];
  for (const rel of findSourceMaps(root)) {
    const name = archiveName(root, rel);
    const dst = join(outDir, name);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(root, rel), dst); // 名里有指纹 ⇒ 同名即同内容，覆盖即可
    rmSync(join(root, rel));
    moved.push(name);
  }
  const left = findSourceMaps(root);
  if (left.length > 0)
    throw new Error(
      `搬完产物里还剩 ${left.length} 个 .map（${left.slice(0, 3).join(' ')}）—— ` +
        '归档目录是不是落在产物里了？源码会随 APK / web 目录一起发出去',
    );
  return moved;
}

/**
 * `    at Foo.bar (a/b.js:12:5)` 与 `    at a/b.js:12:5` 两种形状。
 *
 * ⚠️ 文件那组**贪婪**匹配，靠末尾两段数字定位行列 —— 非贪婪会在第一个冒号处切断，
 * 把 `file:///D:/x.js` 的盘符当行号（与 core 的 `FRAME_RE` 同一个坑）。
 */
const FRAME_COL_RE = /^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?\s*$/;
/**
 * 同上，但**只有行号**。Crashlytics 渲染的那份堆栈是重建的 `StackTraceElement`，
 * 四个字段里没有「列」。
 *
 * 单独一条正则而不是把列写成可选组：可选组会让贪婪的文件名把行号吃进去
 * （`a.js:2:5` 会解析成文件 `a.js:2`、行 `5`）。
 */
const FRAME_LINE_RE = /^\s*at\s+(?:(.*?)\s+\()?(.+):(\d+)\)?\s*$/;

/** 一帧：认出来的文件 / 行 / 列（列可能没有）。 */
interface Frame {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

function parseFrame(text: string): Frame | undefined {
  const withCol = FRAME_COL_RE.exec(text);
  if (withCol !== null)
    return { file: withCol[2], line: Number(withCol[3]), column: Number(withCol[4]) };
  const lineOnly = FRAME_LINE_RE.exec(text);
  if (lineOnly !== null) return { file: lineOnly[2], line: Number(lineOnly[3]) };
  return undefined;
}

/**
 * 源文件名拿来给人看。
 *
 * ⚠️ **Creator 写进 map 的 `sources` 本身是坏的**：前缀被拼了两遍，实测长这样
 * `../file:/E:/…/mini-plane/file:/E:/…/mini-plane/PlaneVM.ts`。不是解码库的锅，map 里就这么写的。
 * 取**最后一个 `file:/` 之后**那截即可 —— 拼几遍都不怕，也不碰没有这个前缀的正常 map。
 */
function prettySource(source: string): string {
  const at = source.lastIndexOf('file:/');
  return at < 0 ? source : source.slice(at + 'file:/'.length);
}

/** 读一份 map；不存在 / 不是合法 JSON 都当「认不出这一帧」。 */
function loadMap(mapsDir: string, file: string): TraceMap | undefined {
  try {
    return new TraceMap(JSON.parse(readFileSync(join(mapsDir, `${file}.map`), 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * 把一整段堆栈原文还原成「源文件:行:列」，逐行返回（认得出的帧后面多插一行 `↳`）。
 *
 * **认不出的一律原样透出**：非帧行（首行消息、`at [native code]`）、查不到 map 的帧、
 * map 里没有对应映射的帧。宁可让人看见原文，也不吞掉。
 *
 * ⚠️ **堆栈原文从哪来**：Bugly 是 `stack` 字段；**Crashlytics 要去 log 面板里 `fc.log` 附的那份**，
 * 不是它渲染的那张堆栈（那张没有列）。只有行号时取的是**该行第一个**映射 —— 压缩后一行塞十几个
 * 函数，多半不是你要的那个，所以会带警告。
 */
export function symbolicate(stack: string, mapsDir: string): string[] {
  const out: string[] = [];
  const cache = new Map<string, TraceMap | undefined>();
  for (const raw of stack.split('\n')) {
    out.push(raw);
    const frame = parseFrame(raw);
    if (frame === undefined) continue;
    if (!cache.has(frame.file)) cache.set(frame.file, loadMap(mapsDir, frame.file));
    const map = cache.get(frame.file);
    if (map === undefined) continue;

    // trace-mapping 吃 1 基行 / **0 基列**，堆栈给的列是 1 基 —— 差这一格会静默错位。
    // 只有行号时用 LEAST_UPPER_BOUND 从第 0 列往后找，落到该行第一个映射。
    const pos =
      frame.column === undefined
        ? originalPositionFor(map, { line: frame.line, column: 0, bias: LEAST_UPPER_BOUND })
        : originalPositionFor(map, { line: frame.line, column: frame.column - 1 });
    if (pos.source === null || pos.line === null) continue;

    const where = `${prettySource(pos.source)}:${pos.line}:${(pos.column ?? 0) + 1}`;
    const name = pos.name === null ? '' : `  ${pos.name}`;
    const warn = frame.column === undefined ? '  ⚠ 只有行号，取的是该行第一个映射，可能不是这个函数' : '';
    out.push(`       ↳ ${where}${name}${warn}`);

    // map 里通常嵌着源码原文（Creator 会写 `sourcesContent`）—— 直接把那一行打出来，
    // 于是「几个月后收到一条老崩溃」也不必先把那个 commit 签出来。
    const code = sourceContentFor(map, pos.source)?.split('\n')[pos.line - 1]?.trim();
    if (code !== undefined && code !== '') out.push(`         | ${code}`);
  }
  return out;
}
