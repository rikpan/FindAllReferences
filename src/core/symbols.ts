// 文档符号树上的纯函数：包含成员、包含类型、定义标签。
// 数值与 vscode.SymbolKind 一致，这里不引用 vscode 以便在 node 下测试。

export const SymbolKind = {
    File: 0,
    Module: 1,
    Namespace: 2,
    Package: 3,
    Class: 4,
    Method: 5,
    Property: 6,
    Field: 7,
    Constructor: 8,
    Enum: 9,
    Interface: 10,
    Function: 11,
    Variable: 12,
    Constant: 13,
    EnumMember: 21,
    Struct: 22,
    Event: 23,
    Operator: 24,
    TypeParameter: 25,
} as const;

export interface Position
{
    line: number;
    character: number;
}

export interface Range
{
    start: Position;
    end: Position;
}

export interface SymbolNode
{
    name: string;
    kind: number;
    range: Range;
    selectionRange?: Range;
    children?: SymbolNode[];
}

/** 符号的用法类：决定「类别」列按类型规则还是按读写规则判断。 */
export type SymbolClass = 'type' | 'method' | 'value' | 'unknown';

const typeKinds = new Set<number>([SymbolKind.Class, SymbolKind.Struct, SymbolKind.Interface, SymbolKind.Enum]);

const memberKinds = new Set<number>([
    SymbolKind.Method,
    SymbolKind.Constructor,
    SymbolKind.Property,
    SymbolKind.Field,
    SymbolKind.Event,
    SymbolKind.Operator,
    SymbolKind.Function,
    SymbolKind.EnumMember,
    SymbolKind.Constant,
    SymbolKind.Variable,
]);

const typeKeywords = new Map<number, string>([
    [SymbolKind.Class, 'class'],
    [SymbolKind.Struct, 'struct'],
    [SymbolKind.Interface, 'interface'],
    [SymbolKind.Enum, 'enum'],
    [SymbolKind.Namespace, 'namespace'],
]);

const kindIcons = new Map<number, string>([
    [SymbolKind.File, 'symbol-file'],
    [SymbolKind.Module, 'symbol-module'],
    [SymbolKind.Namespace, 'symbol-namespace'],
    [SymbolKind.Package, 'symbol-package'],
    [SymbolKind.Class, 'symbol-class'],
    [SymbolKind.Method, 'symbol-method'],
    [SymbolKind.Property, 'symbol-property'],
    [SymbolKind.Field, 'symbol-field'],
    [SymbolKind.Constructor, 'symbol-constructor'],
    [SymbolKind.Enum, 'symbol-enum'],
    [SymbolKind.Interface, 'symbol-interface'],
    [SymbolKind.Function, 'symbol-function'],
    [SymbolKind.Variable, 'symbol-variable'],
    [SymbolKind.Constant, 'symbol-constant'],
    [SymbolKind.EnumMember, 'symbol-enum-member'],
    [SymbolKind.Struct, 'symbol-struct'],
    [SymbolKind.Event, 'symbol-event'],
    [SymbolKind.Operator, 'symbol-operator'],
    [SymbolKind.TypeParameter, 'symbol-type-parameter'],
]);

export function comparePosition(a: Position, b: Position): number
{
    if (a.line !== b.line)
        return a.line - b.line;
    return a.character - b.character;
}

export function rangeContains(range: Range, position: Position): boolean
{
    return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

export function isTypeKind(kind: number): boolean
{
    return typeKinds.has(kind);
}

export function isMemberKind(kind: number): boolean
{
    return memberKinds.has(kind);
}

export function iconForKind(kind: number | undefined): string
{
    if (kind === undefined)
        return 'symbol-misc';
    return kindIcons.get(kind) ?? 'symbol-misc';
}

export function classOfKind(kind: number | undefined): SymbolClass
{
    if (kind === undefined)
        return 'unknown';
    if (typeKinds.has(kind) || kind === SymbolKind.Namespace || kind === SymbolKind.TypeParameter)
        return 'type';
    if (kind === SymbolKind.Method ||
        kind === SymbolKind.Function ||
        kind === SymbolKind.Constructor ||
        kind === SymbolKind.Operator)
        return 'method';
    if (memberKinds.has(kind))
        return 'value';
    return 'unknown';
}

/** 去掉成员名里的参数表，「UpdateAnimation(Frame, EntityRef)」→「UpdateAnimation」。 */
export function plainName(name: string): string
{
    const paren = name.indexOf('(');
    return (paren >= 0 ? name.slice(0, paren) : name).trim();
}

/** 去掉泛型参数，用于和光标下的单词比较。 */
function bareName(name: string): string
{
    const angle = name.indexOf('<');
    return plainName(angle >= 0 ? name.slice(0, angle) : name);
}

/** 由外到内列出包含该位置的全部符号；兼容树形 DocumentSymbol 与扁平 SymbolInformation。 */
export function symbolChainAt(roots: readonly SymbolNode[], position: Position): SymbolNode[]
{
    const chain: SymbolNode[] = [];
    const visit = (nodes: readonly SymbolNode[]) =>
    {
        for (const node of nodes)
        {
            if (!rangeContains(node.range, position))
                continue;
            chain.push(node);
            if (node.children && node.children.length > 0)
                visit(node.children);
        }
    };
    visit(roots);
    chain.sort((a, b) =>
    {
        const start = comparePosition(a.range.start, b.range.start);
        if (start !== 0)
            return start;
        return comparePosition(b.range.end, a.range.end);
    });
    return chain;
}

/** 该位置正在声明的符号（位置落在其名字上）；扁平列表没有 selectionRange 时按名字匹配。 */
export function declaredSymbolAt(chain: readonly SymbolNode[], position: Position, word: string): SymbolNode | undefined
{
    for (let i = chain.length - 1; i >= 0; i--)
    {
        const node = chain[i];
        if (node.selectionRange)
        {
            if (rangeContains(node.selectionRange, position))
                return node;
        }
        else if (word && bareName(node.name) === word && node.range.start.line === position.line)
            return node;
    }
    return undefined;
}

export interface Containers
{
    member: string;
    type: string;
}

/** 包含成员与包含类型；正在声明的符号自身不算包含者，嵌套类型用点连接。 */
export function containersAt(roots: readonly SymbolNode[], position: Position, word: string): Containers
{
    const chain = symbolChainAt(roots, position);
    const declared = declaredSymbolAt(chain, position, word);
    const enclosing = chain.filter(node => node !== declared);
    const types = enclosing.filter(node => isTypeKind(node.kind)).map(node => bareName(node.name));
    let member = '';
    for (let i = enclosing.length - 1; i >= 0; i--)
    {
        if (isMemberKind(enclosing[i].kind))
        {
            member = plainName(enclosing[i].name);
            break;
        }
    }
    return { member, type: types.join('.') };
}

export interface DefinitionLabel
{
    label: string;
    kind: number | undefined;
}

/** 定义分组的标题：类型写「struct HumanoidMotion」，成员写「PresentationHumanoid.Evaluate(...)」。 */
export function definitionLabelAt(roots: readonly SymbolNode[], position: Position, word: string): DefinitionLabel
{
    const chain = symbolChainAt(roots, position);
    const declared = declaredSymbolAt(chain, position, word);
    if (!declared)
        return { label: word, kind: undefined };
    const outerTypes = chain
        .slice(0, chain.indexOf(declared))
        .filter(node => isTypeKind(node.kind))
        .map(node => bareName(node.name));
    const keyword = typeKeywords.get(declared.kind);
    if (keyword)
        return { label: `${keyword} ${[...outerTypes, declared.name].join('.')}`, kind: declared.kind };
    return { label: [...outerTypes, declared.name].join('.'), kind: declared.kind };
}
