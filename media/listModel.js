// @ts-check
// 结果窗口通用的视图模型内核：范围、筛选、排序、分组、复制文本。
// 「查找所有引用」与「查找结果」各自提供列、分组方式等定义，由 createModel 组装。
// 纯函数，Webview 里挂在 window.ResultsListModel，node 测试里用 require。
(function (root, factory)
{
    const api = factory(typeof module === 'object' && module.exports ? require('./i18n.js') : root.ReferencesStrings);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.ResultsListModel = api;
})(typeof self !== 'undefined' ? self : this, function (I18N)
{
    'use strict';

    function compareText(a, b)
    {
        return a < b ? -1 : a > b ? 1 : 0;
    }

    /**
     * @typedef {{ value: string, icon: string, order?: number }} GroupSegment
     * @typedef {{
     *   prefix?: string,
     *   columns: any[],
     *   scopes: { id: string }[],
     *   groupings: { id: string, levels: string[] }[],
     *   groupSegments: (item: any, field: string, result: any, api: any) => GroupSegment[],
     *   codeParts: (item: any) => { text: string, match: boolean }[],
     * }} ModelSpec
     */

    /** @param {ModelSpec} spec */
    function createModel(spec)
    {
        /** 当前界面语言，由 setLocale 切换。 */
        let locale = 'zh-cn';
        const prefix = spec.prefix || '';

        /**
         * 带前缀的键优先（如 find.resultTitle），没有时用通用键。
         * @param {string} key @param {...(string | number)} args
         */
        function t(key, ...args)
        {
            if (prefix && (prefix + key) in I18N.TABLES.en)
                return I18N.t(locale, prefix + key, ...args);
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
        function titled(keyPrefix, list)
        {
            for (const entry of list)
                Object.defineProperty(entry, 'title', { get: () => t(keyPrefix + entry.id), enumerable: true });
            return list;
        }

        const COLUMNS = titled('column.', spec.columns);
        const SCOPES = titled('scope.', spec.scopes);
        const GROUPINGS = titled('group.', spec.groupings);

        function compareLocale(a, b)
        {
            return a.localeCompare(b, t('collator'));
        }

        function column(id)
        {
            return COLUMNS.find(candidate => candidate.id === id);
        }

        function columnText(item, columnId)
        {
            const definition = column(columnId);
            return definition ? String(definition.value(item, api)) : '';
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
                const left = definition.value(a, api);
                const right = definition.value(b, api);
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
                return COLUMNS.some(definition => String(definition.value(item, api)).toLowerCase().indexOf(search) >= 0);
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

        /** 条目在当前分组方式下由外到内的分组路径；路径长度可以因条目而异（如按文件夹层级）。 */
        function groupPath(item, grouping, result)
        {
            const path = [];
            for (const field of grouping.levels)
            {
                for (const segment of spec.groupSegments(item, field, result, api))
                    path.push({ field, value: segment.value, icon: segment.icon, order: segment.order || 0 });
            }
            return path;
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
            const paths = new Map(items.map(item => [item, groupPath(item, grouping, options.result)]));
            const rows = [];
            const visit = (subset, depth, parentKey) =>
            {
                const buckets = new Map();
                for (const item of subset)
                {
                    const path = paths.get(item);
                    if (depth >= path.length)
                    {
                        rows.push({ type: 'item', key: 'i:' + item.id, level: depth, item });
                        continue;
                    }
                    const segment = path[depth];
                    const id = segment.field + ':' + segment.value;
                    let bucket = buckets.get(id);
                    if (!bucket)
                    {
                        bucket = { segment, items: [] };
                        buckets.set(id, bucket);
                    }
                    bucket.items.push(item);
                }
                const ordered = Array.from(buckets.values())
                    .sort((a, b) => a.segment.order - b.segment.order || compareLocale(a.segment.value, b.segment.value));
                for (const bucket of ordered)
                {
                    const segment = bucket.segment;
                    const key = parentKey + '/' + segment.field + ':' + segment.value;
                    const expanded = !collapsed.has(key);
                    rows.push({
                        type: 'group',
                        key,
                        level: depth,
                        field: segment.field,
                        label: segment.value,
                        icon: segment.icon,
                        count: bucket.items.length,
                        expanded,
                        items: bucket.items,
                    });
                    if (expanded)
                        visit(bucket.items, depth + 1, key);
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

        function resultTitle(result, scope)
        {
            const scopeInfo = SCOPES.find(candidate => candidate.id === scope) || SCOPES[0];
            return t('resultTitle', result.symbol, scopeInfo.title);
        }

        const api = {
            I18N,
            COLUMNS,
            SCOPES,
            GROUPINGS,
            t,
            setLocale,
            getLocale,
            compareLocale,
            columnText,
            filterValue,
            sortItems,
            filterItems,
            distinctValues,
            buildRows,
            allGroupKeys,
            selectedItems,
            formatCopy,
            resultTitle,
            codeParts: spec.codeParts,
        };
        return api;
    }

    /**
     * 代码列显示：去掉行首缩进，过长时从首个匹配处前截断；ranges 为 [起, 止) 列表（按起点升序），
     * 返回交替的普通段与匹配段。
     * @param {string} code
     * @param {number[][]} ranges
     * @param {number} [maxPrefix]
     */
    function highlightParts(code, ranges, maxPrefix)
    {
        const limit = maxPrefix === undefined ? 120 : maxPrefix;
        const first = ranges.length > 0 ? ranges[0][0] : code.length;
        const indent = code.length - code.replace(/^\s+/, '').length;
        let from = Math.min(indent, first);
        let ellipsis = '';
        if (first - from > limit)
        {
            from = first - Math.floor(limit / 2);
            ellipsis = '…';
        }
        const parts = [];
        let cursor = from;
        for (const range of ranges)
        {
            const start = Math.max(cursor, Math.min(range[0], code.length));
            const end = Math.max(start, Math.min(range[1], code.length));
            if (start > cursor || parts.length === 0)
                parts.push({ text: (parts.length === 0 ? ellipsis : '') + code.slice(cursor, start), match: false });
            if (end > start)
                parts.push({ text: code.slice(start, end), match: true });
            cursor = end;
        }
        parts.push({ text: code.slice(cursor).replace(/\s+$/, ''), match: false });
        return parts;
    }

    return { createModel, highlightParts, compareText };
});
