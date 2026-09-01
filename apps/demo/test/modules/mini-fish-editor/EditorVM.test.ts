import { describe, expect, it } from 'vitest';
import {
  EditorVM,
  memoryEditorStorage,
} from '../../../assets/modules/mini-fish-editor/EditorVM';
import type { FishContent } from '../../../assets/modules/mini-fish/content/content-types';
import { waveFeeder } from '../../../assets/modules/mini-fish/seams/feeder';

const SRC: FishContent = {
  rev: 3,
  paths: [
    { id: 'a', p: [-1160, 0, -400, 0, 400, 0, 1160, 0] },
    { id: 'b', p: [1160, 260, 400, 260, -400, 260, -1160, 260] },
  ],
  waves: [
    {
      id: 'w',
      groups: [
        { at: 0, path: 'a', kind: 'fish_yellow', count: 2, gap: 0.5, speed: 100 },
        { at: 1, path: 'b', kind: 'fish_red', count: 1, speed: 90 },
      ],
    },
  ],
};

describe('EditorVM · 载入', () => {
  it('载入即深拷贝 —— 编辑器改草稿不许动到源码那份对象', () => {
    const vm = new EditorVM(SRC);
    vm.dragPoint(0, 5, 5);
    expect(SRC.paths[0].p[0]).toBe(-1160);
    expect(vm.draft.paths[0].p[0]).toBe(5);
  });

  it('gap 省略的 group 补成 0 —— 草稿里字段齐全，View 不必到处 ?? 0', () => {
    const vm = new EditorVM(SRC);
    expect(vm.draft.waves[0].groups[1].gap).toBe(0);
  });
});

describe('EditorVM · 路径', () => {
  it('新路径从选中那条复制起手，id 自动去重并选中新的', () => {
    const vm = new EditorVM(SRC);
    vm.copyPath();
    expect(vm.draft.paths).toHaveLength(3);
    expect(vm.draft.paths[2].id).toBe('a-2');
    expect(vm.draft.paths[2].p).toEqual(SRC.paths[0].p);
    expect(vm.selectedPath).toBe(2);
  });

  it('删掉被引用的路径 ⇒ 那个 group 进**未解析态**，不静默改指别处', () => {
    const vm = new EditorVM(SRC);
    vm.removePath(); // 选中的是第 0 条 'a'
    expect(vm.draft.paths.map((p) => p.id)).toEqual(['b']);
    // 引用 'a' 的那个 group 仍然写着 'a' —— 它现在解析不到，View 据此标红
    expect(vm.unresolved()).toEqual([{ wave: 0, group: 0, path: 'a' }]);
    // 换成下标的话这里会静默变成「指向 b」，鱼照游、只是走错路 —— 那正是选稳定 id 要避免的
    expect(vm.draft.waves[0].groups[0].path).toBe('a');
  });

  it('最后一条路径删不掉 —— 没有路径的内容没法编', () => {
    const vm = new EditorVM({ rev: 1, paths: [{ id: 'a', p: [0, 0, 1, 0, 2, 0, 3, 0] }], waves: [] });
    vm.removePath();
    expect(vm.draft.paths).toHaveLength(1);
  });
});

describe('EditorVM · 控制点', () => {
  it('命中判定按世界坐标 + 容差，返回控制点下标', () => {
    const vm = new EditorVM(SRC); // 选中 'a'：(-1160,0) (-400,0) (400,0) (1160,0)
    expect(vm.hitTest(-1155, 3, 12)).toBe(0);
    expect(vm.hitTest(400, 0, 12)).toBe(2);
    expect(vm.hitTest(0, 0, 12)).toBeNull(); // 曲线上，但不是控制点
  });

  it('拖拽落点写进选中路径的那个控制点', () => {
    const vm = new EditorVM(SRC);
    vm.dragPoint(3, 900, -120);
    expect(vm.draft.paths[0].p.slice(6)).toEqual([900, -120]);
  });
});

describe('EditorVM · 鱼阵', () => {
  it('加 / 删 group，以及改一个 group 的旋钮', () => {
    const vm = new EditorVM(SRC);
    vm.addGroup();
    expect(vm.draft.waves[0].groups).toHaveLength(3);
    vm.patchGroup(2, { count: 7, speed: 150 });
    expect(vm.draft.waves[0].groups[2].count).toBe(7);
    expect(vm.draft.waves[0].groups[2].speed).toBe(150);
    vm.removeGroup(2);
    expect(vm.draft.waves[0].groups).toHaveLength(2);
  });

  it('新阵 id 去重，且选中切到新阵', () => {
    const vm = new EditorVM(SRC);
    vm.addWave();
    expect(vm.draft.waves[1].id).toBe('wave');
    vm.addWave(); // 再来一个才撞名
    expect(vm.draft.waves[2].id).toBe('wave-2');
    expect(vm.selectedWave).toBe(2);
  });
});

describe('EditorVM · 导出', () => {
  it('rev 只在导出时 +1 —— 编辑过程中一动不动', () => {
    const vm = new EditorVM(SRC);
    vm.dragPoint(0, 1, 1);
    vm.addGroup();
    expect(vm.draft.rev).toBe(3);
    const text = vm.exportText();
    expect(vm.draft.rev).toBe(4);
    expect(text).toContain('rev: 4');
  });

  it('导出的内容游戏吃得下 —— 直接喂 waveFeeder 能跑出鱼', () => {
    const vm = new EditorVM(SRC);
    const content = vm.toContent();
    const out = waveFeeder(content, { order: ['w'] }).next(2);
    expect(out).toHaveLength(3); // 2 条 + 1 条
  });

  it('导出文本是 content.ts 的全文：带头部注释、import 与 as const satisfies', () => {
    const text = new EditorVM(SRC).exportText();
    expect(text).toContain("import type { FishContent } from './content-types'");
    expect(text).toContain('export const CONTENT = {');
    expect(text).toContain('} as const satisfies FishContent;');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('省略 gap 的 group 导出时不写这个字段 —— 默认值不该占一行 diff', () => {
    const text = new EditorVM(SRC).exportText();
    expect(text).toContain("{ at: 1, path: 'b', kind: 'fish_red', count: 1, speed: 90 }");
  });
});

describe('EditorVM · 草稿', () => {
  const key = 'test.draft';

  it('默认显示源码那份，**不自动恢复**草稿 —— 自动恢复会拿旧草稿盖掉别人贴回的内容', () => {
    const storage = memoryEditorStorage();
    const a = new EditorVM(SRC, { storage, storageKey: key, now: () => 1000 });
    a.dragPoint(0, 42, 42);
    a.saveDraft();

    const b = new EditorVM(SRC, { storage, storageKey: key, now: () => 2000 });
    expect(b.draft.paths[0].p[0]).toBe(-1160); // 还是源码那份
    expect(b.draftInfo()).toEqual({ rev: 3, savedAt: 1000 });

    b.restoreDraft();
    expect(b.draft.paths[0].p[0]).toBe(42);
  });

  it('草稿记的是**基线** rev（源码那个），不是导出后的新值', () => {
    const storage = memoryEditorStorage();
    const vm = new EditorVM(SRC, { storage, storageKey: key, now: () => 5 });
    vm.exportText(); // rev 3 → 4
    vm.saveDraft();
    expect(new EditorVM(SRC, { storage, storageKey: key }).draftInfo()?.rev).toBe(4);
  });

  it('丢弃后就没有了；存坏了也当没有 —— 一行脏数据不许把编辑器卡死', () => {
    const storage = memoryEditorStorage();
    const vm = new EditorVM(SRC, { storage, storageKey: key });
    vm.saveDraft();
    vm.discardDraft();
    expect(vm.draftInfo()).toBeNull();

    storage.write(key, '{ 这不是 JSON');
    expect(new EditorVM(SRC, { storage, storageKey: key }).draftInfo()).toBeNull();
  });

  it('没给 storage 就整个不落盘（node 单测 / 没有 localStorage 的宿主）', () => {
    const vm = new EditorVM(SRC);
    vm.saveDraft();
    expect(vm.draftInfo()).toBeNull();
  });
});

describe('EditorVM · 变更通知', () => {
  it('每次改动 changed +1，View 订阅它整体重画', () => {
    const vm = new EditorVM(SRC);
    const before = vm.changed.value;
    vm.addGroup();
    vm.dragPoint(0, 1, 1);
    expect(vm.changed.value).toBe(before + 2);
  });
});
