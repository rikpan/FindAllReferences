// 面板里的结果窗口：持有全部结果页签，Webview 只负责展示与交互。

import * as vscode from 'vscode';
import { CollectedReferences } from './collector';
import { ReferenceResult, ViewContext } from './core/model';
import { currentLocale, languageSetting, Locale, t } from './i18n';
import { fileKeyOf, ProjectResolver, RepositoryResolver } from './resolvers';
import { bodyMarkup } from './webviewMarkup';

const settingsKey = 'findAllReferences.settings';
const hasResultsContext = 'findAllReferences.hasResults';
const localeContext = 'findAllReferences.locale';

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
    /**
     * 面板页签标题只能写在 package.json 里，运行时改不了；所以中英文各注册一个面板容器，
     * 视图按上下文键 findAllReferences.locale 的 when 条件二选一显示，切换语言就换成另一个页签。
     */
    static readonly viewIds: Record<Locale, string> = { 'zh-cn': 'findAllReferences.results', en: 'findAllReferences.resultsEn' };

    static currentViewId(): string
    {
        return ResultsViewProvider.viewIds[currentLocale()];
    }

    private view: vscode.WebviewView | undefined;
    private ready = false;
    private results: ReferenceResult[] = [];
    private activeId: number | undefined;
    private nextId = 1;
    private nextItemId = 1;
    private loading: string | null = null;
    private contextTimer: NodeJS.Timeout | undefined;
    private lastActiveUri: vscode.Uri | undefined;
    private locale: Locale = currentLocale();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly projects: ProjectResolver,
        private readonly repositories: RepositoryResolver)
    {
        this.lastActiveUri = vscode.window.activeTextEditor?.document.uri;
        void vscode.commands.executeCommand('setContext', localeContext, this.locale);
        this.disposables.push(
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
        await vscode.commands.executeCommand(`${ResultsViewProvider.currentViewId()}.focus`);
    }

    setLoading(text: string | null): void
    {
        this.loading = text;
        this.post({ type: 'loading', text });
    }

    /** 新结果替换第一个未保留的页签；全部都保留时新开一个。 */
    showResult(collected: CollectedReferences): void
    {
        const result: ReferenceResult = {
            id: this.nextId++,
            symbol: collected.symbol,
            kept: false,
            definition: collected.definition,
            originFileKey: collected.originFileKey,
            originProject: collected.originProject,
            items: collected.items.map(item => ({ ...item, id: this.nextItemId++ })),
        };
        const active = this.results.find(candidate => candidate.id === this.activeId);
        const target = active && !active.kept ? active : this.results.find(candidate => !candidate.kept);
        let replaceId: number | undefined;
        if (target)
        {
            replaceId = target.id;
            this.results[this.results.indexOf(target)] = result;
        }
        else
            this.results.push(result);
        this.activeId = result.id;
        void vscode.commands.executeCommand('setContext', hasResultsContext, true);
        this.post({ type: 'result', result, replaceId });
    }

    navigate(delta: number): void
    {
        this.post({ type: 'navigate', delta });
    }

    private onMessage(message: IncomingMessage): void
    {
        switch (message.type)
        {
            case 'ready':
                this.ready = true;
                void this.sendInit();
                break;
            case 'open':
                void this.open(message);
                break;
            case 'copy':
                void vscode.env.clipboard.writeText(message.text);
                break;
            case 'settings':
                void this.extensionContext.globalState.update(settingsKey, message.settings);
                break;
            case 'keep':
            {
                const result = this.results.find(candidate => candidate.id === message.id);
                if (result)
                    result.kept = message.kept;
                break;
            }
            case 'close':
                this.results = this.results.filter(candidate => candidate.id !== message.id);
                if (this.activeId === message.id)
                    this.activeId = this.results[0]?.id;
                if (this.results.length === 0)
                    void vscode.commands.executeCommand('setContext', hasResultsContext, false);
                break;
            case 'activate':
                this.activeId = message.id;
                break;
            case 'title':
                if (this.view)
                    this.view.title = message.title;
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
        this.post({
            type: 'init',
            locale: currentLocale(),
            settings: this.extensionContext.globalState.get(settingsKey) ?? null,
            results: this.results,
            activeId: this.activeId,
            loading: this.loading,
            context: await this.viewContext(),
        });
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

    private post(message: unknown): void
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
        return `<!DOCTYPE html>
<html lang="${locale === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${asset('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('main.css')}">
</head>
<body data-locale="${locale}" data-vscode-context='{"preventDefaultContextMenuItems": true}'>
${bodyMarkup}
<script nonce="${nonce}" src="${asset('i18n.js')}"></script>
<script nonce="${nonce}" src="${asset('viewModel.js')}"></script>
<script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
    }
}
