// 面板里的结果窗口：持有全部结果页签，Webview 只负责展示与交互。
// 「查找所有引用」与「查找结果」共用这一个类，差别在 ResultsViewConfig 里。

import * as vscode from 'vscode';
import { ViewContext } from './core/model';
import { currentLocale, languageSetting, Locale, t } from './i18n';
import { fileKeyOf, ProjectResolver, RepositoryResolver } from './resolvers';

const localeContext = 'findAllReferences.locale';

/** 一个结果页签：条目带 id，其余字段原样交给 Webview。 */
export interface StoredResult
{
    id: number;
    kept: boolean;
    items: { id: number }[];
    [key: string]: unknown;
}

/** 交给 showResult 的新结果：条目还没有 id。 */
export type NewResult = Omit<StoredResult, 'id' | 'kept' | 'items'> & { items: object[] };

export interface ResultsViewConfig
{
    /** Webview 里 body 的 data-view，main.js 据此选视图模型。 */
    view: 'references' | 'find';
    /**
     * 面板页签标题只能写在 package.json 里，运行时改不了；所以中英文各注册一个面板容器，
     * 视图按上下文键 findAllReferences.locale 的 when 条件二选一显示，切换语言就换成另一个页签。
     */
    viewIds: Record<Locale, string>;
    settingsKey: string;
    hasResultsContext: string;
    markup: string;
    /** media 下按顺序加载的脚本（i18n.js、listModel.js、main.js 之外的部分）。 */
    scripts: string[];
    /** 额外放进 init 消息的数据。 */
    initData?: () => Record<string, unknown>;
    /** 处理通用协议之外的消息。 */
    onCustomMessage?: (message: { type: string; [key: string]: unknown }) => void;
}

type IncomingMessage =
    | { type: 'ready' }
    | { type: 'open'; uri: string; line: number; column: number; endColumn: number; preserveFocus: boolean; preview: boolean }
    | { type: 'copy'; text: string }
    | { type: 'settings'; settings: unknown }
    | { type: 'keep'; id: number; kept: boolean }
    | { type: 'close'; id: number }
    | { type: 'activate'; id: number }
    | { type: 'title'; title: string };

export class ResultsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable
{
    private view: vscode.WebviewView | undefined;
    private ready = false;
    private results: StoredResult[] = [];
    private activeId: number | undefined;
    private nextId = 1;
    private nextItemId = 1;
    private loading: string | null = null;
    private contextTimer: NodeJS.Timeout | undefined;
    private lastActiveUri: vscode.Uri | undefined;
    private locale: Locale = currentLocale();
    /** Webview 还没准备好时要发的消息，init 之后补发。 */
    private queued: unknown[] = [];
    private readonly disposables: vscode.Disposable[] = [];
    private readonly usedEmitter = new vscode.EventEmitter<void>();

    /** 显示了新结果或用户在窗口里打开了条目；F4 据此决定在哪个窗口里导航。 */
    readonly onDidUse = this.usedEmitter.event;

    constructor(
        private readonly config: ResultsViewConfig,
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly projects: ProjectResolver,
        private readonly repositories: RepositoryResolver)
    {
        this.lastActiveUri = vscode.window.activeTextEditor?.document.uri;
        void vscode.commands.executeCommand('setContext', localeContext, this.locale);
        this.disposables.push(
            this.usedEmitter,
            vscode.window.onDidChangeActiveTextEditor(editor =>
            {
                if (editor)
                    this.lastActiveUri = editor.document.uri;
                this.scheduleContext();
            }),
            vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleContext()),
            repositories.onDidChange(() => this.scheduleContext()),
            vscode.workspace.onDidChangeConfiguration(event =>
            {
                if (event.affectsConfiguration(languageSetting))
                    void this.onLocaleChanged();
            }));
    }

    dispose(): void
    {
        for (const disposable of this.disposables)
            disposable.dispose();
    }

    get viewIds(): string[]
    {
        return Object.values(this.config.viewIds);
    }

    currentViewId(): string
    {
        return this.config.viewIds[currentLocale()];
    }

    get hasResults(): boolean
    {
        return this.results.length > 0;
    }

    /** 最近一次在编辑器里激活的文档；结果窗口获得焦点时 activeTextEditor 仍可能为空。 */
    get lastActiveDocument(): vscode.Uri | undefined
    {
        return vscode.window.activeTextEditor?.document.uri ?? this.lastActiveUri;
    }

    resolveWebviewView(view: vscode.WebviewView): void
    {
        this.view = view;
        this.ready = false;
        const media = vscode.Uri.joinPath(this.extensionContext.extensionUri, 'media');
        view.webview.options = { enableScripts: true, localResourceRoots: [media] };
        view.webview.html = this.html(view.webview, media);
        view.webview.onDidReceiveMessage((message: IncomingMessage) => this.onMessage(message));
        view.onDidDispose(() =>
        {
            if (this.view !== view)
                return;
            this.view = undefined;
            this.ready = false;
        });
    }

    /** 切换语言：换显示的页签；原来的窗口正显示着，就把新窗口调出来，再把焦点还给编辑器（如设置页）。 */
    private async onLocaleChanged(): Promise<void>
    {
        const locale = currentLocale();
        if (locale === this.locale)
            return;
        this.locale = locale;
        const wasVisible = !!this.view?.visible;
        this.post({ type: 'locale', locale });
        await vscode.commands.executeCommand('setContext', localeContext, locale);
        if (!wasVisible)
            return;
        await this.reveal();
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }

    /** 与 Visual Studio 一致：查找时把焦点交给结果窗口，可直接用键盘浏览。 */
    async reveal(): Promise<void>
    {
        await vscode.commands.executeCommand(`${this.currentViewId()}.focus`);
    }

    setLoading(text: string | null): void
    {
        this.loading = text;
        this.post({ type: 'loading', text });
    }

    /**
     * 新结果替换 targetId 指定的页签（修改查找、刷新）；没有指定时替换第一个未保留的页签，全部都保留就新开一个。
     */
    showResult(fresh: NewResult, targetId?: number): void
    {
        const previous = targetId === undefined ? undefined : this.results.find(candidate => candidate.id === targetId);
        const result: StoredResult = {
            ...fresh,
            id: this.nextId++,
            kept: previous?.kept ?? false,
            items: fresh.items.map(item => ({ ...item, id: this.nextItemId++ })),
        };
        const active = this.results.find(candidate => candidate.id === this.activeId);
        const target = previous ?? (active && !active.kept ? active : this.results.find(candidate => !candidate.kept));
        let replaceId: number | undefined;
        if (target)
        {
            replaceId = target.id;
            this.results[this.results.indexOf(target)] = result;
        }
        else
            this.results.push(result);
        this.activeId = result.id;
        void vscode.commands.executeCommand('setContext', this.config.hasResultsContext, true);
        this.post({ type: 'result', result, replaceId });
        this.usedEmitter.fire();
    }

    navigate(delta: number): void
    {
        this.post({ type: 'navigate', delta });
    }

    /** 发给 Webview；还没准备好时排队，init 之后补发。 */
    postOrQueue(message: unknown): void
    {
        if (this.view && this.ready)
            void this.view.webview.postMessage(message);
        else
            this.queued.push(message);
    }

    private onMessage(message: IncomingMessage | { type: string; [key: string]: unknown }): void
    {
        const known = message as IncomingMessage;
        switch (known.type)
        {
            case 'ready':
                this.ready = true;
                void this.sendInit();
                break;
            case 'open':
                this.usedEmitter.fire();
                void this.open(known);
                break;
            case 'copy':
                void vscode.env.clipboard.writeText(known.text);
                break;
            case 'settings':
                void this.extensionContext.globalState.update(this.config.settingsKey, known.settings);
                break;
            case 'keep':
            {
                const result = this.results.find(candidate => candidate.id === known.id);
                if (result)
                    result.kept = known.kept;
                break;
            }
            case 'close':
                this.results = this.results.filter(candidate => candidate.id !== known.id);
                if (this.activeId === known.id)
                    this.activeId = this.results[0]?.id;
                if (this.results.length === 0)
                    void vscode.commands.executeCommand('setContext', this.config.hasResultsContext, false);
                break;
            case 'activate':
                this.activeId = known.id;
                this.usedEmitter.fire();
                break;
            case 'title':
                if (this.view)
                    this.view.title = known.title;
                break;
            default:
                this.config.onCustomMessage?.(message as { type: string });
                break;
        }
    }

    private async open(message: Extract<IncomingMessage, { type: 'open' }>): Promise<void>
    {
        const range = new vscode.Range(message.line, message.column, message.line, message.endColumn);
        try
        {
            await vscode.window.showTextDocument(vscode.Uri.parse(message.uri), {
                selection: range,
                preserveFocus: message.preserveFocus,
                preview: message.preview,
            });
        }
        catch (error)
        {
            void vscode.window.showWarningMessage(t('message.openFailed', String(error)));
        }
    }

    private async sendInit(): Promise<void>
    {
        const view = this.view;
        this.post({
            ...(this.config.initData?.() ?? {}),
            type: 'init',
            locale: currentLocale(),
            settings: this.extensionContext.globalState.get(this.config.settingsKey) ?? null,
            results: this.results,
            activeId: this.activeId,
            loading: this.loading,
            context: await this.viewContext(),
        });
        if (view !== this.view || !this.ready)
            return;
        const queued = this.queued;
        this.queued = [];
        for (const message of queued)
            this.post(message);
    }

    private scheduleContext(): void
    {
        if (this.contextTimer)
            clearTimeout(this.contextTimer);
        this.contextTimer = setTimeout(async () =>
        {
            this.contextTimer = undefined;
            if (this.ready)
                this.post({ type: 'context', context: await this.viewContext() });
        }, 200);
    }

    private async viewContext(): Promise<ViewContext>
    {
        const openFileKeys = new Set<string>();
        for (const group of vscode.window.tabGroups.all)
        {
            for (const tab of group.tabs)
            {
                if (tab.input instanceof vscode.TabInputText)
                    openFileKeys.add(fileKeyOf(tab.input.uri));
                else if (tab.input instanceof vscode.TabInputTextDiff)
                    openFileKeys.add(fileKeyOf(tab.input.modified));
            }
        }
        const active = this.lastActiveUri;
        return {
            activeFileKey: active ? fileKeyOf(active) : '',
            activeProject: active ? await this.projects.resolve(active) : '',
            openFileKeys: [...openFileKeys],
            changedFileKeys: this.repositories.changedFileKeys(),
        };
    }

    post(message: unknown): void
    {
        if (this.view && this.ready)
            void this.view.webview.postMessage(message);
    }

    private html(webview: vscode.Webview, media: vscode.Uri): string
    {
        const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(media, ...parts)).toString();
        const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');
        const locale = currentLocale();
        const scripts = ['i18n.js', 'listModel.js', ...this.config.scripts, 'main.js']
            .map(name => `<script nonce="${nonce}" src="${asset(name)}"></script>`)
            .join('\n');
        return `<!DOCTYPE html>
<html lang="${locale === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${asset('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('main.css')}">
</head>
<body data-view="${this.config.view}" data-locale="${locale}" data-vscode-context='{"preventDefaultContextMenuItems": true}'>
${this.config.markup}
${scripts}
</body>
</html>`;
    }
}
