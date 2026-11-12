// 「类别」列：按 Visual Studio（Roslyn）的用法分类在单行文本上做启发式判断。
// 语言服务只给位置，不给用法；类型按语法上下文判断，值按文档高亮的读写判断。
// 结果存 ID（如 typeArgument），显示文本在 media/i18n.js 的 kind.* 里按界面语言翻译。

import { SymbolClass } from './symbols';

export const Kind = {
    definition: 'definition',
    read: 'read',
    write: 'write',
    readWrite: 'readWrite',
    qualified: 'qualified',
    typeArgument: 'typeArgument',
    typeConstraint: 'typeConstraint',
    baseType: 'baseType',
    objectCreation: 'objectCreation',
    importing: 'importing',
    name: 'name',
    none: '',
} as const;

/** 与 vscode.DocumentHighlightKind 一致：0 文本、1 读取、2 写入。 */
export type HighlightKind = 0 | 1 | 2;

const compoundAssignment = /^\s*(?:\+|-|\*|\/|%|&|\||\^|<<|>>>?|\?\?)=/;
const simpleAssignment = /^\s*=(?![=>])/;

/** 是否位于泛型实参表内：向左扫描，遇到紧贴标识符的未配对「<」即是。 */
export function isInTypeArgumentList(before: string): boolean
{
    let angle = 0;
    let paren = 0;
    for (let i = before.length - 1; i >= 0; i--)
    {
        const c = before[i];
        if (c === '>')
            angle++;
        else if (c === '<')
        {
            if (angle === 0)
                return i > 0 && /[\w$]/.test(before[i - 1]);
            angle--;
        }
        else if (c === ')')
            paren++;
        else if (c === '(')
        {
            if (paren > 0)
                paren--;
            else if (i > 0 && /[\w$]/.test(before[i - 1]))
                return false; // 方法调用的实参表
        }
        else if (!/[\w\s,.?\[\]:*@$]/.test(c))
            return false;
    }
    return false;
}

function classifyType(before: string, after: string): string
{
    if (/^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?[\w.:]*$/.test(before) ||
        /^\s*import\b[^;]*$/.test(before))
        return Kind.importing;
    if (/^\s*(?:<[^<>]*>)?\s*(?:\.|::)(?!\.)/.test(after))
        return Kind.qualified;
    if (/\bnew\s+(?:[\w.]+\.)?$/.test(before))
        return Kind.objectCreation;
    if (/\bwhere\s+\w+\s*:[^{;]*$/.test(before))
        return Kind.typeConstraint;
    if (/\b(?:class|struct|interface|record)\s+\w+[^:{;]*:[^{;]*$/.test(before) ||
        /\b(?:extends|implements)\s+[^{;]*$/.test(before))
        return Kind.baseType;
    if (isInTypeArgumentList(before))
        return Kind.typeArgument;
    return Kind.none;
}

function classifyValue(before: string, after: string, highlight: HighlightKind | undefined): string
{
    if (/(?:\+\+|--)\s*$/.test(before) || /^\s*(?:\+\+|--)/.test(after) || compoundAssignment.test(after))
        return Kind.readWrite;
    if (/\bref\s+$/.test(before))
        return Kind.readWrite;
    if (/\bout\s+(?:var\s+)?$/.test(before))
        return Kind.write;
    if (highlight === 2 || simpleAssignment.test(after))
        return Kind.write;
    return Kind.read;
}

export interface ClassifyInput
{
    line: string;
    start: number;
    end: number;
    symbolClass: SymbolClass;
    highlight?: HighlightKind;
    isDefinition: boolean;
}

export function classifyReference(input: ClassifyInput): string
{
    if (input.isDefinition)
        return Kind.definition;
    const before = input.line.slice(0, input.start);
    const after = input.line.slice(input.end);
    if (/\bnameof\s*\(\s*(?:[\w.]+\.)?$/.test(before))
        return Kind.name;
    switch (input.symbolClass)
    {
        case 'type':
            return classifyType(before, after);
        case 'value':
            return classifyValue(before, after, input.highlight);
        case 'method':
            return Kind.none;
        default:
            if (input.highlight === 2 || input.highlight === 1)
                return classifyValue(before, after, input.highlight);
            return classifyType(before, after);
    }
}
