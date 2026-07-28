import { describe, expect, it } from 'vitest';
import { rowsToTable } from '../config-excel';

// 默认约定：行1 名 / 行2 类型 / 行3 注释 / 行4+ 数据
const sheet = (...data: unknown[][]) => [
  ['id', 'name', 'hp', 'alive', 'tags', '#note', ''], // 行1 名（#note 列跳过、末列空名跳过）
  ['int', 'string', 'float', 'bool', 'json', 'string', ''], // 行2 类型
  ['编号', '名字', '血量', '存活', '标签', '备注', ''], // 行3 注释（忽略）
  ...data,
];

describe('rowsToTable', () => {
  it('按默认行约定解析 + 各类型 coerce', () => {
    const rows = rowsToTable(sheet([1, 'A', 3.5, 'yes', '[1,2]', 'x', 'y']));
    expect(rows).toEqual([{ id: 1, name: 'A', hp: 3.5, alive: true, tags: [1, 2] }]);
  });

  it('int 截断、float 保留小数', () => {
    const rows = rowsToTable(sheet([2.9, 'A', 1.25, 'y', '0', '', '']));
    expect(rows[0].id).toBe(2); // int → 截断
    expect(rows[0].hp).toBe(1.25); // float
  });

  it('空单元格 → 省略该 key', () => {
    const rows = rowsToTable(sheet([1, '', '', 'no', '', '', '']));
    expect(rows).toEqual([{ id: 1, alive: false }]);
  });

  it('保留列全空的数据行 → 跳过', () => {
    const rows = rowsToTable(
      sheet(
        [1, 'A', 1, 'true', '[]', '', ''],
        ['', '', '', '', '', 'ignored', ''], // 保留列全空 → 跳
        [2, 'B', 2, 'false', '{}', '', ''],
      ),
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it('# 前缀列 / 空名列被丢弃', () => {
    const rows = rowsToTable(sheet([1, 'A', 1, 'y', '0', 'SKIP', 'SKIP']));
    expect(Object.keys(rows[0])).toEqual(['id', 'name', 'hp', 'alive', 'tags']);
    expect(rows[0]).not.toHaveProperty('note');
  });

  it('bool 各真/假词（不分大小写）', () => {
    const alive = (v: unknown) => rowsToTable(sheet([9, 'x', 0, v, '0', '', '']))[0].alive;
    for (const t of ['1', 'TRUE', 'yes', 'Y']) expect(alive(t)).toBe(true);
    for (const f of ['0', 'no', 'false', 'N']) expect(alive(f)).toBe(false);
  });

  it('自定义行号：3 行表头（名/类型/数据，无注释行）', () => {
    const rows = rowsToTable(
      [
        ['id', 'name'],
        ['int', 'string'],
        [1, 'A'],
        [2, 'B'],
      ],
      { dataStartRow: 3 },
    );
    expect(rows).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
  });

  it('未知类型 → 退化为 string、不抛', () => {
    const cells = [['x'], ['weirdtype'], ['注释'], ['hello']];
    expect(() => rowsToTable(cells)).not.toThrow();
    expect(rowsToTable(cells)).toEqual([{ x: 'hello' }]);
  });

  it('非法 JSON 单元格 → 省略该 key、不崩', () => {
    const rows = rowsToTable(sheet([1, 'A', 1, 'y', '{bad json', '', '']));
    expect(rows[0]).not.toHaveProperty('tags');
    expect(rows[0].id).toBe(1);
  });
});
