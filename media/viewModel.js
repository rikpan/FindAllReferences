// @ts-check
// 「查找所有引用」窗口的视图模型：列定义、范围、分组方式；通用逻辑在 listModel.js。
// 纯函数，Webview 里挂在 window.ReferencesViewModel，node 测试里用 require。
(function (root, factory)
{
    const node = typeof module === 'object' && module.exports;
    const api = node
        ? factory(require('./i18n.js'), require('./listModel.js'))
        : factory(root.ReferencesStrings, root.ResultsListModel);
    if (node)
        module.exports = api;
    else
        root.ReferencesViewModel = api;
})(typeof self !== 'undefined' ? self : this, function (I18N, List)
{
    'use strict';

    const model = List.createModel({
        columns: [
            { id: 'code', width: 460, visible: true, value: item => item.code.trim() },
            { id: 'file', width: 220, visible: true, filterable: true, value: item => item.fileName },
            { id: 'line', width: 56, visible: true, numeric: true, value: item => item.line + 1 },
            { id: 'column', width: 48, visible: true, numeric: true, value: item => item.column + 1 },
            { id: 'project', width: 170, visible: true, filterable: true, value: (item, api) => I18N.projectLabel(api.getLocale(), item.project) },
            { id: 'member', width: 190, visible: true, filterable: true, value: item => item.member },
            { id: 'type', width: 190, visible: true, filterable: true, value: item => item.type },
            { id: 'kind', width: 90, visible: true, filterable: true, value: (item, api) => I18N.kindLabel(api.getLocale(), item.kind) },
            { id: 'repository', width: 110, visible: true, filterable: true, value: item => item.repository },
            { id: 'path', width: 360, visible: false, filterable: true, value: item => item.relativePath },
        ],
        scopes: [
            { id: 'solution' },
            { id: 'project' },
            { id: 'document' },
            { id: 'open' },
            { id: 'changed' },
        ],
        // 分组依据：每项是由外到内的分组字段
        groupings: [
            { id: 'project-definition', levels: ['project', 'definition'] },
            { id: 'definition', levels: ['definition'] },
            { id: 'definition-project', levels: ['definition', 'project'] },
            { id: 'definition-path', levels: ['definition', 'path'] },
            { id: 'definition-project-path', levels: ['definition', 'project', 'path'] },
        ],
        groupSegments(item, field, result, api)
        {
            switch (field)
            {
                case 'project':
                    return [{ value: I18N.projectLabel(api.getLocale(), item.project) || api.t('blank'), icon: '' }];
                case 'path':
                    return [{ value: item.relativePath, icon: 'file' }];
                default:
                    return [{ value: result.definition.label, icon: result.definition.icon }];
            }
        },
        codeParts(item)
        {
            return List.highlightParts(item.code, [[item.column, item.endColumn]]);
        },
    });

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

    return Object.assign(model, { codeSegments });
});
