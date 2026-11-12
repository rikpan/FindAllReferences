// 扩展入口：注册结果窗口与命令。

import * as vscode from 'vscode';
import { collectReferences } from './collector';
import { ProjectResolver, RepositoryResolver } from './resolvers';
import { t } from './i18n';
import { ResultsViewProvider } from './resultsView';

export function activate(context: vscode.ExtensionContext): void
{
    const projects = new ProjectResolver();
    const repositories = new RepositoryResolver();
    void repositories.initialize();
    const provider = new ResultsViewProvider(context, projects, repositories);
    let pending: vscode.CancellationTokenSource | undefined;

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
        pending?.cancel();
        const source = new vscode.CancellationTokenSource();
        pending = source;

        const document = await vscode.workspace.openTextDocument(targetUri);
        const wordRange = document.getWordRangeAtPosition(targetPosition);
        const word = wordRange ? document.getText(wordRange) : '';
        await provider.reveal();
        provider.setLoading(t('message.loading', word));
        try
        {
            const collected = await vscode.window.withProgress(
                { location: { viewId: ResultsViewProvider.currentViewId() } },
                () => collectReferences(targetUri, targetPosition, projects, repositories, source.token));
            if (collected && !source.token.isCancellationRequested)
                provider.showResult(collected);
        }
        catch (error)
        {
            void vscode.window.showErrorMessage(t('message.findFailed', String(error)));
        }
        finally
        {
            if (pending === source)
            {
                pending = undefined;
                provider.setLoading(null);
            }
            source.dispose();
        }
    };

    context.subscriptions.push(
        projects,
        repositories,
        provider,
        ...Object.values(ResultsViewProvider.viewIds).map(viewId =>
            vscode.window.registerWebviewViewProvider(viewId, provider, {
                webviewOptions: { retainContextWhenHidden: true },
            })),
        vscode.commands.registerCommand('findAllReferences.findAllReferences', findAllReferences),
        vscode.commands.registerCommand('findAllReferences.nextReference', () => provider.navigate(1)),
        vscode.commands.registerCommand('findAllReferences.previousReference', () => provider.navigate(-1)),
        { dispose: () => pending?.cancel() });
}

export function deactivate(): void
{
}
