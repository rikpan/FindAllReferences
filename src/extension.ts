// 扩展入口：注册「查找所有引用」与「查找结果」两个窗口及其命令。

import * as vscode from 'vscode';
import { collectReferences } from './collector';
import { FindOptions, normalizeFindOptions } from './core/search';
import { t } from './i18n';
import { ProjectResolver, RepositoryResolver } from './resolvers';
import { ResultsViewProvider } from './resultsView';
import { FindQueryError, findInFiles } from './textSearch';
import { bodyMarkup, findBodyMarkup } from './webviewMarkup';

const findStateKey = 'findAllReferences.findState';
const historyLimit = 30;

interface FindState
{
    options?: FindOptions;
    history?: string[];
}

/** 与 VS Code 一致：有单行选中文本就用它，否则用光标处的单词。 */
function seedFromEditor(): string
{
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return '';
    const selection = editor.selection;
    if (!selection.isEmpty)
        return selection.isSingleLine ? editor.document.getText(selection) : '';
    const range = editor.document.getWordRangeAtPosition(selection.active);
    return range ? editor.document.getText(range) : '';
}

export function activate(context: vscode.ExtensionContext): void
{
    const projects = new ProjectResolver();
    const repositories = new RepositoryResolver();
    void repositories.initialize();

    // ---------- 查找所有引用 ----------

    const references = new ResultsViewProvider({
        view: 'references',
        viewIds: { 'zh-cn': 'findAllReferences.results', en: 'findAllReferences.resultsEn' },
        settingsKey: 'findAllReferences.settings',
        hasResultsContext: 'findAllReferences.hasResults',
        markup: bodyMarkup,
        scripts: ['viewModel.js'],
    }, context, projects, repositories);
    let pendingReferences: vscode.CancellationTokenSource | undefined;

    const findAllReferences = async (uri?: vscode.Uri, position?: vscode.Position) =>
    {
        const editor = vscode.window.activeTextEditor;
        const targetUri = uri instanceof vscode.Uri ? uri : editor?.document.uri;
        const targetPosition = position instanceof vscode.Position ? position : editor?.selection.active;
        if (!targetUri || !targetPosition)
        {
            void vscode.window.showInformationMessage(t('message.placeCursor'));
            return;
        }
        pendingReferences?.cancel();
        const source = new vscode.CancellationTokenSource();
        pendingReferences = source;

        const document = await vscode.workspace.openTextDocument(targetUri);
        const wordRange = document.getWordRangeAtPosition(targetPosition);
        const word = wordRange ? document.getText(wordRange) : '';
        await references.reveal();
        references.setLoading(t('message.loading', word));
        try
        {
            const collected = await vscode.window.withProgress(
                { location: { viewId: references.currentViewId() } },
                () => collectReferences(targetUri, targetPosition, projects, repositories, source.token));
            if (collected && !source.token.isCancellationRequested)
                references.showResult({ ...collected });
        }
        catch (error)
        {
            void vscode.window.showErrorMessage(t('message.findFailed', String(error)));
        }
        finally
        {
            if (pendingReferences === source)
            {
                pendingReferences = undefined;
                references.setLoading(null);
            }
            source.dispose();
        }
    };

    // ---------- 在文件中查找 ----------

    const findState = (): FindState => context.globalState.get<FindState>(findStateKey) ?? {};
    let pendingFind: { source: vscode.CancellationTokenSource; stopped: boolean } | undefined;

    const find: ResultsViewProvider = new ResultsViewProvider({
        view: 'find',
        viewIds: { 'zh-cn': 'findAllReferences.find', en: 'findAllReferences.findEn' },
        settingsKey: 'findAllReferences.findSettings',
        hasResultsContext: 'findAllReferences.hasFindResults',
        markup: findBodyMarkup,
        scripts: ['findViewModel.js', 'findPanel.js'],
        initData: () => ({ find: findState() }),
        onCustomMessage: message =>
        {
            switch (message.type)
            {
                case 'find':
                    void runFind(normalizeFindOptions(message.options), typeof message.targetId === 'number' ? message.targetId : undefined);
                    break;
                case 'stop':
                    if (pendingFind)
                    {
                        pendingFind.stopped = true;
                        pendingFind.source.cancel();
                    }
                    break;
                case 'manageExcludes':
                    void vscode.commands.executeCommand('workbench.action.openSettings', 'search.exclude');
                    break;
            }
        },
    }, context, projects, repositories);

    const runFind = async (options: FindOptions, targetId?: number) =>
    {
        if (!options.query)
            return;
        const state = findState();
        const history = [options.query, ...(state.history ?? []).filter(entry => entry !== options.query)].slice(0, historyLimit);
        void context.globalState.update(findStateKey, { options, history } satisfies FindState);

        if (pendingFind)
            pendingFind.source.cancel();
        const run = { source: new vscode.CancellationTokenSource(), stopped: false };
        pendingFind = run;
        let lastProgress = 0;
        find.setLoading(t('message.finding', options.query));
        try
        {
            const found = await vscode.window.withProgress(
                { location: { viewId: find.currentViewId() } },
                () => findInFiles(options, find.lastActiveDocument, projects, run.source.token, lines =>
                {
                    const now = Date.now();
                    if (now - lastProgress < 150 || pendingFind !== run)
                        return;
                    lastProgress = now;
                    find.setLoading(t('message.findingProgress', options.query, lines));
                }));
            // 被新的查找取代时丢弃；用户点「停止」时保留已找到的部分
            if (!run.source.token.isCancellationRequested || run.stopped)
                find.showResult({ ...found }, targetId);
        }
        catch (error)
        {
            if (error instanceof FindQueryError)
                find.post({ type: 'findError', text: error.message, options, targetId });
            else if (!run.source.token.isCancellationRequested)
                void vscode.window.showErrorMessage(t('message.findInFilesFailed', String(error)));
        }
        finally
        {
            if (pendingFind === run)
            {
                pendingFind = undefined;
                find.setLoading(null);
            }
            run.source.dispose();
        }
    };

    /** Ctrl+Shift+F：打开查找窗口的查找表单，用编辑器里的选中文本或光标处单词作初始内容。 */
    const findInFilesCommand = async (args?: { seed?: boolean; query?: string }) =>
    {
        const seed = typeof args?.query === 'string' ? args.query : args?.seed === false ? '' : seedFromEditor();
        await find.reveal();
        const state = findState();
        find.postOrQueue({ type: 'showFind', seed, options: state.options, history: state.history ?? [] });
    };

    // ---------- F4／Shift+F4：在最近使用的窗口里导航 ----------

    let lastUsed: ResultsViewProvider = references;
    const navigate = (delta: number) =>
    {
        const target = lastUsed.hasResults ? lastUsed : [references, find].find(provider => provider.hasResults);
        target?.navigate(delta);
    };

    const register = (provider: ResultsViewProvider) => provider.viewIds.map(viewId =>
        vscode.window.registerWebviewViewProvider(viewId, provider, { webviewOptions: { retainContextWhenHidden: true } }));

    context.subscriptions.push(
        projects,
        repositories,
        references,
        find,
        ...register(references),
        ...register(find),
        references.onDidUse(() => lastUsed = references),
        find.onDidUse(() => lastUsed = find),
        vscode.commands.registerCommand('findAllReferences.findAllReferences', findAllReferences),
        vscode.commands.registerCommand('findAllReferences.findInFiles', findInFilesCommand),
        vscode.commands.registerCommand('findAllReferences.nextReference', () => navigate(1)),
        vscode.commands.registerCommand('findAllReferences.previousReference', () => navigate(-1)),
        {
            dispose: () =>
            {
                pendingReferences?.cancel();
                pendingFind?.source.cancel();
            },
        });
}

export function deactivate(): void
{
}
