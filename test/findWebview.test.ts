// 「查找结果」窗口冒烟：在 jsdom 里跑 findPanel.js + main.js，按消息协议驱动。

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { findBodyMarkup } from '../src/webviewMarkup';

const media = path.join(__dirname, '..', '..', 'media');

function boot()
{
    const dom = new JSDOM(`<!DOCTYPE html><html><body data-view="find">${findBodyMarkup}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window as any;
    const posted: any[] = [];
    window.acquireVsCodeApi = () => ({ postMessage: (message: unknown) => posted.push(JSON.parse(JSON.stringify(message))) });
    window.ResizeObserver = class
    {
        observe(): void
        {
        }
    };
    for (const name of ['i18n.js', 'listModel.js', 'findViewModel.js', 'findPanel.js', 'main.js'])
        window.eval(fs.readFileSync(path.join(media, name), 'utf8'));
    const document = window.document as Document;
    const send = (data: unknown) => window.dispatchEvent(new window.MessageEvent('message', { data }));
    const key = (element: Element, init: Record<string, unknown>) =>
        element.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }));
    const last = (type: string) => [...posted].reverse().find(message => message.type === type);
    const byId = (id: string) => document.getElementById(id) as HTMLElement;
    const groupLabels = () => [...document.querySelectorAll('tr.group .group-label')].map(element => element.textContent);
    const itemRows = () => [...document.querySelectorAll('tr.item')];
    return { window, document, posted, send, key, last, byId, groupLabels, itemRows };
}

let nextId = 1;
const root = '/home/dev/Game/Client/U3DProject';

/** 代码行里每处 HumanoidMotion 都是一处匹配。 */
function matchesIn(code: string): number[][]
{
    const matches: number[][] = [];
    for (let index = code.indexOf('HumanoidMotion'); index >= 0; index = code.indexOf('HumanoidMotion', index + 1))
        matches.push([index, index + 'HumanoidMotion'.length]);
    return matches;
}

function item(relativePath: string, line: number, code: string, project = 'Assembly-CSharp-Editor')
{
    const matches = matchesIn(code);
    const parts = relativePath.split('/');
    return {
        id: nextId++,
        uri: `file:///home/dev/Game/Client/U3DProject/${relativePath}`,
        fileKey: relativePath,
        fileName: parts[parts.length - 1],
        relativePath,
        root,
        dirs: parts.slice(0, -1),
        line,
        column: matches[0][0],
        endColumn: matches[0][1],
        matches,
        code,
        project,
    };
}

const options = { query: 'HumanoidMotion', matchCase: true, wholeWord: false, regex: false, lookIn: 'workspace', include: '*.cs', exclude: '', useExcludeSettings: true };

function result(id: number)
{
    return {
        id,
        symbol: 'HumanoidMotion',
        kept: false,
        options,
        originFileKey: 'Assets/Editor/AgentCommands/ArenaMotionBuilder.cs',
        originProject: 'Assembly-CSharp-Editor',
        summary: { searched: 567, truncated: false, stopped: false },
        items: [
            item('Assets/Editor/AgentCommands/ArenaMotionBuilder.cs', 14, '        public const string KccPath = ArtifactPaths.HumanoidMotionKccConfig;'),
            item('Assets/Editor/ArtifactPaths.cs', 10,
                '        public const string HumanoidMotionKccConfig = "Assets/QuantumUser/Resources/Configs/HumanoidMotionKCC.asset";'),
            item('Assets/Editor/AgentCommands/ArenaSceneBuilder.cs', 26,
                '        public const string MotionConfigPath = "Assets/QuantumUser/Resources/Configs/HumanoidMotion.asset";'),
        ],
    };
}

const context = { activeFileKey: '', activeProject: '', openFileKeys: [], changedFileKeys: [] };

function loaded()
{
    const env = boot();
    env.send({ type: 'init', settings: null, results: [], activeId: undefined, loading: null, context });
    env.send({ type: 'result', result: result(1) });
    return env;
}

test('启动：发 ready，空窗口提示 Ctrl+Shift+F，表单、描述行、统计栏都隐藏', () =>
{
    const env = boot();
    assert.equal(env.posted[0].type, 'ready');
    assert.match(env.byId('empty').textContent!, /Ctrl\+Shift\+F/);
    assert.ok(env.byId('findForm').classList.contains('hidden'));
    assert.ok(env.byId('description').classList.contains('hidden'));
    assert.ok(env.byId('footer').classList.contains('hidden'));
    assert.equal((env.byId('search') as HTMLInputElement).placeholder, '搜索查找结果');
    assert.equal((env.byId('scope') as HTMLSelectElement).selectedOptions[0].textContent, '所有文件');
});

test('结果：按路径逐级分组到文件，同一行多处匹配都高亮，标题、描述行、统计栏仿 VS', () =>
{
    const env = loaded();
    assert.deepEqual(env.groupLabels(), [root, 'Assets', 'Editor', 'AgentCommands', 'ArenaMotionBuilder.cs', 'ArenaSceneBuilder.cs', 'ArtifactPaths.cs']);
    assert.deepEqual([...env.document.querySelectorAll('tr.group .group-count')].map(e => e.textContent), ['(3)', '(3)', '(3)', '(2)', '(1)', '(1)', '(1)']);
    const headers = [...env.document.querySelectorAll('th .th-title')].map(e => e.textContent);
    assert.deepEqual(headers, ['代码', '文件', '行', '列', '项目']);
    const artifact = env.itemRows()[2];
    assert.deepEqual([...artifact.querySelectorAll('.match')].map(e => e.textContent), ['HumanoidMotion', 'HumanoidMotion']);
    assert.equal(artifact.querySelector('td.c-line')!.textContent, '11');
    assert.equal(artifact.querySelector('td.c-column')!.textContent, '29');
    assert.equal(env.last('title').title, '查找"HumanoidMotion"');
    assert.equal(env.byId('descriptionText').textContent, '全部查找"HumanoidMotion"，区分大小写，整个工作区，包含"*.cs"，');
    assert.equal(env.byId('footerText').textContent, '匹配行: 3  匹配文件: 3  搜索的文件总数: 567');
});

test('分组依据「仅文件」与「项目，然后是文件」', () =>
{
    const env = loaded();
    const groupBy = env.byId('groupBy') as HTMLSelectElement;
    groupBy.value = 'file';
    groupBy.dispatchEvent(new env.window.Event('change'));
    assert.deepEqual(env.groupLabels(), [
        'Assets/Editor/AgentCommands/ArenaMotionBuilder.cs',
        'Assets/Editor/AgentCommands/ArenaSceneBuilder.cs',
        'Assets/Editor/ArtifactPaths.cs',
    ]);
    groupBy.value = 'project-file';
    groupBy.dispatchEvent(new env.window.Event('change'));
    assert.equal(env.groupLabels()[0], 'Assembly-CSharp-Editor');
});

test('Ctrl+Shift+F：显示表单并填入选中文本；Alt+C／W／R 切换选项；Enter 查找后收起表单', () =>
{
    const env = boot();
    env.send({ type: 'init', settings: null, results: [], activeId: undefined, loading: null, context });
    env.send({ type: 'showFind', seed: 'HumanoidMotion', options: { ...options, matchCase: false, include: '' }, history: [] });
    const query = env.byId('findQuery') as HTMLInputElement;
    assert.ok(!env.byId('findForm').classList.contains('hidden'));
    assert.equal(query.value, 'HumanoidMotion');
    assert.equal(env.document.activeElement, query);
    env.key(query, { key: 'ç', code: 'KeyC', altKey: true });
    env.key(query, { key: 'w', code: 'KeyW', altKey: true });
    env.key(query, { key: 'r', code: 'KeyR', altKey: true });
    env.key(query, { key: 'r', code: 'KeyR', altKey: true });
    assert.ok(env.byId('optCase').classList.contains('checked'));
    (env.byId('findInclude') as HTMLInputElement).value = ' *.cs ';
    (env.byId('findForm') as HTMLFormElement).requestSubmit();
    const find = env.last('find');
    assert.deepEqual(find.options, { ...options, matchCase: true, wholeWord: true, regex: false, include: '*.cs' });
    assert.equal(find.targetId, undefined);
    assert.ok(env.byId('findForm').classList.contains('hidden'));
});

test('空查找内容不发送', () =>
{
    const env = boot();
    env.send({ type: 'showFind', seed: '', options, history: [] });
    (env.byId('findQuery') as HTMLInputElement).value = '';
    (env.byId('findForm') as HTMLFormElement).requestSubmit();
    assert.equal(env.last('find'), undefined);
});

test('修改查找 (Alt+M)：带出当前页签的条件，查找替换该页签；刷新按相同条件重查', () =>
{
    const env = loaded();
    env.key(env.byId('scroller'), { key: 'µ', code: 'KeyM', altKey: true });
    assert.ok(!env.byId('findForm').classList.contains('hidden'));
    assert.equal((env.byId('findQuery') as HTMLInputElement).value, 'HumanoidMotion');
    assert.equal((env.byId('findInclude') as HTMLInputElement).value, '*.cs');
    assert.ok(env.byId('modify').classList.contains('checked'));
    (env.byId('findQuery') as HTMLInputElement).value = 'MotionConfig';
    (env.byId('findForm') as HTMLFormElement).requestSubmit();
    assert.equal(env.last('find').targetId, 1);
    assert.equal(env.last('find').options.query, 'MotionConfig');

    env.byId('refresh').click();
    assert.deepEqual(env.last('find'), { type: 'find', options, targetId: 1 });
});

test('Esc 收起表单；查找出错时重新显示表单并给出错误', () =>
{
    const env = loaded();
    env.send({ type: 'showFind', seed: 'x', options, history: [] });
    env.key(env.byId('findQuery'), { key: 'Escape' });
    assert.ok(env.byId('findForm').classList.contains('hidden'));
    env.send({ type: 'findError', text: '正则表达式无效：unclosed group', options: { ...options, query: '(', regex: true } });
    assert.ok(!env.byId('findForm').classList.contains('hidden'));
    assert.equal(env.byId('findError').textContent, '正则表达式无效：unclosed group');
    assert.ok(env.byId('optRegex').classList.contains('checked'));
});

test('查找框上下键浏览历史', () =>
{
    const env = boot();
    env.send({ type: 'showFind', seed: 'new', options, history: ['second', 'first'] });
    const query = env.byId('findQuery') as HTMLInputElement;
    env.key(query, { key: 'ArrowUp' });
    assert.equal(query.value, 'second');
    env.key(query, { key: 'ArrowUp' });
    assert.equal(query.value, 'first');
    env.key(query, { key: 'ArrowDown' });
    env.key(query, { key: 'ArrowDown' });
    assert.equal(query.value, 'new');
});

test('查找中可以停止；停止的结果在统计栏提示不完整', () =>
{
    const env = loaded();
    assert.ok((env.byId('stop') as HTMLButtonElement).disabled);
    env.send({ type: 'loading', text: '正在查找"X"… 已找到 12 行' });
    assert.ok(!(env.byId('stop') as HTMLButtonElement).disabled);
    assert.ok((env.byId('refresh') as HTMLButtonElement).disabled);
    env.byId('stop').click();
    assert.deepEqual(env.last('stop'), { type: 'stop' });
    const stopped = result(2);
    stopped.summary = { searched: 10, truncated: false, stopped: true };
    env.send({ type: 'loading', text: null });
    env.send({ type: 'result', result: stopped });
    assert.equal(env.byId('footerNotice').textContent, '查找已停止，结果不完整。');
});

test('F4 导航打开第一处匹配并选中匹配文本', () =>
{
    const env = loaded();
    env.send({ type: 'navigate', delta: 1 });
    assert.deepEqual(
        { line: env.last('open').line, column: env.last('open').column, endColumn: env.last('open').endColumn },
        { line: 14, column: 52, endColumn: 66 });
});

test('切换到英文：工具栏、范围、描述行跟着变', () =>
{
    const env = loaded();
    env.send({ type: 'locale', locale: 'en' });
    assert.equal(env.byId('modify').textContent, 'Modify Find (M)');
    assert.equal((env.byId('scope') as HTMLSelectElement).selectedOptions[0].textContent, 'All Files');
    assert.equal((env.byId('findLookIn') as HTMLSelectElement).options[0].textContent, 'Entire Workspace');
    assert.equal(env.byId('descriptionText').textContent, 'Find all "HumanoidMotion", Match case, Entire Workspace, include "*.cs", ');
    assert.equal(env.last('title').title, 'Find "HumanoidMotion"');
});
