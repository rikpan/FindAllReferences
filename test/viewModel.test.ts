// Webview 视图模型：范围、筛选、排序、分组、复制。

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const VM = require('../../media/viewModel.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const I18N = require('../../media/i18n.js');

let nextId = 1;

function item(fields: Record<string, unknown>)
{
    return {
        id: nextId++,
        uri: 'file:///x',
        fileKey: String(fields.relativePath ?? 'a.cs'),
        fileName: String(fields.relativePath ?? 'a.cs').split('/').pop(),
        relativePath: 'a.cs',
        line: 0,
        column: 0,
        endColumn: 1,
        code: '',
        project: '',
        member: '',
        type: '',
        kind: '',
        repository: 'repo',
        isDefinition: false,
        ...fields,
    };
}

const result = {
    symbol: 'HumanoidMotion',
    definition: { label: 'struct HumanoidMotion', icon: 'symbol-struct' },
    originProject: 'Assembly-CSharp',
    originFileKey: 'View/PresentationHumanoid.cs',
};

const items = [
    item({ relativePath: 'View/PresentationHumanoid.cs', line: 212, column: 26, project: 'Assembly-CSharp', kind: 'typeArgument' }),
    item({ relativePath: 'View/ArenaHumanoidBinding.cs', line: 72, column: 48, project: 'Assembly-CSharp', kind: 'typeArgument' }),
    item({ relativePath: 'View/PresentationHumanoid.cs', line: 218, column: 21, project: 'Assembly-CSharp', kind: 'qualified' }),
    item({ relativePath: 'Editor/HumanoidTests.cs', line: 407, column: 77, project: 'Assembly-CSharp-Editor', kind: 'typeArgument' }),
    item({ relativePath: 'Sim/HumanoidMotion.cs', line: 5, column: 18, project: 'Quantum.Simulation', kind: 'definition', isDefinition: true }),
];

const context = { activeFileKey: 'View/PresentationHumanoid.cs', activeProject: 'Assembly-CSharp', openFileKeys: ['Editor/HumanoidTests.cs'], changedFileKeys: [] };

function filter(options: Record<string, unknown>)
{
    return VM.filterItems(items, { scope: 'solution', context, result, filters: {}, search: '', ...options });
}

test('默认分组「项目，然后是定义」：项目按名排序，组内按文件、行排序，计数是下属条目数', () =>
{
    const rows = VM.buildRows(VM.sortItems(items, null), { groupBy: 'project-definition', listView: false, result, collapsed: [] });
    const groups = rows.filter((row: any) => row.type === 'group').map((row: any) => `${row.level}:${row.label}(${row.count})`);
    assert.deepEqual(groups, [
        '0:Assembly-CSharp(3)',
        '1:struct HumanoidMotion(3)',
        '0:Assembly-CSharp-Editor(1)',
        '1:struct HumanoidMotion(1)',
        '0:Quantum.Simulation(1)',
        '1:struct HumanoidMotion(1)',
    ]);
    const first = rows.slice(2, 5).map((row: any) => `${row.item.relativePath}:${row.item.line}`);
    assert.deepEqual(first, ['View/ArenaHumanoidBinding.cs:72', 'View/PresentationHumanoid.cs:212', 'View/PresentationHumanoid.cs:218']);
});

test('折叠的组不展开子行，但仍带全部条目供复制', () =>
{
    const sorted = VM.sortItems(items, null);
    const keys = VM.allGroupKeys(sorted, { groupBy: 'project-definition', result });
    const rows = VM.buildRows(sorted, { groupBy: 'project-definition', listView: false, result, collapsed: [keys[0]] });
    assert.equal(rows[0].expanded, false);
    assert.equal(rows[1].label, 'Assembly-CSharp-Editor');
    assert.equal(VM.selectedItems(rows, [rows[0].key]).length, 3);
});

test('列表视图不分组', () =>
{
    const rows = VM.buildRows(items, { groupBy: 'project-definition', listView: true, result, collapsed: [] });
    assert.equal(rows.length, items.length);
    assert.ok(rows.every((row: any) => row.type === 'item' && row.level === 0));
});

test('其他分组方式的层级', () =>
{
    for (const grouping of VM.GROUPINGS)
    {
        const rows = VM.buildRows(items, { groupBy: grouping.id, listView: false, result, collapsed: [] });
        const levels = new Set(rows.filter((row: any) => row.type === 'group').map((row: any) => row.field + row.level));
        assert.deepEqual([...levels].sort(), grouping.levels.map((field: string, level: number) => field + level).sort(), grouping.id);
        assert.equal(rows.filter((row: any) => row.type === 'item').length, items.length, grouping.id);
    }
});

test('范围：当前项目、当前文档、打开的文档', () =>
{
    assert.equal(filter({ scope: 'project' }).length, 3);
    assert.equal(filter({ scope: 'document' }).length, 2);
    assert.equal(filter({ scope: 'open' }).length, 1);
    assert.equal(filter({ scope: 'changed' }).length, 0);
    const noActive = { ...context, activeProject: '', activeFileKey: '' };
    assert.equal(filter({ scope: 'project', context: noActive }).length, 3, '没有活动文档时退回发起查找的项目');
});

test('列筛选与搜索框叠加；候选值排除本列筛选', () =>
{
    assert.equal(filter({ filters: { kind: ['合格'] } }).length, 1);
    assert.equal(filter({ filters: { project: ['Assembly-CSharp'] }, search: 'arena' }).length, 1);
    const values = VM.distinctValues(filter({ filters: { kind: ['合格'] }, skipFilter: 'kind' }), 'kind');
    assert.deepEqual(values.map((v: any) => v.value).sort(), ['合格', '定义', '类型参数'].sort());
    assert.equal(values.find((v: any) => v.value === '类型参数').count, 3);
    assert.equal(VM.distinctValues(items, 'member')[0].value, '(空白)');
});

test('排序：数值列按数值，平局按默认顺序', () =>
{
    const byLine = VM.sortItems(items, { column: 'line', descending: true }).map((it: any) => it.line);
    assert.deepEqual(byLine, [407, 218, 212, 72, 5]);
    const byKind = VM.sortItems(items, { column: 'kind', descending: false }).map((it: any) => VM.columnText(it, 'kind'));
    assert.deepEqual(byKind, [...byKind].sort((a: string, b: string) => a.localeCompare(b, 'zh-CN')));
});

test('复制：表头加制表符分隔，行列显示为 1 起', () =>
{
    const text = VM.formatCopy([items[0]], ['file', 'line', 'column', 'kind']);
    assert.equal(text, '文件\t行\t列\t类别\nPresentationHumanoid.cs\t213\t27\t类型参数');
});

test('代码列：去缩进，过长前缀截断，匹配段准确', () =>
{
    const code = '        if (!frame.TryGet<HumanoidMotion>(entity, out var motion))';
    const start = code.indexOf('HumanoidMotion');
    const segments = VM.codeSegments(code, start, start + 14);
    assert.equal(segments.prefix, 'if (!frame.TryGet<');
    assert.equal(segments.match, 'HumanoidMotion');
    assert.equal(segments.suffix, '>(entity, out var motion))');
    const long = 'x'.repeat(300) + 'Hit' + 'y';
    const cut = VM.codeSegments(long, 300, 303, 40);
    assert.ok(cut.prefix.startsWith('…'));
    assert.equal(cut.match, 'Hit');
});

test('标题沿用 VS 格式', () =>
{
    assert.equal(VM.resultTitle(result, 'solution'), '"HumanoidMotion"引用 - 整个解决方案');
    assert.equal(VM.resultTitle(result, 'open'), '"HumanoidMotion"引用 - 打开的文档');
});

test('切换到英文：标题、列名、类别、特殊项目名、空白都跟着变', () =>
{
    VM.setLocale('en');
    try
    {
        assert.equal(VM.resultTitle(result, 'solution'), "'HumanoidMotion' references - Entire Solution");
        assert.equal(VM.COLUMNS.find((c: any) => c.id === 'member').title, 'Containing Member');
        assert.equal(VM.GROUPINGS[0].title, 'Project then Definition');
        assert.equal(VM.formatCopy([items[0]], ['file', 'kind']), 'File\tKind\nPresentationHumanoid.cs\tType Argument');
        assert.equal(VM.distinctValues(items, 'member')[0].value, '(Blank)');
        const misc = item({ project: I18N.PROJECT_MISCELLANEOUS });
        assert.equal(VM.columnText(misc, 'project'), 'Miscellaneous Files');
        assert.equal(VM.buildRows([misc], { groupBy: 'project-definition', listView: false, result, collapsed: [] })[0].label, 'Miscellaneous Files');
        assert.equal(VM.filterItems(items, { scope: 'solution', filters: { kind: ['Qualified'] }, search: '' }).length, 1);
    }
    finally
    {
        VM.setLocale('zh-cn');
    }
    assert.equal(VM.columnText(item({ project: I18N.PROJECT_EXTERNAL }), 'project'), '外部文件');
});

test('语言设置：auto 跟随 VS Code 显示语言，手动选择优先', () =>
{
    assert.equal(I18N.resolveLocale('auto', 'zh-cn'), 'zh-cn');
    assert.equal(I18N.resolveLocale('auto', 'zh-tw'), 'zh-cn');
    assert.equal(I18N.resolveLocale('auto', 'en'), 'en');
    assert.equal(I18N.resolveLocale('auto', 'ja'), 'en');
    assert.equal(I18N.resolveLocale(undefined, 'zh-cn'), 'zh-cn');
    assert.equal(I18N.resolveLocale('en', 'zh-cn'), 'en');
    assert.equal(I18N.resolveLocale('zh-cn', 'en'), 'zh-cn');
});

test('中英文字符串表键一致', () =>
{
    assert.deepEqual(Object.keys(I18N.TABLES.en).sort(), Object.keys(I18N.TABLES['zh-cn']).sort());
});
