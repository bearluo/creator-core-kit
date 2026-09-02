import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 全工程的 prefab 闸：**有子节点的 `UIRenderer` 不许带半透明**。
 *
 * `Batcher2D.walk` 里 `opacity *= 自身 UIRenderer 的 color.a / 255`，节点自己的 alpha 会乘进
 * **整棵子树**（乘到 0 那一支连递归都不进）。于是「半透明底 + 子节点放文字」= 文字跟着变淡，
 * alpha 归零 = 文字**彻底消失**，而 `active` / `enabled` / `Label.color` 在检查器里全是对的 ——
 * 一个能查的地方都不异常，只是不画，从现象反推不到原因。
 *
 * 想要半透明观感就把它**烘进 RGB**；想要「这块没有底」就在 View 里 `sprite.enabled = false`
 *（关组件不影响子树：`uiComp` 只在 destroy 时才摘）。判据与两种写法见
 * `apps/demo/docs/ui-style-guide.md`。
 */
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

function prefabs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) prefabs(p, out);
    else if (e.name.endsWith('.prefab')) out.push(p);
  }
  return out;
}

describe('prefab 里的半透明', () => {
  const files = prefabs(ASSETS);

  it('扫到了 prefab —— 目录挪走后闸会退化成空跑，先钉住规模', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('有子节点的 UIRenderer 一律不带半透明（那是整棵子树的不透明度乘数）', () => {
    const bad: string[] = [];
    for (const file of files) {
      const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
      const walk = (id: number, prefix: string | null): void => {
        const n = j[id] as {
          __type__?: string;
          _name?: string;
          _children?: { __id__: number }[];
          _components?: { __id__: number }[];
        };
        if (!n || n.__type__ !== 'cc.Node') return;
        const here = prefix === null ? '' : prefix ? `${prefix}/${n._name}` : String(n._name);
        if ((n._children ?? []).length > 0) {
          for (const c of n._components ?? []) {
            const comp = j[c.__id__] as { __type__?: string; _color?: { a?: number } };
            const a = comp?._color?.a;
            if (a !== undefined && a < 255) {
              const rel = file.slice(ASSETS.length).replace(/\\/g, '/');
              bad.push(`${rel} :: ${here || '(根)'} 的 ${comp.__type__} alpha=${a}`);
            }
          }
        }
        for (const c of n._children ?? []) walk(c.__id__, prefix === null ? '' : here);
      };
      walk(1, null);
    }
    expect(bad).toEqual([]);
  });
});
