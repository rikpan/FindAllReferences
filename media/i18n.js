// @ts-check
// 界面字符串表（中文／英文）。扩展端与 Webview 共用同一份：
// Webview 里挂在 window.ReferencesStrings，node 里用 require。
(function (root, factory)
{
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.ReferencesStrings = api;
})(typeof self !== 'undefined' ? self : this, function ()
{
    'use strict';

    const LOCALES = ['zh-cn', 'en'];

    /** 「类别」列与特殊项目名按 ID 存储，显示时再翻译，切换语言后已有结果也随之变化。 */
    const TABLES = {
        'zh-cn': {
            collator: 'zh-CN',
            blank: '(空白)',
            'column.code': '代码',
            'column.file': '文件',
            'column.line': '行',
            'column.column': '列',
            'column.project': '项目',
            'column.member': '包含成员',
            'column.type': '包含类型',
            'column.kind': '类别',
            'column.repository': '存储库',
            'column.path': '路径',
            'scope.solution': '整个解决方案',
            'scope.project': '当前项目',
            'scope.document': '当前文档',
            'scope.open': '打开的文档',
            'scope.changed': '已更改的文档',
            'group.project-definition': '项目，然后是定义',
            'group.definition': '仅定义',
            'group.definition-project': '定义，然后是项目',
            'group.definition-path': '定义，然后是路径',
            'group.definition-project-path': '定义、项目，然后是路径',
            'kind.definition': '定义',
            'kind.read': '读取',
            'kind.write': '写入',
            'kind.readWrite': '读取/写入',
            'kind.qualified': '合格',
            'kind.typeArgument': '类型参数',
            'kind.typeConstraint': '类型约束',
            'kind.baseType': '基',
            'kind.objectCreation': '对象创建',
            'kind.importing': '导入',
            'kind.name': '名称',
            'project.miscellaneous': '杂项文件',
            'project.external': '外部文件',
            resultTitle: '"{0}"引用 - {1}',
            viewTitle: '查找所有引用',
            'toolbar.scope': '搜索范围',
            'toolbar.copy': '复制 (Ctrl+C)',
            'toolbar.expandAll': '全部展开',
            'toolbar.collapseAll': '全部折叠',
            'toolbar.clearFilters': '清除所有筛选器',
            'toolbar.groupBy': '分组依据:',
            'toolbar.groupByTitle': '分组依据',
            'toolbar.keep': '保留结果(K)',
            'toolbar.keepTitle': '保留结果：下次查找在新页签中显示 (Alt+K)',
            'toolbar.listView': '列表视图(L)',
            'toolbar.listViewTitle': '在树视图与列表视图之间切换 (Alt+L)',
            'toolbar.search': '搜索查找所有引用',
            'tab.kept': '已保留',
            'tab.close': '关闭',
            'header.filter': '筛选',
            'status.filtered': '显示 {0} 项，共 {1} 项',
            'empty.hint': '把光标放在符号上，按 Shift+F12，或在编辑器右键菜单中选择「查找所有引用（VS 风格）」。',
            'empty.noReferences': '未找到"{0}"的引用。',
            'empty.noResults': '当前范围或筛选条件下没有结果。',
            'popup.search': '搜索',
            'popup.selectAll': '(全选)',
            'popup.ok': '确定',
            'popup.cancel': '取消',
            'menu.resetColumns': '重置列',
            'menu.goTo': '转到',
            'menu.collapse': '折叠',
            'menu.expand': '展开',
            'menu.copy': '复制',
            'menu.expandAll': '全部展开',
            'menu.collapseAll': '全部折叠',
            'message.placeCursor': '请先把光标放在要查找引用的符号上。',
            'message.loading': '正在查找"{0}"的引用…',
            'message.findFailed': '查找所有引用失败：{0}',
            'message.openFailed': '无法打开引用所在文件：{0}',
        },
        en: {
            collator: 'en',
            blank: '(Blank)',
            'column.code': 'Code',
            'column.file': 'File',
            'column.line': 'Line',
            'column.column': 'Column',
            'column.project': 'Project',
            'column.member': 'Containing Member',
            'column.type': 'Containing Type',
            'column.kind': 'Kind',
            'column.repository': 'Repository',
            'column.path': 'Path',
            'scope.solution': 'Entire Solution',
            'scope.project': 'Current Project',
            'scope.document': 'Current Document',
            'scope.open': 'Open Documents',
            'scope.changed': 'Changed Documents',
            'group.project-definition': 'Project then Definition',
            'group.definition': 'Definition Only',
            'group.definition-project': 'Definition then Project',
            'group.definition-path': 'Definition then Path',
            'group.definition-project-path': 'Definition, Project then Path',
            'kind.definition': 'Definition',
            'kind.read': 'Read',
            'kind.write': 'Write',
            'kind.readWrite': 'Read/Write',
            'kind.qualified': 'Qualified',
            'kind.typeArgument': 'Type Argument',
            'kind.typeConstraint': 'Type Constraint',
            'kind.baseType': 'Base',
            'kind.objectCreation': 'Object Creation',
            'kind.importing': 'Import',
            'kind.name': 'Name',
            'project.miscellaneous': 'Miscellaneous Files',
            'project.external': 'External Files',
            resultTitle: '\'{0}\' references - {1}',
            viewTitle: 'Find All References',
            'toolbar.scope': 'Search Scope',
            'toolbar.copy': 'Copy (Ctrl+C)',
            'toolbar.expandAll': 'Expand All',
            'toolbar.collapseAll': 'Collapse All',
            'toolbar.clearFilters': 'Clear All Filters',
            'toolbar.groupBy': 'Group by:',
            'toolbar.groupByTitle': 'Group by',
            'toolbar.keep': 'Keep Results (K)',
            'toolbar.keepTitle': 'Keep Results: show the next search in a new tab (Alt+K)',
            'toolbar.listView': 'List View (L)',
            'toolbar.listViewTitle': 'Toggle between tree view and list view (Alt+L)',
            'toolbar.search': 'Search Find All References',
            'tab.kept': 'Kept',
            'tab.close': 'Close',
            'header.filter': 'Filter',
            'status.filtered': 'Showing {0} of {1} items',
            'empty.hint': 'Put the cursor on a symbol and press Shift+F12, or choose "Find All References (VS Style)" from the editor context menu.',
            'empty.noReferences': 'No references found for \'{0}\'.',
            'empty.noResults': 'No results in the current scope or filters.',
            'popup.search': 'Search',
            'popup.selectAll': '(Select All)',
            'popup.ok': 'OK',
            'popup.cancel': 'Cancel',
            'menu.resetColumns': 'Reset Columns',
            'menu.goTo': 'Go To',
            'menu.collapse': 'Collapse',
            'menu.expand': 'Expand',
            'menu.copy': 'Copy',
            'menu.expandAll': 'Expand All',
            'menu.collapseAll': 'Collapse All',
            'message.placeCursor': 'Put the cursor on the symbol whose references you want to find.',
            'message.loading': 'Finding references to \'{0}\'…',
            'message.findFailed': 'Find All References failed: {0}',
            'message.openFailed': 'Couldn\'t open the file containing the reference: {0}',
        },
    };

    /** 特殊项目名的存储值；不会与真实工程名冲突。 */
    const PROJECT_MISCELLANEOUS = '\u0000miscellaneous';
    const PROJECT_EXTERNAL = '\u0000external';

    /**
     * 设置值 auto 跟随 VS Code 显示语言：zh 开头（含繁体）用中文，其余用英文。
     * @param {unknown} setting
     * @param {string} displayLanguage
     */
    function resolveLocale(setting, displayLanguage)
    {
        if (setting === 'zh-cn' || setting === 'en')
            return setting;
        return /^zh\b/i.test(displayLanguage || '') ? 'zh-cn' : 'en';
    }

    /**
     * @param {string} locale
     * @param {string} key
     * @param {...(string | number)} args
     */
    function t(locale, key, ...args)
    {
        const table = TABLES[locale] || TABLES['zh-cn'];
        const text = key in table ? table[key] : (key in TABLES.en ? TABLES.en[key] : key);
        return text.replace(/\{(\d+)\}/g, (match, index) => (index < args.length ? String(args[index]) : match));
    }

    /** 「类别」列显示文本；未知 ID 原样显示。 */
    function kindLabel(locale, kind)
    {
        return kind ? (('kind.' + kind) in TABLES.en ? t(locale, 'kind.' + kind) : kind) : '';
    }

    /** 项目名显示文本：特殊值翻译，其余原样。 */
    function projectLabel(locale, project)
    {
        if (project === PROJECT_MISCELLANEOUS)
            return t(locale, 'project.miscellaneous');
        if (project === PROJECT_EXTERNAL)
            return t(locale, 'project.external');
        return project;
    }

    return { LOCALES, TABLES, PROJECT_MISCELLANEOUS, PROJECT_EXTERNAL, resolveLocale, t, kindLabel, projectLabel };
});
