// 收集一次「查找所有引用」的结果：引用位置来自语言服务，其余列逐文件补齐。

import * as path from 'path';
import * as vscode from 'vscode';
import { classifyReference, HighlightKind } from './core/classify';
import { DefinitionInfo, ReferenceItem } from './core/model';
import { classOfKind, containersAt, definitionLabelAt, iconForKind, SymbolClass, SymbolNode } from './core/symbols';
import { fileKeyOf, ProjectResolver, RepositoryResolver } from './resolvers';

export interface CollectedReferences
{
    symbol: string;
    definition: DefinitionInfo;
    originFileKey: string;
    originProject: string;
    items: Omit<ReferenceItem, 'id'>[];
}

const fileConcurrency = 8;

async function documentSymbols(uri: vscode.Uri): Promise<SymbolNode[]>
{
    try
    {
        const raw = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
            'vscode.executeDocumentSymbolProvider', uri);
        if (!raw)
            return [];
        return raw.map(symbol => 'location' in symbol
            ? { name: symbol.name, kind: symbol.kind, range: symbol.location.range }
            : symbol);
    }
    catch
    {
        return [];
    }
}

async function highlightsAt(uri: vscode.Uri, position: vscode.Position): Promise<Map<string, HighlightKind>>
{
    const map = new Map<string, HighlightKind>();
    try
    {
        const highlights = await vscode.commands.executeCommand<vscode.DocumentHighlight[]>(
            'vscode.executeDocumentHighlights', uri, position);
        for (const highlight of highlights ?? [])
            map.set(`${highlight.range.start.line}:${highlight.range.start.character}`, (highlight.kind ?? 0) as HighlightKind);
    }
    catch
    {
        // 没有高亮提供程序时只按文本判断
    }
    return map;
}

function toLocation(target: vscode.Location | vscode.LocationLink): vscode.Location
{
    if ('targetUri' in target)
        return new vscode.Location(target.targetUri, target.targetSelectionRange ?? target.targetRange);
    return target;
}

function sameStart(a: vscode.Location, b: vscode.Location): boolean
{
    return a.uri.toString() === b.uri.toString() && a.range.start.isEqual(b.range.start);
}

async function forEachLimited<T>(values: T[], limit: number, token: vscode.CancellationToken, action: (value: T) => Promise<void>): Promise<void>
{
    let next = 0;
    const worker = async () =>
    {
        while (next < values.length && !token.isCancellationRequested)
            await action(values[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
}

export async function collectReferences(
    uri: vscode.Uri,
    position: vscode.Position,
    projects: ProjectResolver,
    repositories: RepositoryResolver,
    token: vscode.CancellationToken): Promise<CollectedReferences | undefined>
{
    const origin = await vscode.workspace.openTextDocument(uri);
    const wordRange = origin.getWordRangeAtPosition(position);
    const word = wordRange ? origin.getText(wordRange) : '';

    const [references, definitions] = await Promise.all([
        vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position),
        Promise.resolve(vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            'vscode.executeDefinitionProvider', uri, position)).catch(() => undefined),
    ]);
    if (token.isCancellationRequested)
        return undefined;

    const definitionLocations = (definitions ?? []).map(toLocation);
    let definition: DefinitionInfo = { label: word, icon: 'symbol-misc' };
    let symbolClass: SymbolClass = 'unknown';
    if (definitionLocations.length > 0)
    {
        const first = definitionLocations[0];
        const label = definitionLabelAt(await documentSymbols(first.uri), first.range.start, word);
        definition = { label: label.label || word, icon: iconForKind(label.kind) };
        symbolClass = classOfKind(label.kind);
    }

    // 定义位置若不在引用里（提供程序不含声明时），补进结果
    const locations = [...(references ?? [])];
    for (const location of definitionLocations)
    {
        if (location.uri.scheme === 'file' && !locations.some(existing => sameStart(existing, location)))
            locations.push(location);
    }

    const byFile = new Map<string, { uri: vscode.Uri; locations: vscode.Location[] }>();
    for (const location of locations)
    {
        const key = location.uri.toString();
        let entry = byFile.get(key);
        if (!entry)
        {
            entry = { uri: location.uri, locations: [] };
            byFile.set(key, entry);
        }
        entry.locations.push(location);
    }

    const items: Omit<ReferenceItem, 'id'>[] = [];
    await forEachLimited([...byFile.values()], fileConcurrency, token, async entry =>
    {
        let document: vscode.TextDocument | undefined;
        try
        {
            document = await vscode.workspace.openTextDocument(entry.uri);
        }
        catch (error)
        {
            console.warn(`[find-all-references] 无法打开引用所在文件：${entry.uri.toString()}`, error);
        }
        const [symbols, highlights, project, repository] = await Promise.all([
            documentSymbols(entry.uri),
            symbolClass === 'value' || symbolClass === 'unknown'
                ? highlightsAt(entry.uri, entry.locations[0].range.start)
                : Promise.resolve(new Map<string, HighlightKind>()),
            projects.resolve(entry.uri),
            repositories.resolve(entry.uri),
        ]);
        const fileKey = fileKeyOf(entry.uri);
        const fileName = path.basename(entry.uri.path);
        const relativePath = vscode.workspace.asRelativePath(entry.uri, false);
        for (const location of entry.locations)
        {
            const start = location.range.start;
            const code = document && start.line < document.lineCount ? document.lineAt(start.line).text : '';
            const endColumn = location.range.end.line === start.line ? location.range.end.character : code.length;
            const isDefinition = definitionLocations.some(candidate => sameStart(candidate, location));
            const containers = containersAt(symbols, start, word);
            items.push({
                uri: entry.uri.toString(),
                fileKey,
                fileName,
                relativePath,
                line: start.line,
                column: start.character,
                endColumn,
                code,
                project,
                member: containers.member,
                type: containers.type,
                kind: classifyReference({
                    line: code,
                    start: start.character,
                    end: endColumn,
                    symbolClass,
                    highlight: highlights.get(`${start.line}:${start.character}`),
                    isDefinition,
                }),
                repository,
                isDefinition,
            });
        }
    });
    if (token.isCancellationRequested)
        return undefined;

    items.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.line - b.line || a.column - b.column);
    return {
        symbol: word || definition.label,
        definition,
        originFileKey: fileKeyOf(uri),
        originProject: await projects.resolve(uri),
        items,
    };
}
