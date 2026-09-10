import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSourceMaps, stashSourceMaps, symbolicate } from '../source-maps';

let root: string;
let out: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cck-maps-src-'));
  out = mkdtempSync(join(tmpdir(), 'cck-maps-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

function put(dir: string, rel: string, text: string): void {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
}

describe('findSourceMaps', () => {
  it('递归找出全部 .map，返回正斜杠相对路径', () => {
    put(root, 'assets/main/index.f8c7f.js.map', '{}');
    put(root, 'assets/main/index.f8c7f.js', 'code');
    put(root, 'src/chunks/a.b.js.map', '{}');
    expect(findSourceMaps(root).sort()).toEqual(['assets/main/index.f8c7f.js.map', 'src/chunks/a.b.js.map']);
  });

  it('隐藏目录里的也算 —— gradle 和 cpSync 可不跳隐藏项', () => {
    put(root, '.cache/leak.js.map', '{}');
    expect(findSourceMaps(root)).toEqual(['.cache/leak.js.map']);
  });

  it('没有 .map 时是空表（不抛）', () => {
    put(root, 'assets/main/index.js', 'code');
    expect(findSourceMaps(root)).toEqual([]);
  });
});

describe('stashSourceMaps', () => {
  it('按镜像路径搬走，源目录一个不剩，js 原地不动', () => {
    put(root, 'assets/main/index.f8c7f.js.map', '{"v":1}');
    put(root, 'assets/main/index.f8c7f.js', 'code');
    put(root, 'application.10e23.js.map', '{"v":2}');

    const moved = stashSourceMaps(root, out);

    expect(moved.sort()).toEqual(['application.10e23.js.map', 'assets/main/index.f8c7f.js.map']);
    expect(readFileSync(join(out, 'assets/main/index.f8c7f.js.map'), 'utf8')).toBe('{"v":1}');
    expect(readFileSync(join(out, 'application.10e23.js.map'), 'utf8')).toBe('{"v":2}');
    expect(existsSync(join(root, 'assets/main/index.f8c7f.js.map'))).toBe(false);
    expect(readFileSync(join(root, 'assets/main/index.f8c7f.js'), 'utf8')).toBe('code'); // js 一个字节没动
    expect(findSourceMaps(root)).toEqual([]);
  });

  it('产物名带 md5 而 map 名不带 —— 按同目录的兄弟 js 把指纹补回去', () => {
    // 实测：Creator 只给 .js 加指纹，.map 留的是加之前的名字（index.8f281.js 配 index.js.map）。
    // 原名归档 = 各版本在同一个名字上互相覆盖，且跟后台堆栈里的文件名对不上。
    put(root, 'assets/main/index.8f281.js', 'code');
    put(root, 'assets/main/index.js.map', '{}');

    expect(stashSourceMaps(root, out)).toEqual(['assets/main/index.8f281.js.map']);
    expect(existsSync(join(out, 'assets/main/index.8f281.js.map'))).toBe(true);
    expect(existsSync(join(out, 'assets/main/index.js.map'))).toBe(false);
  });

  it('兄弟 js 名里没有指纹（没开 md5Cache）→ 原名归档', () => {
    put(root, 'assets/main/index.js', 'code');
    put(root, 'assets/main/index.js.map', '{}');
    expect(stashSourceMaps(root, out)).toEqual(['assets/main/index.js.map']);
  });

  it('map 名里本来就带指纹 → 不动它', () => {
    put(root, 'src/chunks/bundle.99d1f.js', 'code');
    put(root, 'src/chunks/bundle.99d1f.js.map', '{}');
    expect(stashSourceMaps(root, out)).toEqual(['src/chunks/bundle.99d1f.js.map']);
  });

  it('兄弟 js 不止一个 → 认不出是哪个，原名归档而不是瞎猜', () => {
    put(root, 'assets/main/index.aaaaa.js', 'a');
    put(root, 'assets/main/index.bbbbb.js', 'b');
    put(root, 'assets/main/index.js.map', '{}');
    expect(stashSourceMaps(root, out)).toEqual(['assets/main/index.js.map']);
  });

  it('归档里已有同名 —— 内容寻址下同名即同内容，覆盖不报错', () => {
    put(out, 'assets/main/index.f8c7f.js.map', '{"old":1}');
    put(root, 'assets/main/index.f8c7f.js.map', '{"new":1}');
    expect(() => stashSourceMaps(root, out)).not.toThrow();
    expect(readFileSync(join(out, 'assets/main/index.f8c7f.js.map'), 'utf8')).toBe('{"new":1}');
  });

  it('搬完还剩 .map 就抛 —— 闸跟搬运同居一处', () => {
    put(root, 'assets/main/index.js.map', '{}');
    // 归档目录落在产物里 = 搬了个寂寞（源码仍会被 gradle / cpSync 带出去）
    expect(() => stashSourceMaps(root, join(root, 'maps'))).toThrow(/还剩|残留/);
  });
});

/**
 * 手写的极小 map（`mappings` 是 VLQ：A=0 C=1 E=2 G=3 I=4）。**两处刻意的不对称，各钉一个坑**：
 *
 * 产物第 2 行的映射点在第 **2 / 5 / 6** 列（0 基），分别对应源码第 2 / 3 / 4 行。
 * - 第一个映射**不在第 0 列** → 「只有行号」那条路必须用 `LEAST_UPPER_BOUND` 往后找；
 *   用默认 bias 一个都找不到，那条帧会被静默透出。
 * - 映射点 **5 与 6 相邻** → 列的 1 基/0 基换算错一格，答案就从源码第 3 行滑到第 4 行。
 */
const MAP = JSON.stringify({
  version: 3,
  file: 'index.f8c7f.js',
  sources: ['src/PlaneVM.ts'],
  names: [],
  mappings: 'AAAA;EACA,GACA,CACA',
});

/**
 * 真产物里的 map 长这样（实测 Creator 3.8.7）：`sources` 的前缀**被拼了两遍**，
 * 而 `sourcesContent` 里嵌着源码原文。
 */
const REAL_SHAPED_MAP = JSON.stringify({
  version: 3,
  file: 'index.f8c7f.js',
  sources: ['../file:/E:/proj/assets/m/file:/E:/proj/assets/m/PlaneVM.ts'],
  sourcesContent: ['第一行\n  const solid = this.mask(x, y);\n第三行\n第四行'],
  names: [],
  mappings: 'AAAA;EACA,GACA,CACA',
});

describe('symbolicate', () => {
  let maps: string;
  beforeEach(() => {
    maps = out;
    put(maps, 'assets/main/index.f8c7f.js.map', MAP);
  });

  it('行 + 列 → 源文件:行:列（列按 1 基输出，跟堆栈同口径）', () => {
    // 第 6 列（1 基）= 第 5 列（0 基）→ 源码第 3 行。差一格就滑到第 4 行 —— 这一条钉的就是那一格。
    const lines = symbolicate('    at deep (assets/main/index.f8c7f.js:2:6)', maps);
    expect(lines[0]).toContain('at deep');
    expect(lines[1]).toContain('src/PlaneVM.ts:3:1');
    expect(lines[1]).not.toMatch(/⚠/);
  });

  it('只有行号 → 取该行第一个映射，并打不准警告', () => {
    const lines = symbolicate('    at deep (assets/main/index.f8c7f.js:2)', maps);
    expect(lines[1]).toContain('src/PlaneVM.ts:2:1');
    expect(lines[1]).toMatch(/⚠/);
  });

  it('查不到 map 的帧原样透出，不吞', () => {
    const raw = '    at boom (assets/lobby/index.abcde.js:9:1)';
    expect(symbolicate(raw, maps)).toEqual([raw]);
  });

  it('非帧行（首行消息、native code）原样透出', () => {
    const stack = 'Error: boom\n    at [native code]';
    expect(symbolicate(stack, maps)).toEqual(['Error: boom', '    at [native code]']);
  });

  it('真产物那种被拼了两遍的 sources → 只留最后一段；并把源码那一行直接打出来', () => {
    put(maps, 'assets/main/index.f8c7f.js.map', REAL_SHAPED_MAP);
    const lines = symbolicate('    at solid (assets/main/index.f8c7f.js:2:6)', maps);
    expect(lines[1]).toContain('E:/proj/assets/m/PlaneVM.ts:3:1');
    expect(lines[1]).not.toContain('file:/'); // 重复前缀已去掉
    expect(lines[2]).toBe('         | 第三行'); // sourcesContent 里的那一行
  });

  it('多帧逐条处理，顺序不变', () => {
    const stack = 'Error: boom\n    at deep (assets/main/index.f8c7f.js:2:6)\n    at top (assets/x/y.js:1:1)';
    const lines = symbolicate(stack, maps);
    expect(lines).toHaveLength(4); // 消息 + 帧 + 还原 + 认不出的帧
    expect(lines[3]).toContain('at top');
  });
});
