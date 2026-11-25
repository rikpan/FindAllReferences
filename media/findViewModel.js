// @ts-check
// 「查找结果」窗口的视图模型：列定义、范围、分组方式与描述行；通用逻辑在 listModel.js。
// 纯函数，Webview 里挂在 window.FindViewModel，node 测试里用 require。
(function (root, factory)
{
    const node = typeof module === 'object' && module.exports;
    const api = node
        ? factory(require('./i18n.js'), require('./listModel.js'))
        : factory(root.ReferencesStrings, root.ResultsListModel);
    if (node)
        module.exports = api;
    else
        root.FindViewModel = api;
})(typeof self !== 'undefined' ? self : this, function (I18N, List)
{
    'use strict';

    /** 查找范围（发起查找时搜哪些文件）；与结果的筛选范围不同。 */
    const LOOK_IN = ['workspace', 'open', 'document', 'folder'];

    const model = List.createModel({
        prefix: 'find.',
        columns: [
            { id: 'code', width: 620, visible: true, value: item => item.code.trim() },
            { id: 'file', width: 220, visible: true, filterable: true, value: item => item.fileName },
            { id: 'line', width: 56, visible: true, numeric: true, value: item => item.line + 1 },
            { id: 'column', width: 48, visible: true, numeric: true, value: item => item.column + 1 },
            { id: 'project', width: 170, visible: true, filterable: true, value: (item, api) => I18N.projectLabel(api.getLocale(), item.project) },
            { id: 'path', width: 360, visible: false, filterable: true, value: item => item.relativePath },
        ],
        scopes: [
            { id: 'solution' },
            { id: 'open' },
            { id: 'document' },
            { id: 'project' },
            { id: 'changed' },
        ],
        // 与 Visual Studio「查找结果」一致：默认按路径逐级分到文件夹，再到文件
        groupings: [
            { id: 'path-file', levels: ['path', 'file'] },
            { id: 'project-file', levels: ['project', 'filepath'] },
            { id: 'project-path-file', levels: ['project', 'path', 'file'] },
            { id: 'file', levels: ['filepath'] },
        ],
        groupSegments(item, field, result, api)
        {
            switch (field)
            {
                case 'path':
                    return [{ value: item.root, icon: '' }].concat(item.dirs.map(dir => ({ value: dir, icon: '' })));
                case 'file':
                    // 同一文件夹下子文件夹排在文件前面
                    return [{ value: item.fileName, icon: '', order: 1 }];
                case 'filepath':
                    return [{ value: item.relativePath, icon: '' }];
                default:
                    return [{ value: I18N.projectLabel(api.getLocale(), item.project) || api.t('blank'), icon: '' }];
            }
        },
        codeParts(item)
        {
            return List.highlightParts(item.code, item.matches);
        },
    });

    const t = model.t;

    /** 结果上方的描述行，仿 VS：全部查找"X"，区分大小写，整个工作区，包含"*.cs"，排除"…"。 */
    function describe(result)
    {
        const options = result.options || {};
        const parts = [t('describe.all', result.symbol)];
        if (options.matchCase)
            parts.push(t('describe.matchCase'));
        if (options.wholeWord)
            parts.push(t('describe.wholeWord'));
        if (options.regex)
            parts.push(t('describe.regex'));
        parts.push(t('lookIn.' + (LOOK_IN.indexOf(options.lookIn) >= 0 ? options.lookIn : 'workspace')));
        if (options.include)
            parts.push(t('describe.include', options.include));
        if (options.exclude)
            parts.push(t('describe.exclude', options.exclude));
        if (options.useExcludeSettings === false)
            parts.push(t('describe.noExcludes'));
        return parts.join(t('describe.separator'));
    }

    /** 底部统计：匹配行、匹配文件、搜索的文件总数。 */
    function summary(result)
    {
        const files = new Set(result.items.map(item => item.fileKey)).size;
        const searched = result.summary ? result.summary.searched : files;
        return t('footer', result.items.length, files, searched);
    }

    /** 底部统计后面的提醒：结果被截断或查找被停止。 */
    function notice(result)
    {
        if (!result.summary)
            return '';
        if (result.summary.stopped)
            return t('footer.stopped');
        if (result.summary.truncated)
            return t('footer.truncated', result.items.length);
        return '';
    }

    return Object.assign(model, { LOOK_IN, describe, summary, notice });
});
