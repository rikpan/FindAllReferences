// 「在文件中查找」的纯函数：查找条件、行内匹配、glob、ripgrep 参数与输出解析。

import * as assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
    buildMatcher, byteToColumn, clampLine, defaultFindOptions, enabledExcludes, FindOptions, globVariants, matchLine, normalizeFindOptions,
    parseRipgrepLine, ripgrepArgs, searchText, splitGlobs,
} from '../src/core/search';

const options = (fields: Partial<FindOptions>): FindOptions => ({ ...defaultFindOptions, ...fields });

test('查找条件：不合法的值回退到默认', () =>
{
    assert.deepEqual(normalizeFindOptions(null), defaultFindOptions);
    const normalized = normalizeFindOptions({ query: 'Foo', matchCase: true, lookIn: 'nowhere', include: ' *.cs ', useExcludeSettings: false });
    assert.equal(normalized.lookIn, 'workspace');
    assert.equal(normalized.include, '*.cs');
    assert.equal(normalized.matchCase, true);
    assert.equal(normalized.useExcludeSettings, false);
});

test('行内匹配：普通文本转义、区分大小写、全字匹配、正则', () =>
{
    const line = 'HumanoidMotion.Config = new HumanoidMotionConfig(humanoidmotion);';
    assert.deepEqual(matchLine(buildMatcher(options({ query: 'HumanoidMotion' })), line), [[0, 14], [28, 42], [49, 63]]);
    assert.deepEqual(matchLine(buildMatcher(options({ query: 'HumanoidMotion', matchCase: true })), line), [[0, 14], [28, 42]]);
    assert.deepEqual(matchLine(buildMatcher(options({ query: 'HumanoidMotion', wholeWord: true, matchCase: true })), line), [[0, 14]]);
    assert.deepEqual(matchLine(buildMatcher(options({ query: 'Config(' })), line), [[42, 49]]);
    assert.deepEqual(matchLine(buildMatcher(options({ query: 'Motion\\w+', regex: true, matchCase: true })), line), [[36, 48]]);
    assert.throws(() => buildMatcher(options({ query: '(', regex: true })), SyntaxError);
});

test('行内匹配：空匹配不会死循环', () =>
{
    assert.deepEqual(matchLine(buildMatcher(options({ query: 'x*', regex: true })), 'axxb'), [[1, 3]]);
});

test('整段查找：按行号返回，兼容 CRLF', () =>
{
    const found = searchText('one\r\nfoo bar foo\r\nthree\nfoo', buildMatcher(options({ query: 'foo' })));
    assert.deepEqual(found.map(match => [match.line, match.ranges.length]), [[1, 2], [3, 1]]);
    assert.equal(found[0].text, 'foo bar foo');
});

test('glob：逗号拆分（花括号内不拆）、补 **/ 前缀与文件夹变体', () =>
{
    assert.deepEqual(splitGlobs('*.cs, *.{shader,hlsl} ,, Assets\\Scripts'), ['*.cs', '*.{shader,hlsl}', 'Assets\\Scripts']);
    assert.deepEqual(globVariants('*.cs'), ['**/*.cs', '**/*.cs/**']);
    assert.deepEqual(globVariants('Assets\\Scripts\\'), ['**/Assets/Scripts', '**/Assets/Scripts/**']);
    assert.deepEqual(globVariants('./Library'), ['Library', 'Library/**']);
    assert.deepEqual(globVariants('**/node_modules/**'), ['**/node_modules/**']);
});

test('排除设置：只取值为 true 的模式并去重', () =>
{
    assert.deepEqual(
        enabledExcludes({ '**/.git': true, '**/*.meta': false, '**/*.js': { when: '$(basename).ts' } }, { '**/.git': true, '**/Library': true }),
        ['**/.git', '**/Library']);
});

test('ripgrep 参数：大小写、全字、固定字符串、忽略文件、包含与排除', () =>
{
    const args = ripgrepArgs(options({ query: '-foo', wholeWord: true }), { includes: ['*.cs'], excludes: ['Library'], useIgnoreFiles: false, followSymlinks: true });
    assert.ok(args.includes('--ignore-case'));
    assert.ok(args.includes('--word-regexp'));
    assert.ok(args.includes('--fixed-strings'));
    assert.ok(args.includes('--no-ignore'));
    assert.ok(args.includes('--follow'));
    assert.deepEqual(args.slice(-4), ['--regexp', '-foo', '--', '.'], '以 - 开头的查找内容不会被当成选项');
    assert.equal(args[args.indexOf('**/*.cs') - 1], '-g');
    assert.ok(args.includes('!**/Library/**'));
    const regex = ripgrepArgs(options({ query: 'a+', regex: true, matchCase: true }), { includes: [], excludes: [], useIgnoreFiles: true, followSymlinks: false });
    assert.ok(regex.includes('--case-sensitive'));
    assert.ok(!regex.includes('--fixed-strings'));
    assert.ok(regex.includes('--no-ignore-parent'));
});

test('ripgrep 输出：字节偏移换算成 UTF-16 列，去掉行尾换行，行号转 0 起', () =>
{
    const text = '\t// 人体 KCC：HumanoidMotion 模板 😀 HumanoidMotion\r\n';
    const prefix = '\t// 人体 KCC：';
    const start = Buffer.byteLength(prefix);
    const secondStart = Buffer.byteLength('\t// 人体 KCC：HumanoidMotion 模板 😀 ');
    const line = JSON.stringify({
        type: 'match',
        data: {
            path: { text: 'Assets\\Editor\\Catalog.cs' },
            lines: { text },
            line_number: 11,
            submatches: [{ start, end: start + 14 }, { start: secondStart, end: secondStart + 14 }],
        },
    });
    const event = parseRipgrepLine(line);
    assert.ok(event && event.type === 'match');
    assert.equal(event.path, 'Assets\\Editor\\Catalog.cs');
    assert.equal(event.match.line, 10);
    assert.equal(event.match.text, text.replace(/\r\n$/, ''));
    const [first, second] = event.match.ranges;
    assert.equal(event.match.text.slice(first[0], first[1]), 'HumanoidMotion');
    assert.equal(event.match.text.slice(second[0], second[1]), 'HumanoidMotion');
    assert.deepEqual(parseRipgrepLine('{"type":"summary","data":{"stats":{"searches":567}}}'), { type: 'summary', searched: 567 });
    assert.equal(parseRipgrepLine('{"type":"begin","data":{}}'), undefined);
    assert.equal(parseRipgrepLine('not json'), undefined);
    assert.equal(byteToColumn('abc', 2), 2);
});

test('很长的行只保留前一段', () =>
{
    const clamped = clampLine({ line: 0, text: 'x'.repeat(5000), ranges: [[10, 12], [4000, 4002]] }, 100);
    assert.equal(clamped.text.length, 100);
    assert.deepEqual(clamped.ranges, [[10, 12]]);
});

/** 本机有 ripgrep 时（PATH 里或 RG_PATH 指定）跑一次真实搜索，确认参数与解析配得上。 */
function systemRipgrep(): string | undefined
{
    const candidate = process.env.RG_PATH || 'rg';
    const probe = childProcess.spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    return probe.status === 0 ? candidate : undefined;
}

test('真实 ripgrep：中文行、多处匹配、包含／排除、汇总文件数', { skip: !systemRipgrep() && '本机没有 ripgrep' }, () =>
{
    const rg = systemRipgrep()!;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-in-files-'));
    fs.mkdirSync(path.join(root, 'Assets', 'Editor'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Library'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Assets', 'Editor', 'Arena.cs'), 'var a = HumanoidMotion.X;\n// 人体 HumanoidMotion 和 humanoidmotion\n');
    fs.writeFileSync(path.join(root, 'Assets', 'readme.txt'), 'HumanoidMotion\n');
    fs.writeFileSync(path.join(root, 'Library', 'Cache.cs'), 'HumanoidMotion\n');
    try
    {
        const args = ripgrepArgs(options({ query: 'HumanoidMotion' }), { includes: ['*.cs'], excludes: ['Library'], useIgnoreFiles: true, followSymlinks: true });
        const output = childProcess.spawnSync(rg, args, { cwd: root, encoding: 'utf8' });
        assert.equal(output.status, 0, output.stderr);
        const events = output.stdout.split('\n').map(parseRipgrepLine).filter(event => event !== undefined);
        const matches = events.filter(event => event!.type === 'match') as Extract<NonNullable<ReturnType<typeof parseRipgrepLine>>, { type: 'match' }>[];
        assert.deepEqual(matches.map(event => [event.path.replace(/\\/g, '/'), event.match.line]), [['./Assets/Editor/Arena.cs', 0], ['./Assets/Editor/Arena.cs', 1]]);
        const chinese = matches[1].match;
        assert.deepEqual(chinese.ranges.map(range => chinese.text.slice(range[0], range[1])), ['HumanoidMotion', 'humanoidmotion']);
        const summary = events.find(event => event!.type === 'summary');
        assert.deepEqual(summary, { type: 'summary', searched: 1 });
    }
    finally
    {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
