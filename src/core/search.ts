// 「在文件中查找」的纯函数部分：查找条件、行内匹配、ripgrep 参数与输出解析。不依赖 vscode，便于单元测试。

export type LookIn = 'workspace' | 'open' | 'document' | 'folder';

export interface FindOptions
{
    query: string;
    matchCase: boolean;
    wholeWord: boolean;
    regex: boolean;
    lookIn: LookIn;
    /** 逗号分隔的 glob，与 VS Code 搜索视图的「包含的文件」相同。 */
    include: string;
    exclude: string;
    /** 是否应用 files.exclude／search.exclude 与 .gitignore 等忽略文件。 */
    useExcludeSettings: boolean;
}

export const defaultFindOptions: FindOptions = {
    query: '',
    matchCase: false,
    wholeWord: false,
    regex: false,
    lookIn: 'workspace',
    include: '',
    exclude: '',
    useExcludeSettings: true,
};

const lookInValues: LookIn[] = ['workspace', 'open', 'document', 'folder'];

/** 把 Webview 发来的任意值整理成合法的查找条件。 */
export function normalizeFindOptions(value: unknown): FindOptions
{
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const text = (key: string) => (typeof raw[key] === 'string' ? raw[key] as string : '');
    return {
        query: text('query'),
        matchCase: raw.matchCase === true,
        wholeWord: raw.wholeWord === true,
        regex: raw.regex === true,
        lookIn: lookInValues.includes(raw.lookIn as LookIn) ? raw.lookIn as LookIn : 'workspace',
        include: text('include').trim(),
        exclude: text('exclude').trim(),
        useExcludeSettings: raw.useExcludeSettings !== false,
    };
}

/** 逗号分隔的 glob 列表；花括号内的逗号不拆（如 *.{cs,shader}）。 */
export function splitGlobs(text: string): string[]
{
    const globs: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of text)
    {
        if (char === '{')
            depth++;
        else if (char === '}')
            depth = Math.max(0, depth - 1);
        if (char === ',' && depth === 0)
        {
            globs.push(current);
            current = '';
        }
        else
            current += char;
    }
    globs.push(current);
    return globs.map(glob => glob.trim()).filter(glob => glob.length > 0);
}

/**
 * 与 VS Code 搜索视图相同的写法：不以 ./ 开头的模式匹配任意层级（*.cs → **\/*.cs），
 * 以 ./ 开头的模式相对于搜索根；反斜杠统一成斜杠。
 * 每个模式另加一个 /** 变体，写文件夹名即匹配其下全部文件。
 */
export function globVariants(glob: string): string[]
{
    let pattern = glob.replace(/\\/g, '/').replace(/\/+$/, '');
    if (pattern.startsWith('./'))
        pattern = pattern.slice(2);
    else if (pattern.startsWith('/'))
        pattern = pattern.slice(1);
    else if (pattern && !pattern.startsWith('**/') && pattern !== '**')
        pattern = '**/' + pattern;
    if (!pattern)
        return [];
    return pattern.endsWith('**') ? [pattern] : [pattern, pattern + '/**'];
}

/** files.exclude／search.exclude 设置里取值为 true 的模式（带 when 条件的对象跳过）。 */
export function enabledExcludes(...settings: (Record<string, unknown> | undefined)[]): string[]
{
    const patterns = new Set<string>();
    for (const setting of settings)
    {
        for (const [pattern, enabled] of Object.entries(setting ?? {}))
        {
            if (enabled === true)
                patterns.add(pattern);
        }
    }
    return [...patterns];
}

function escapeRegExp(text: string): string
{
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** JS 正则（用于未保存的文档与没有 ripgrep 时的内置搜索）；正则写错时抛出 SyntaxError。 */
export function buildMatcher(options: Pick<FindOptions, 'query' | 'matchCase' | 'wholeWord' | 'regex'>): RegExp
{
    let source = options.regex ? options.query : escapeRegExp(options.query);
    if (options.wholeWord)
        source = `(?<!\\w)(?:${source})(?!\\w)`;
    return new RegExp(source, options.matchCase ? 'g' : 'gi');
}

/** 一行内的全部匹配区间 [起, 止)，以 UTF-16 列计；空匹配跳过。 */
export function matchLine(matcher: RegExp, line: string): [number, number][]
{
    const ranges: [number, number][] = [];
    matcher.lastIndex = 0;
    for (;;)
    {
        const match = matcher.exec(line);
        if (!match)
            break;
        if (match[0].length === 0)
        {
            matcher.lastIndex++;
            if (matcher.lastIndex > line.length)
                break;
            continue;
        }
        ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
}

export interface TextMatch
{
    line: number;
    text: string;
    ranges: [number, number][];
}

/** 在整段文本里逐行查找。 */
export function searchText(text: string, matcher: RegExp, limit = Infinity): TextMatch[]
{
    const matches: TextMatch[] = [];
    const lines = text.split(/\r\n|\r|\n/);
    for (let index = 0; index < lines.length && matches.length < limit; index++)
    {
        const ranges = matchLine(matcher, lines[index]);
        if (ranges.length > 0)
            matches.push({ line: index, text: lines[index], ranges });
    }
    return matches;
}

export interface RipgrepArgsOptions
{
    includes: string[];
    excludes: string[];
    /** 是否遵循 .gitignore／.ignore 等忽略文件（search.useIgnoreFiles）。 */
    useIgnoreFiles: boolean;
    followSymlinks: boolean;
}

/** ripgrep 命令行；在搜索根目录下以 "." 为路径运行，输出 JSON。 */
export function ripgrepArgs(options: FindOptions, extra: RipgrepArgsOptions): string[]
{
    const args = ['--json', '--no-config', '--hidden', '--crlf', '--no-messages'];
    args.push(options.matchCase ? '--case-sensitive' : '--ignore-case');
    if (options.wholeWord)
        args.push('--word-regexp');
    if (options.regex)
        args.push('--engine', 'auto');
    else
        args.push('--fixed-strings');
    if (!extra.useIgnoreFiles)
        args.push('--no-ignore');
    else
        args.push('--no-ignore-parent');
    if (extra.followSymlinks)
        args.push('--follow');
    for (const glob of extra.includes)
    {
        for (const variant of globVariants(glob))
            args.push('-g', variant);
    }
    for (const glob of extra.excludes)
    {
        for (const variant of globVariants(glob))
            args.push('-g', '!' + variant);
    }
    args.push('--regexp', options.query, '--', '.');
    return args;
}

/** ripgrep JSON 里的文本：UTF-8 时是 text，否则是 base64 的 bytes。 */
function decodeData(data: { text?: string; bytes?: string } | undefined): string
{
    if (!data)
        return '';
    if (typeof data.text === 'string')
        return data.text;
    return typeof data.bytes === 'string' ? Buffer.from(data.bytes, 'base64').toString('utf8') : '';
}

/** UTF-8 字节偏移换算成 UTF-16 列。 */
export function byteToColumn(text: string, byteOffset: number): number
{
    if (/^[\x00-\x7f]*$/.test(text))
        return Math.min(byteOffset, text.length);
    return Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8').length;
}

export type RipgrepEvent =
    | { type: 'match'; path: string; match: TextMatch }
    | { type: 'summary'; searched: number };

/** 解析 ripgrep --json 的一行；不关心的消息返回 undefined。行号转成 0 起，跨行匹配只取首行。 */
export function parseRipgrepLine(line: string): RipgrepEvent | undefined
{
    if (!line.trim())
        return undefined;
    let message: any;
    try
    {
        message = JSON.parse(line);
    }
    catch
    {
        return undefined;
    }
    if (message.type === 'summary')
        return { type: 'summary', searched: Number(message.data?.stats?.searches ?? 0) };
    if (message.type !== 'match')
        return undefined;
    const data = message.data;
    const fullText = decodeData(data.lines);
    const text = fullText.split(/\r?\n/)[0];
    const firstLineBytes = Buffer.byteLength(text, 'utf8');
    const ranges: [number, number][] = [];
    for (const submatch of data.submatches ?? [])
    {
        if (submatch.start > firstLineBytes)
            continue;
        const start = byteToColumn(text, submatch.start);
        const end = byteToColumn(text, Math.min(submatch.end, firstLineBytes));
        if (end > start)
            ranges.push([start, end]);
    }
    if (ranges.length === 0)
        return undefined;
    return {
        type: 'match',
        path: decodeData(data.path),
        match: { line: Number(data.line_number) - 1, text, ranges },
    };
}

/** 很长的行（如压缩过的脚本）只保留前一段，避免结果过大。 */
export function clampLine(match: TextMatch, maxLength = 2000): TextMatch
{
    if (match.text.length <= maxLength)
        return match;
    const ranges = match.ranges.filter(range => range[0] < maxLength).map(range => [range[0], Math.min(range[1], maxLength)] as [number, number]);
    return { line: match.line, text: match.text.slice(0, maxLength), ranges: ranges.length > 0 ? ranges : [match.ranges[0]] };
}
