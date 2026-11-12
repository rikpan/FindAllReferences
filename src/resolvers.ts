// 项目与存储库的解析：带缓存，工程文件或 Git 状态变化时失效。

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { normalizeFilePath, ProjectIndex } from './core/projects';
import { strings } from './i18n';

/** 特殊项目名按 ID 存储，Webview 显示时翻译为「杂项文件」「外部文件」。 */
export const miscellaneousFiles = strings.PROJECT_MISCELLANEOUS;
export const externalFiles = strings.PROJECT_EXTERNAL;

export function fileKeyOf(uri: vscode.Uri): string
{
    return uri.scheme === 'file' ? normalizeFilePath(uri.fsPath) : uri.toString();
}

const projectGlob = '**/*.{csproj,vbproj,fsproj}';
const projectExclude = '**/{node_modules,Library,Temp,Logs,obj,bin,.git}/**';
const projectMarkers = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'pom.xml', 'build.gradle', 'CMakeLists.txt'];

export class ProjectResolver implements vscode.Disposable
{
    private index: Promise<ProjectIndex> | undefined;
    private readonly markerCache = new Map<string, string | null>();
    private readonly watcher: vscode.FileSystemWatcher;

    constructor()
    {
        this.watcher = vscode.workspace.createFileSystemWatcher(projectGlob);
        const reset = () =>
        {
            this.index = undefined;
        };
        this.watcher.onDidCreate(reset);
        this.watcher.onDidChange(reset);
        this.watcher.onDidDelete(reset);
    }

    dispose(): void
    {
        this.watcher.dispose();
    }

    async resolve(uri: vscode.Uri): Promise<string>
    {
        if (uri.scheme !== 'file')
            return externalFiles;
        const index = await this.getIndex();
        const project = index.resolve(uri.fsPath);
        if (project)
            return project;
        if (/\.(cs|vb|fs)$/i.test(uri.fsPath) && index.size > 0)
            return miscellaneousFiles;
        return this.resolveByMarker(uri);
    }

    private getIndex(): Promise<ProjectIndex>
    {
        if (!this.index)
            this.index = this.buildIndex();
        return this.index;
    }

    private async buildIndex(): Promise<ProjectIndex>
    {
        const index = new ProjectIndex();
        const files = await vscode.workspace.findFiles(projectGlob, projectExclude, 5000);
        files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
        const decoder = new TextDecoder('utf-8');
        for (const file of files)
        {
            try
            {
                index.add(file.fsPath, decoder.decode(await vscode.workspace.fs.readFile(file)));
            }
            catch (error)
            {
                console.warn(`[find-all-references] 读取工程文件失败：${file.fsPath}`, error);
            }
        }
        return index;
    }

    /** 非 .NET 文件：向上找最近的工程标记文件，取 package.json 的 name 或目录名。 */
    private resolveByMarker(uri: vscode.Uri): string
    {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        const stop = folder ? normalizeFilePath(folder.uri.fsPath) : undefined;
        let directory = path.dirname(uri.fsPath);
        for (;;)
        {
            const name = this.markerName(directory);
            if (name)
                return name;
            const parent = path.dirname(directory);
            if (parent === directory || normalizeFilePath(directory) === stop)
                break;
            directory = parent;
        }
        return folder ? folder.name : miscellaneousFiles;
    }

    private markerName(directory: string): string | null
    {
        const cached = this.markerCache.get(directory);
        if (cached !== undefined)
            return cached;
        let name: string | null = null;
        for (const marker of projectMarkers)
        {
            const file = path.join(directory, marker);
            if (!fs.existsSync(file))
                continue;
            name = path.basename(directory);
            if (marker === 'package.json')
            {
                try
                {
                    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
                    if (typeof parsed.name === 'string' && parsed.name)
                        name = parsed.name;
                }
                catch
                {
                    // package.json 不合法时退回目录名
                }
            }
            break;
        }
        this.markerCache.set(directory, name);
        return name;
    }
}

// vscode.git 扩展 API 的最小子集
interface GitChange
{
    readonly uri: vscode.Uri;
}

interface GitRepositoryState
{
    readonly workingTreeChanges: GitChange[];
    readonly indexChanges: GitChange[];
    readonly untrackedChanges?: GitChange[];
    readonly onDidChange: vscode.Event<void>;
}

interface GitRepository
{
    readonly rootUri: vscode.Uri;
    readonly state: GitRepositoryState;
}

interface GitApi
{
    readonly repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
    readonly onDidOpenRepository: vscode.Event<GitRepository>;
}

export class RepositoryResolver implements vscode.Disposable
{
    private api: GitApi | undefined;
    private apiRequested = false;
    private readonly directoryCache = new Map<string, string>();
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
    private readonly watched = new Set<GitRepository>();

    readonly onDidChange = this.changeEmitter.event;

    dispose(): void
    {
        for (const disposable of this.disposables)
            disposable.dispose();
    }

    async initialize(): Promise<void>
    {
        const api = await this.getApi();
        if (!api)
            return;
        for (const repository of api.repositories)
            this.watch(repository);
        this.disposables.push(api.onDidOpenRepository(repository =>
        {
            this.watch(repository);
            this.changeEmitter.fire();
        }));
    }

    async resolve(uri: vscode.Uri): Promise<string>
    {
        if (uri.scheme !== 'file')
            return '';
        const api = await this.getApi();
        const repository = api?.getRepository(uri);
        if (repository)
            return path.basename(repository.rootUri.fsPath);
        return this.resolveByDirectory(path.dirname(uri.fsPath));
    }

    changedFileKeys(): string[]
    {
        if (!this.api)
            return [];
        const keys = new Set<string>();
        for (const repository of this.api.repositories)
        {
            const state = repository.state;
            for (const change of [...state.workingTreeChanges, ...state.indexChanges, ...(state.untrackedChanges ?? [])])
                keys.add(fileKeyOf(change.uri));
        }
        return [...keys];
    }

    private watch(repository: GitRepository): void
    {
        if (this.watched.has(repository))
            return;
        this.watched.add(repository);
        this.disposables.push(repository.state.onDidChange(() => this.changeEmitter.fire()));
    }

    private async getApi(): Promise<GitApi | undefined>
    {
        if (this.apiRequested)
            return this.api;
        this.apiRequested = true;
        const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
        if (!extension)
            return undefined;
        try
        {
            const exports = extension.isActive ? extension.exports : await extension.activate();
            this.api = exports.getAPI(1);
        }
        catch (error)
        {
            console.warn('[find-all-references] 无法获取 Git 扩展 API，存储库列改用目录推断。', error);
        }
        return this.api;
    }

    private resolveByDirectory(directory: string): string
    {
        const cached = this.directoryCache.get(directory);
        if (cached !== undefined)
            return cached;
        let name = '';
        if (fs.existsSync(path.join(directory, '.git')))
            name = path.basename(directory);
        else
        {
            const parent = path.dirname(directory);
            if (parent !== directory)
                name = this.resolveByDirectory(parent);
        }
        this.directoryCache.set(directory, name);
        return name;
    }
}
