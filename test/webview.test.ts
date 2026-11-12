// Webview 冒烟：在 jsdom 里跑 main.js，按消息协议驱动，检查渲染与发回扩展的消息。

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { bodyMarkup } from '../src/webviewMarkup';

const media = path.join(__dirname, '..', '..', 'media');

function boot()
{
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyMarkup}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window as any;
    const posted: any[] = [];
    window.acquireVsCodeApi = () => ({ postMessage: (message: unknown) => posted.push(JSON.parse(JSON.stringify(message))) });
    window.ResizeObserver = class
    {
        observe(): void
        {
        }
    };
    window.eval(fs.readFileSync(path.join(media, 'i18n.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(media, 'viewModel.js'), 'utf8'));
    window.eval(fs.readFileSync(path.join(media, 'main.js'), 'utf8'));
    const document = window.document as Document;
    const send = (data: unknown) => window.dispatchEvent(new window.MessageEvent('message', { data }));
    const mouse = (element: Element, type: string, init: Record<string, unknown> = {}) =>
        element.dispatchEvent(new window.MouseEvent(type, { bubbles: true, button: 0, detail: 1, ...init }));
    const key = (element: Element, keyName: string, init: Record<string, unknown> = {}) =>
        element.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: keyName, ...init }));
    const last = (type: string) => [...posted].reverse().find(message => message.type === type);
    const groupLabels = () => [...document.querySelectorAll('tr.group .group-label')].map(element => element.textContent);
    const itemRows = () => [...document.querySelectorAll('tr.item')];
    return { window, document, posted, send, mouse, key, last, groupLabels, itemRows };
}

let nextId = 1;

function item(relativePath: string, line: number, column: number, project: string, kind: string, code: string)
{
    return {
        id: nextId++,
        uri: `file:///work/${relativePath}`,
        fileKey: relativePath,
        fileName: relativePath.split('/').pop(),
        relativePath,
        line,
        column,
        endColumn: column + 'HumanoidMotion'.length,
        code,
        project,
        member: 'UpdateAnimation',
        type: 'PresentationHumanoid',
        kind,
        repository: 'repo',
        isDefinition: kind === 'definition',
    };
}

function result(id: number)
{
    return {
        id,
        symbol: 'HumanoidMotion',
        kept: false,
        definition: { label: 'struct HumanoidMotion', icon: 'symbol-struct' },
        originFileKey: 'View/PresentationHumanoid.cs',
        originProject: 'Assembly-CSharp',
        items: [
            item('View/ArenaHumanoidBinding.cs', 72, 48, 'Assembly-CSharp', 'typeArgument', '        var entities = frame.Filter<PlayerLink, HumanoidMotion>();'),
            item('View/PresentationHumanoid.cs', 212, 26, 'Assembly-CSharp', 'typeArgument', '        if (!frame.TryGet<HumanoidMotion>(entity, out var motion))'),
            item('View/PresentationHumanoid.cs', 218, 21, 'Assembly-CSharp', 'qualified', '        var config = HumanoidMotion.ConfigOf(frame, entity);'),
            item('Editor/HumanoidTests.cs', 422, 21, 'Assembly-CSharp-Editor', 'qualified', '        var config = HumanoidMotion.ConfigOf(session.Frame, entity);'),
        ],
    };
}

const context = { activeFileKey: 'View/PresentationHumanoid.cs', activeProject: 'Assembly-CSharp', openFileKeys: [], changedFileKeys: [] };

function loaded()
{
    const env = boot();
    env.send({ type: 'init', settings: null, results: [], activeId: undefined, loading: null, context });
    env.send({ type: 'result', result: result(1) });
    return env;
}

test('启动发 ready，无结果时显示提示', () =>
{
    const env = boot();
    assert.equal(env.posted[0].type, 'ready');
    assert.match(env.document.getElementById('empty')!.textContent!, /Shift\+F12/);
});

test('收到结果后按项目、定义分组渲染，标题沿用 VS 格式', () =>
{
    const env = loaded();
    assert.deepEqual(env.groupLabels(), ['Assembly-CSharp', 'struct HumanoidMotion', 'Assembly-CSharp-Editor', 'struct HumanoidMotion']);
    assert.deepEqual([...env.document.querySelectorAll('tr.group .group-count')].map(e => e.textContent), ['(3)', '(3)', '(1)', '(1)']);
    assert.equal(env.itemRows().length, 4);
    const firstCode = env.itemRows()[0].querySelector('.code')!;
    assert.equal(firstCode.textContent, 'var entities = frame.Filter<PlayerLink, HumanoidMotion>();');
    assert.equal(firstCode.querySelector('.match')!.textContent, 'HumanoidMotion');
    const headers = [...env.document.querySelectorAll('th .th-title')].map(e => e.textContent);
    assert.deepEqual(headers, ['代码', '文件', '行', '列', '项目', '包含成员', '包含类型', '类别', '存储库']);
    assert.equal(env.last('title').title, '"HumanoidMotion"引用 - 整个解决方案');
    const lineCell = env.itemRows()[1].querySelector('td.c-line')!;
    assert.equal(lineCell.textContent, '213');
});

test('单击预览、双击打开、Enter 打开、方向键移动并预览', () =>
{
    const env = loaded();
    env.mouse(env.itemRows()[0], 'mousedown');
    assert.deepEqual(
        { line: env.last('open').line, preserveFocus: env.last('open').preserveFocus, preview: env.last('open').preview },
        { line: 72, preserveFocus: true, preview: true });
    assert.ok(env.itemRows()[0].classList.contains('selected'));
    env.mouse(env.itemRows()[0], 'dblclick');
    assert.equal(env.last('open').preserveFocus, false);
    const scroller = env.document.getElementById('scroller')!;
    env.key(scroller, 'ArrowDown');
    assert.equal(env.last('open').line, 212);
    env.key(scroller, 'Enter');
    assert.equal(env.last('open').preview, false);
});

test('折叠分组、全部折叠、全部展开', () =>
{
    const env = loaded();
    env.mouse(env.document.querySelector('tr.group [data-twistie]')!, 'mousedown');
    assert.deepEqual(env.groupLabels(), ['Assembly-CSharp', 'Assembly-CSharp-Editor', 'struct HumanoidMotion']);
    (env.document.getElementById('collapse') as HTMLElement).click();
    assert.deepEqual(env.groupLabels(), ['Assembly-CSharp', 'Assembly-CSharp-Editor']);
    (env.document.getElementById('expand') as HTMLElement).click();
    assert.equal(env.itemRows().length, 4);
});

test('列表视图与分组依据切换，设置发回扩展保存', () =>
{
    const env = loaded();
    (env.document.getElementById('listView') as HTMLElement).click();
    assert.equal(env.groupLabels().length, 0);
    assert.equal(env.itemRows().length, 4);
    assert.equal(env.last('settings').settings.listView, true);
    (env.document.getElementById('listView') as HTMLElement).click();
    const groupBy = env.document.getElementById('groupBy') as HTMLSelectElement;
    groupBy.value = 'definition';
    groupBy.dispatchEvent(new env.window.Event('change'));
    assert.deepEqual(env.groupLabels(), ['struct HumanoidMotion']);
});

test('范围切到当前文档：只剩活动文件，状态栏显示筛选计数', () =>
{
    const env = loaded();
    const scope = env.document.getElementById('scope') as HTMLSelectElement;
    scope.value = 'document';
    scope.dispatchEvent(new env.window.Event('change'));
    assert.equal(env.itemRows().length, 2);
    assert.match(env.document.getElementById('status')!.textContent!, /显示 2 项，共 4 项/);
    assert.equal(env.last('title').title, '"HumanoidMotion"引用 - 当前文档');
});

test('列筛选弹框：取消勾选后过滤，清除所有筛选器复原', () =>
{
    const env = loaded();
    env.document.querySelector('[data-filter="kind"]')!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    const popup = env.document.getElementById('popup')!;
    assert.ok(!popup.classList.contains('hidden'));
    const values = [...popup.querySelectorAll('.popup-value')].map(e => e.textContent);
    assert.deepEqual(values.sort(), ['合格', '类型参数'].sort());
    const qualified = [...popup.querySelectorAll('input[data-index]')]
        .find(box => box.parentElement!.querySelector('.popup-value')!.textContent === '合格') as HTMLInputElement;
    qualified.checked = false;
    (popup.querySelector('[data-ok]') as HTMLElement).click();
    assert.equal(env.itemRows().length, 2);
    assert.ok(env.document.querySelector('[data-filter="kind"]')!.classList.contains('active'));
    (env.document.getElementById('clearFilters') as HTMLElement).click();
    assert.equal(env.itemRows().length, 4);
});

test('搜索框过滤（带防抖）', async () =>
{
    const env = loaded();
    const search = env.document.getElementById('search') as HTMLInputElement;
    search.value = 'Editor';
    search.dispatchEvent(new env.window.Event('input'));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(env.itemRows().length, 1);
});

test('复制：选中分组即复制其下条目，未选中复制全部', () =>
{
    const env = loaded();
    (env.document.getElementById('copy') as HTMLElement).click();
    assert.equal(env.last('copy').text.split('\n').length, 5);
    env.mouse(env.document.querySelectorAll('tr.group')[2], 'mousedown');
    env.key(env.document.getElementById('scroller')!, 'c', { ctrlKey: true });
    const lines = env.last('copy').text.split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /HumanoidTests\.cs\t423\t22\tAssembly-CSharp-Editor/);
});

test('保留结果后新结果开新页签；关闭页签通知扩展', () =>
{
    const env = loaded();
    (env.document.getElementById('keep') as HTMLElement).click();
    assert.deepEqual(env.last('keep'), { type: 'keep', id: 1, kept: true });
    env.send({ type: 'result', result: result(2) });
    const tabs = env.document.querySelectorAll('#tabs .tab');
    assert.equal(tabs.length, 2);
    assert.ok(tabs[1].classList.contains('active'));
    assert.ok(tabs[0].querySelector('.tab-lock'));
    env.mouse(tabs[1].querySelector('[data-close]')!, 'mousedown');
    assert.deepEqual(env.last('close'), { type: 'close', id: 2 });
    assert.ok(env.document.getElementById('tabs')!.classList.contains('hidden'));
});

test('F4 导航：走遍条目并展开折叠组，打开时把焦点交给编辑器', () =>
{
    const env = loaded();
    (env.document.getElementById('collapse') as HTMLElement).click();
    env.send({ type: 'navigate', delta: 1 });
    assert.equal(env.last('open').line, 72);
    assert.equal(env.last('open').preserveFocus, false);
    assert.equal(env.itemRows().length, 3, '第一组被展开');
    env.send({ type: 'navigate', delta: -1 });
    assert.equal(env.last('open').line, 422, '从第一条往前绕到最后一条');
});

test('排序：点击表头升序、再点降序、第三次恢复', () =>
{
    const env = loaded();
    (env.document.getElementById('listView') as HTMLElement).click();
    const lineHeader = () => env.document.querySelector('th[data-col="line"]')!;
    const lines = () => env.itemRows().map(row => row.querySelector('td.c-line')!.textContent);
    lineHeader().dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(lines(), ['73', '213', '219', '423']);
    lineHeader().dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(lines(), ['423', '219', '213', '73']);
    assert.ok(lineHeader().querySelector('.codicon-arrow-down'));
    lineHeader().dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    assert.equal(lineHeader().querySelector('.sort'), null);
});

test('表头右键隐藏列', () =>
{
    const env = loaded();
    env.document.getElementById('header')!.dispatchEvent(new env.window.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const entry = [...env.document.querySelectorAll('#menu .menu-item')].find(e => e.querySelector('.menu-label')!.textContent === '存储库')!;
    env.mouse(entry, 'mousedown');
    const headers = [...env.document.querySelectorAll('th .th-title')].map(e => e.textContent);
    assert.ok(!headers.includes('存储库'));
    assert.equal(env.last('settings').settings.columns.repository.visible, false);
});

test('语言：启动时按 data-locale，收到 locale 消息即时切换，已勾选的列筛选随之换成新语言', () =>
{
    const env = loaded();
    assert.equal(env.document.getElementById('keep')!.textContent, '保留结果(K)');
    env.document.querySelector('[data-filter="kind"]')!.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    const box = [...env.document.querySelectorAll('#popup input[data-index]')]
        .find(element => element.parentElement!.querySelector('.popup-value')!.textContent === '合格') as HTMLInputElement;
    box.click();
    (env.document.querySelector('#popup [data-ok]') as HTMLElement).click();
    assert.equal(env.itemRows().length, 2);

    env.send({ type: 'locale', locale: 'en' });
    const headers = [...env.document.querySelectorAll('th .th-title')].map(e => e.textContent);
    assert.deepEqual(headers, ['Code', 'File', 'Line', 'Column', 'Project', 'Containing Member', 'Containing Type', 'Kind', 'Repository']);
    assert.equal(env.document.getElementById('keep')!.textContent, 'Keep Results (K)');
    assert.equal(env.document.getElementById('search')!.getAttribute('placeholder'), 'Search Find All References');
    assert.equal((env.document.getElementById('scope') as HTMLSelectElement).selectedOptions[0].textContent, 'Entire Solution');
    assert.equal(env.last('title').title, "'HumanoidMotion' references - Entire Solution");
    assert.equal(env.itemRows().length, 2, '筛选在切换语言后仍然生效');
    assert.deepEqual(env.itemRows().map(row => row.querySelector('td.c-kind')!.textContent), ['Type Argument', 'Type Argument']);
    assert.match(env.document.getElementById('status')!.textContent!, /Showing 2 of 4 items/);
    assert.equal(env.document.documentElement.lang, 'en');
});

test('语言：init 消息带 locale 时直接用英文渲染', () =>
{
    const env = boot();
    env.send({ type: 'init', locale: 'en', settings: null, results: [], activeId: undefined, loading: null, context });
    assert.match(env.document.getElementById('empty')!.textContent!, /Put the cursor on a symbol/);
    assert.equal(env.document.querySelector('label[for="groupBy"]')!.textContent, 'Group by:');
});
