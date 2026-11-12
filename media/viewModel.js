// @ts-check
// 结果窗口的视图模型：列定义、范围、筛选、排序、分组、复制文本。
// 纯函数，Webview 里挂在 window.ReferencesViewModel，node 测试里用 require。
(function (root, factory)
{
    const api = factory(typeof module === 'object' && module.exports ? require('./i18n.js') : root.ReferencesStrings);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.ReferencesViewModel = api;
})(typeof self !== 'undefined' ? self : this, function (I18N)
{
    'use strict';

    /** 当前界面语言，由 setLocale 切换；标题、类别、特殊项目名都按它显示。 */
    let locale = 'zh-cn';

    /** @param {string} key @param {...(string | number)} args */
    function t(key, ...args)
    {
        return I18N.t(locale, key, ...args);
    }

    /** @param {string} next */
    function setLocale(next)
    {
        locale = I18N.LOCALES.indexOf(next) >= 0 ? next : 'zh-cn';
    }

    function getLocale()
    {
        return locale;
    }

    /** 给定义对象加上随语言变化的 title。 */
    function titled(prefix, list)
    {
        for (const entry of list)
            Object.defineProperty(entry, 'title', { get: () => t(prefix + entry.id), enumerable: true });
        return list;
    }

    function compareLocale(a, b)
    {
        return a.localeCompare(b, t('collator'));
    }

    /** @type {{ id: string, title: string, width: number, visible: boolean, numeric?: boolean, filterable?: boolean, value: (item: any) => string | number }[]} */
    const COLUMNS = titled('column.', /** @type {any[]} */ ([
        { id: 'code', width: 460, visible: true, value: item => item.code.trim() },
        { id: 'file', width: 220, visible: true, filterable: true, value: item => item.fileName },
        { id: 'line', width: 56, visible: true, numeric: true, value: item => item.line + 1 },
        { id: 'column', width: 48, visible: true, numeric: true, value: item => item.column + 1 },
        { id: 'project', width: 170, visible: true, filterable: true, value: item => I18N.projectLabel(locale, item.project) },
        { id: 'member', width: 190, visible: true, filterable: true, value: item => item.member },
        { id: 'type', width: 190, visible: true, filterable: true, value: item => item.type },
        { id: 'kind', width: 90, visible: true, filterable: true, value: item => I18N.kindLabel(locale, item.kind) },
        { id: 'repository', width: 110, visible: true, filterable: true, value: item => item.repository },
        { id: 'path', width: 360, visible: false, filterable: true, value: item => item.relativePath },
    ]));

    /** @type {{ id: string, title: string }[]} */
    const SCOPES = titled('scope.', /** @type {any[]} */ ([
        { id: 'solution' },
        { id: 'project' },
        { id: 'document' },
        { id: 'open' },
        { id: 'changed' },
    ]));

    /** 分组依据：每项是由外到内的分组字段。 */
    /** @type {{ id: string, title: string, levels: string[] }[]} */
    const GROUPINGS = titled('group.', /** @type {any[]} */ ([
        { id: 'project-definition', levels: ['project', 'definition'] },
        { id: 'definition', levels: ['definition'] },
        { id: 'definition-project', levels: ['definition', 'project'] },
        { id: 'definition-path', levels: ['definition', 'path'] },
        { id: 'definition-project-path', levels: ['definition', 'project', 'path'] },
    ]));

    function column(id)
    {
        return COLUMNS.find(candidate => candidate.id === id);
    }

    function columnText(item, columnId)
    {
        const definition = column(columnId);
        return definition ? String(definition.value(item)) : '';
    }

    /** 列筛选里的显示值：空串显示为「(空白)」。 */
    function filterValue(item, columnId)
    {
        return columnText(item, columnId) || t('blank');
    }

    function defaultCompare(a, b)
    {
        return compareText(a.relativePath, b.relativePath) || a.line - b.line || a.column - b.column;
    }

    function compareText(a, b)
    {
        return a < b ? -1 : a > b ? 1 : 0;
    }

    /** @param {{ column: string, descending: boolean } | null | undefined} sort */
    function sortItems(items, sort)
    {
        const sorted = items.slice();
        const definition = sort ? column(sort.column) : undefined;
        if (!sort || !definition)
            return sorted.sort(defaultCompare);
        const direction = sort.descending ? -1 : 1;
        return sorted.sort((a, b) =>
        {
            const left = definition.value(a);
            const right = definition.value(b);
            const primary = definition.numeric
                ? Number(left) - Number(right)
                : compareLocale(String(left), String(right));
            return primary * direction || defaultCompare(a, b);
        });
    }

    function inScope(item, scope, context, result)
    {
        switch (scope)
        {
            case 'project':
                return item.project === (context.activeProject || result.originProject);
            case 'document':
                return item.fileKey === (context.activeFileKey || result.originFileKey);
            case 'open':
                return context.openFileKeys.indexOf(item.fileKey) >= 0;
            case 'changed':
                return context.changedFileKeys.indexOf(item.fileKey) >= 0;
            default:
                return true;
        }
    }

    /**
     * @param {any[]} items
     * @param {{ scope: string, context: any, result: any, filters: Record<string, string[] | undefined>, search: string, skipFilter?: string }} options
     */
    function filterItems(items, options)
    {
        const context = options.context || { activeFileKey: '', activeProject: '', openFileKeys: [], changedFileKeys: [] };
        const result = options.result || { originProject: '', originFileKey: '' };
        const filters = [];
        for (const id of Object.keys(options.filters || {}))
        {
            const allowed = options.filters[id];
            if (allowed && id !== options.skipFilter)
                filters.push({ id, allowed: new Set(allowed) });
        }
        const search = (options.search || '').trim().toLowerCase();
        return items.filter(item =>
        {
            if (!inScope(item, options.scope, context, result))
                return false;
            for (const filter of filters)
            {
                if (!filter.allowed.has(filterValue(item, filter.id)))
                    return false;
            }
            if (!search)
                return true;
            return COLUMNS.some(definition => String(definition.value(item)).toLowerCase().indexOf(search) >= 0);
        });
    }

    /** 列筛选弹框里的候选值及计数，按值排序。 */
    function distinctValues(items, columnId)
    {
        const counts = new Map();
        for (const item of items)
        {
            const value = filterValue(item, columnId);
            counts.set(value, (counts.get(value) || 0) + 1);
        }
        return Array.from(counts, ([value, count]) => ({ value, count }))
            .sort((a, b) => compareLocale(a.value, b.value));
    }

    function groupValue(item, field, result)
    {
        switch (field)
        {
            case 'project':
                return I18N.projectLabel(locale, item.project) || t('blank');
            case 'path':
                return item.relativePath;
            default:
                return result.definition.label;
        }
    }

    function groupIcon(field, result)
    {
        switch (field)
        {
            case 'project':
                return 'project';
            case 'path':
                return 'file';
            default:
                return result.definition.icon;
        }
    }

    /**
     * 生成可见行。分组行带下属全部条目（items），折叠时也能复制。
     * @param {any[]} items 已筛选、已排序的条目
     * @param {{ groupBy: string, listView: boolean, result: any, collapsed: Set<string> | string[] }} options
     */
    function buildRows(items, options)
    {
        if (options.listView)
            return items.map(item => ({ type: 'item', key: 'i:' + item.id, level: 0, item }));
        const grouping = GROUPINGS.find(candidate => candidate.id === options.groupBy) || GROUPINGS[0];
        const collapsed = options.collapsed instanceof Set ? options.collapsed : new Set(options.collapsed || []);
        const rows = [];
        const visit = (subset, depth, parentKey) =>
        {
            if (depth === grouping.levels.length)
            {
                for (const item of subset)
                    rows.push({ type: 'item', key: 'i:' + item.id, level: depth, item });
                return;
            }
            const field = grouping.levels[depth];
            const buckets = new Map();
            for (const item of subset)
            {
                const value = groupValue(item, field, options.result);
                let bucket = buckets.get(value);
                if (!bucket)
                {
                    bucket = [];
                    buckets.set(value, bucket);
                }
                bucket.push(item);
            }
            const values = Array.from(buckets.keys()).sort(compareLocale);
            for (const value of values)
            {
                const key = parentKey + '/' + field + ':' + value;
                const bucket = buckets.get(value);
                const expanded = !collapsed.has(key);
                rows.push({
                    type: 'group',
                    key,
                    level: depth,
                    field,
                    label: value,
                    icon: groupIcon(field, options.result),
                    count: bucket.length,
                    expanded,
                    items: bucket,
                });
                if (expanded)
                    visit(bucket, depth + 1, key);
            }
        };
        visit(items, 0, 'g');
        return rows;
    }

    /** 全部分组键，用于「全部折叠」。 */
    function allGroupKeys(items, options)
    {
        return buildRows(items, Object.assign({}, options, { listView: false, collapsed: [] }))
            .filter(row => row.type === 'group')
            .map(row => row.key);
    }

    /** 选中行展开成条目：选中分组等于选中其下全部条目，去重并保持行序。 */
    function selectedItems(rows, selectedKeys)
    {
        const selected = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys);
        const seen = new Set();
        const items = [];
        for (const row of rows)
        {
            if (!selected.has(row.key))
                continue;
            for (const item of row.type === 'group' ? row.items : [row.item])
            {
                if (seen.has(item.id))
                    continue;
                seen.add(item.id);
                items.push(item);
            }
        }
        return items;
    }

    /** 复制文本：表头加制表符分隔的行，列按当前可见列。 */
    function formatCopy(items, columnIds)
    {
        const header = columnIds.map(id => (column(id) || { title: id }).title).join('\t');
        const lines = items.map(item => columnIds.map(id => columnText(item, id)).join('\t'));
        return [header].concat(lines).join('\n');
    }

    /** 代码列显示：去掉行首缩进，过长时从匹配处前截断，返回前、中、后三段。 */
    function codeSegments(code, start, end, maxPrefix)
    {
        const limit = maxPrefix === undefined ? 120 : maxPrefix;
        const indent = code.length - code.replace(/^\s+/, '').length;
        let from = Math.min(indent, start);
        let ellipsis = '';
        if (start - from > limit)
        {
            from = start - Math.floor(limit / 2);
            ellipsis = '…';
        }
        const matchEnd = Math.max(start, Math.min(end, code.length));
        return {
            prefix: ellipsis + code.slice(from, start),
            match: code.slice(start, matchEnd),
            suffix: code.slice(matchEnd).replace(/\s+$/, ''),
        };
    }

    function resultTitle(result, scope)
    {
        const scopeInfo = SCOPES.find(candidate => candidate.id === scope) || SCOPES[0];
        return t('resultTitle', result.symbol, scopeInfo.title);
    }

    return {
        COLUMNS,
        SCOPES,
        GROUPINGS,
        t,
        setLocale,
        getLocale,
        columnText,
        filterValue,
        sortItems,
        filterItems,
        distinctValues,
        buildRows,
        allGroupKeys,
        selectedItems,
        formatCopy,
        codeSegments,
        resultTitle,
    };
});
