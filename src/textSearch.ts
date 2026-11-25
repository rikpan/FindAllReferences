// 「在文件中查找」的执行：优先用 VS Code 自带的 ripgrep，找不到时退回逐文件读取；
// 未保存的文档按编辑器里的内容查找，与 VS Code 搜索视图一致。

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as vscode from 'vscode';
import {
    buildMatcher, clampLine, enabledExcludes, FindOptions, globVariants, parseRipgrepLine, ripgrepArgs, searchText, splitGlobs, TextMatch,
} from './core/search';
import { t } from './i18n';
import { fileKeyOf, ProjectResolver } from './resolvers';

export interface FoundItem
{
    uri: string;
    fileKey: string;
    fileName: string;
    relativePath: string;
    /** 分组树的根：所在工作区文件夹的完整路径。 */
    root: string;
    /** 从根到文件所在文件夹的各级目录名。 */
    dirs: string[];
    line: number;
    column: number;
    endColumn: number;
    matches: [number, number][];
    code: string;
    project: string;
}

export interface FindRun
{
    symbol: string;
    options: FindOptions;
    originFileKey: string;
    originProject: string;
    summary: { searched: number; truncated: boolean; stopped: boolean };
    items: FoundItem[];
}

/** 查找条件本身有误（如正则写错），在查找表单里提示。 */
export class FindQueryError extends Error
{
}

const defaultMaxResults = 20000;
const maxFileSize = 10 * 1024 * 1024;
const fallbackConcurrency = 16;

let ripgrepPath: string | null | undefined;

/** VS Code 自带的 ripgrep；不同版本放的位置不同，逐个找。 */
export function findRipgrep(): string | null
{
    if (ripgrepPath !== undefined)
        return ripgrepPath;
    const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const appRoot = vscode.env.appRoot;
    const platformDir = `${process.platform}-${process.arch}`;
    const candidates: string[] = [];
    for (const modules of ['node_modules.asar.unpacked', 'node_modules'])
    {
        candidates.push(
            path.join(appRoot, modules, '@vscode', 'ripgrep', 'bin', exe),
            path.join(appRoot, modules, '@vscode', 'ripgrep-universal', 'bin', platformDir, exe),
            path.join(appRoot, modules, 'vscode-ripgrep', 'bin', exe));
        // 其他命名（如以后改名）：在 @vscode/ripgrep* 的 bin 下再找两层
        const scope = path.join(appRoot, modules, '@vscode');
        try
        {
            for (const name of fs.readdirSync(scope).filter(entry => entry.startsWith('ripgrep')))
            {
                const bin = path.join(scope, name, 'bin');
                candidates.push(path.join(bin, exe), path.join(bin, platformDir, exe));
            }
        }
        catch
        {
            // 目录不存在
        }
    }
    ripgrepPath = candidates.find(candidate => fs.existsSync(candidate)) ?? null;
    return ripgrepPath;
}

interface SearchRoot
{
    folder: vscode.Uri;
    /** 实际搜索的目录（「当前文档所在文件夹」时是子目录）。 */
    directory: string;
}

interface Collector
{
    /** 按绝对路径（归一化键）收集的匹配。 */
    files: Map<string, { uri: vscode.Uri; matches: TextMatch[] }>;
    lines: number;
    limit: number;
    truncated: boolean;
    searched: number;
    onProgress: (lines: number) => void;
}

function addMatches(collector: Collector, uri: vscode.Uri, matches: TextMatch[]): void
{
    if (matches.length === 0)
        return;
    const room = collector.limit - collector.lines;
    if (room <= 0)
    {
        collector.truncated = true;
        return;
    }
    const kept = matches.length > room ? matches.slice(0, room) : matches;
    if (kept.length < matches.length)
        collector.truncated = true;
    const key = fileKeyOf(uri);
    const entry = collector.files.get(key);
    if (entry)
        entry.matches.push(...kept.map(match => clampLine(match)));
    else
        collector.files.set(key, { uri, matches: kept.map(match => clampLine(match)) });
    collector.lines += kept.length;
    collector.onProgress(collector.lines);
}

function excludePatterns(options: FindOptions, folder: vscode.Uri | undefined): string[]
{
    const patterns = splitGlobs(options.exclude);
    if (options.useExcludeSettings)
    {
        patterns.push(...enabledExcludes(
            vscode.workspace.getConfiguration('files', folder).get<Record<string, unknown>>('exclude'),
            vscode.workspace.getConfiguration('search', folder).get<Record<string, unknown>>('exclude')));
    }
    return patterns;
}

/** 在一个目录下跑 ripgrep；取消或结果够数时结束进程，已收到的结果保留。 */
function runRipgrep(
    rg: string,
    root: SearchRoot,
    options: FindOptions,
    collector: Collector,
    token: vscode.CancellationToken): Promise<void>
{
    const search = vscode.workspace.getConfiguration('search', root.folder);
    const args = ripgrepArgs(options, {
        includes: splitGlobs(options.include),
        excludes: excludePatterns(options, root.folder),
        useIgnoreFiles: options.useExcludeSettings && search.get<boolean>('useIgnoreFiles', true),
        followSymlinks: search.get<boolean>('followSymlinks', true),
    });
    return new Promise((resolve, reject) =>
    {
        const child = childProcess.spawn(rg, args, { cwd: root.directory, windowsHide: true });
        let stderr = '';
        let finished = false;
        let killed = false;
        const kill = () =>
        {
            if (!killed)
            {
                killed = true;
                child.kill();
            }
        };
        const cancel = token.onCancellationRequested(kill);
        child.stderr.on('data', chunk => stderr += String(chunk));
        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', line =>
        {
            if (killed)
                return;
            const event = parseRipgrepLine(line);
            if (!event)
                return;
            if (event.type === 'summary')
            {
                collector.searched += event.searched;
                return;
            }
            addMatches(collector, vscode.Uri.file(path.resolve(root.directory, event.path)), [event.match]);
            if (collector.truncated)
                kill();
        });
        let exitCode: number | null | undefined;
        let linesClosed = false;
        const done = (error?: Error) =>
        {
            if (finished)
                return;
            finished = true;
            cancel.dispose();
            if (error)
                reject(error);
            else
                resolve();
        };
        // 进程退出且 readline 吐完最后几行后才结束
        const settle = () =>
        {
            if (exitCode === undefined || !linesClosed)
                return;
            // 0 有结果，1 无结果，2 有错误（可能仍有部分结果）；被我们结束时不算错
            if (exitCode === 2 && !killed && stderr.trim())
            {
                // 去掉 ripgrep 错误信息里的 ~~~~ 分隔线与空行
                const detail = stderr.split(/\r?\n/)
                    .filter(line => line.trim() && !/^~+$/.test(line.trim()))
                    .slice(0, 8)
                    .join('\n');
                done(new FindQueryError(t('message.findInFilesFailed', detail)));
            }
            else
                done();
        };
        child.on('error', error => done(error));
        child.on('close', code =>
        {
            exitCode = code;
            settle();
        });
        lines.on('close', () =>
        {
            linesClosed = true;
            settle();
        });
    });
}

function isProbablyBinary(buffer: Uint8Array): boolean
{
    const length = Math.min(buffer.length, 8000);
    for (let i = 0; i < length; i++)
    {
        if (buffer[i] === 0)
            return true;
    }
    return false;
}

function decodeText(buffer: Buffer): string
{
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
        return buffer.subarray(2).toString('utf16le');
    const text = buffer.toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function braceGlob(patterns: string[]): string | undefined
{
    const variants = patterns.flatMap(globVariants);
    if (variants.length === 0)
        return undefined;
    return variants.length === 1 ? variants[0] : `{${variants.join(',')}}`;
}

/** 没有 ripgrep 时：用 findFiles 列文件，逐个读取查找。不支持 .gitignore。 */
async function runFallback(root: SearchRoot, options: FindOptions, matcher: RegExp, collector: Collector, token: vscode.CancellationToken): Promise<void>
{
    const base = vscode.Uri.file(root.directory);
    const include = new vscode.RelativePattern(base, braceGlob(splitGlobs(options.include)) ?? '**/*');
    const exclude = braceGlob(excludePatterns(options, root.folder));
    const files = await vscode.workspace.findFiles(include, exclude ?? null, undefined, token);
    let next = 0;
    const worker = async () =>
    {
        while (next < files.length && !token.isCancellationRequested && !collector.truncated)
        {
            const file = files[next++];
            try
            {
                const stat = await fs.promises.stat(file.fsPath);
                if (stat.size > maxFileSize)
                    continue;
                const buffer = await fs.promises.readFile(file.fsPath);
                collector.searched++;
                if (isProbablyBinary(buffer))
                    continue;
                addMatches(collector, file, searchText(decodeText(buffer), matcher));
            }
            catch
            {
                // 读不了的文件跳过
            }
        }
    };
    await Promise.all(Array.from({ length: fallbackConcurrency }, worker));
}

function isUnder(file: string, directory: string): boolean
{
    const relative = path.relative(directory, file);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** 未保存的文档：是否在搜索范围内且符合包含／排除模式。 */
function dirtyDocumentInScope(document: vscode.TextDocument, roots: SearchRoot[], options: FindOptions): boolean
{
    const root = roots.find(candidate => isUnder(document.uri.fsPath, candidate.directory));
    if (!root)
        return false;
    const base = vscode.Uri.file(root.directory);
    const matches = (patterns: string[]) => patterns.flatMap(globVariants)
        .some(pattern => vscode.languages.match({ pattern: new vscode.RelativePattern(base, pattern) }, document) > 0);
    const includes = splitGlobs(options.include);
    if (includes.length > 0 && !matches(includes))
        return false;
    return !matches(excludePatterns(options, root.folder));
}

function openDocumentUris(): vscode.Uri[]
{
    const uris = new Map<string, vscode.Uri>();
    for (const group of vscode.window.tabGroups.all)
    {
        for (const tab of group.tabs)
        {
            const uri = tab.input instanceof vscode.TabInputText
                ? tab.input.uri
                : tab.input instanceof vscode.TabInputTextDiff ? tab.input.modified : undefined;
            if (uri && (uri.scheme === 'file' || uri.scheme === 'untitled'))
                uris.set(uri.toString(), uri);
        }
    }
    return [...uris.values()];
}

/** 在已打开（或可打开）的文档里查找，用编辑器里的内容。 */
async function searchDocuments(uris: vscode.Uri[], matcher: RegExp, collector: Collector, token: vscode.CancellationToken): Promise<void>
{
    for (const uri of uris)
    {
        if (token.isCancellationRequested || collector.truncated)
            return;
        try
        {
            const document = await vscode.workspace.openTextDocument(uri);
            collector.searched++;
            addMatches(collector, uri, searchText(document.getText(), matcher));
        }
        catch
        {
            // 打不开的跳过
        }
    }
}

function compileMatcher(options: FindOptions): RegExp | undefined
{
    try
    {
        return buildMatcher(options);
    }
    catch
    {
        return undefined;
    }
}

export async function findInFiles(
    options: FindOptions,
    activeDocument: vscode.Uri | undefined,
    projects: ProjectResolver,
    token: vscode.CancellationToken,
    onProgress: (lines: number) => void): Promise<FindRun>
{
    // ripgrep 的正则语法比 JS 宽（如 (?i)），所以 JS 编译失败只在需要 JS 查找时报错
    const matcher = compileMatcher(options);
    const requireMatcher = () =>
    {
        if (matcher)
            return matcher;
        try
        {
            return buildMatcher(options);
        }
        catch (error)
        {
            throw new FindQueryError(t('message.invalidRegex', error instanceof Error ? error.message : String(error)));
        }
    };
    const configuredMax = vscode.workspace.getConfiguration('search').get<number | null>('maxResults');
    const collector: Collector = {
        files: new Map(),
        lines: 0,
        limit: typeof configuredMax === 'number' && configuredMax > 0 ? configuredMax : defaultMaxResults,
        truncated: false,
        searched: 0,
        onProgress,
    };

    const folders = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file');
    let lookIn = options.lookIn;
    if (lookIn === 'workspace' && folders.length === 0)
        lookIn = 'open';
    if ((lookIn === 'document' || lookIn === 'folder') && !activeDocument)
        throw new FindQueryError(t('message.noDocument'));

    if (lookIn === 'document')
        await searchDocuments([activeDocument!], requireMatcher(), collector, token);
    else if (lookIn === 'open')
        await searchDocuments(openDocumentUris(), requireMatcher(), collector, token);
    else
    {
        let roots: SearchRoot[];
        if (lookIn === 'folder')
        {
            if (activeDocument!.scheme !== 'file')
                throw new FindQueryError(t('message.noDocument'));
            const folder = vscode.workspace.getWorkspaceFolder(activeDocument!)?.uri ?? vscode.Uri.file(path.dirname(activeDocument!.fsPath));
            roots = [{ folder, directory: path.dirname(activeDocument!.fsPath) }];
        }
        else
            roots = folders.map(folder => ({ folder: folder.uri, directory: folder.uri.fsPath }));

        const rg = findRipgrep();
        for (const root of roots)
        {
            if (token.isCancellationRequested || collector.truncated)
                break;
            if (rg)
                await runRipgrep(rg, root, options, collector, token);
            else
                await runFallback(root, options, requireMatcher(), collector, token);
        }

        // 未保存的文档用编辑器里的内容替换磁盘上的结果
        if (matcher && !token.isCancellationRequested)
        {
            for (const document of vscode.workspace.textDocuments)
            {
                if (!document.isDirty || document.uri.scheme !== 'file')
                    continue;
                const key = fileKeyOf(document.uri);
                const previous = collector.files.get(key);
                if (!previous && !dirtyDocumentInScope(document, roots, options))
                    continue;
                if (previous)
                {
                    collector.files.delete(key);
                    collector.lines -= previous.matches.length;
                }
                addMatches(collector, document.uri, searchText(document.getText(), matcher));
            }
        }
    }

    const items: FoundItem[] = [];
    const projectCache = new Map<string, string>();
    for (const { uri, matches } of collector.files.values())
    {
        const fileKey = fileKeyOf(uri);
        let project = projectCache.get(fileKey);
        if (project === undefined)
        {
            project = await projects.resolve(uri);
            projectCache.set(fileKey, project);
        }
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        let root: string;
        let dirs: string[];
        if (folder && uri.scheme === 'file')
        {
            root = folder.uri.fsPath;
            dirs = path.relative(root, path.dirname(uri.fsPath)).split(/[\\/]/).filter(Boolean);
        }
        else
        {
            root = uri.scheme === 'file' ? path.dirname(uri.fsPath) : uri.scheme;
            dirs = [];
        }
        const fileName = path.basename(uri.path);
        const relativePath = vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1);
        for (const match of matches)
        {
            items.push({
                uri: uri.toString(),
                fileKey,
                fileName,
                relativePath,
                root,
                dirs,
                line: match.line,
                column: match.ranges[0][0],
                endColumn: match.ranges[0][1],
                matches: match.ranges,
                code: match.text,
                project,
            });
        }
    }
    items.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0) || a.line - b.line);

    return {
        symbol: options.query,
        options,
        originFileKey: activeDocument ? fileKeyOf(activeDocument) : '',
        originProject: activeDocument ? await projects.resolve(activeDocument) : '',
        summary: { searched: collector.searched, truncated: collector.truncated, stopped: token.isCancellationRequested },
        items,
    };
}
