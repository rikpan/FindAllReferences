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
            'group.path-file': '路径，然后是文件',
            'group.project-file': '项目，然后是文件',
            'group.project-path-file': '项目、路径，然后是文件',
            'group.file': '仅文件',
            'lookIn.workspace': '整个工作区',
            'lookIn.open': '所有打开的文档',
            'lookIn.document': '当前文档',
            'lookIn.folder': '当前文档所在文件夹',
            'toolbar.stop': '停止查找',
            'toolbar.refresh': '刷新：按相同条件重新查找',
            'toolbar.modify': '修改查找(M)',
            'toolbar.modifyTitle': '修改查找条件 (Alt+M)',
            'form.query': '查找',
            'form.matchCase': '区分大小写 (Alt+C)',
            'form.wholeWord': '全字匹配 (Alt+W)',
            'form.regex': '使用正则表达式 (Alt+R)',
            'form.findAll': '全部查找',
            'form.lookIn': '查找范围:',
            'form.include': '包含的文件:',
            'form.includePlaceholder': '例如 *.cs, Assets/Scripts/**',
            'form.exclude': '排除的文件:',
            'form.excludePlaceholder': '例如 *.meta, **/Generated/**',
            'form.useExcludes': '使用排除设置和忽略文件',
            'form.close': '关闭 (Esc)',
            'find.viewTitle': '查找结果',
            'find.resultTitle': '查找"{0}"',
            'find.scope.solution': '所有文件',
            'find.toolbar.search': '搜索查找结果',
            'find.empty.hint': '按 Ctrl+Shift+F（macOS 为 Cmd+Shift+F）在文件中查找，或在命令面板中运行「在文件中查找（VS 风格）」。',
            'find.empty.noReferences': '未找到"{0}"。',
            'find.footer': '匹配行: {0}  匹配文件: {1}  搜索的文件总数: {2}',
            'find.footer.truncated': '结果过多，只保留了前 {0} 行。',
            'find.footer.stopped': '查找已停止，结果不完整。',
            'find.describe.all': '全部查找"{0}"',
            'find.describe.matchCase': '区分大小写',
            'find.describe.wholeWord': '全字匹配',
            'find.describe.regex': '使用正则表达式',
            'find.describe.include': '包含"{0}"',
            'find.describe.exclude': '排除"{0}"',
            'find.describe.noExcludes': '不使用排除设置和忽略文件',
            'find.describe.separator': '，',
            'find.describe.manage': '管理排除项',
            'message.finding': '正在查找"{0}"…',
            'message.findingProgress': '正在查找"{0}"… 已找到 {1} 行',
            'message.findInFilesFailed': '查找失败：{0}',
            'message.invalidRegex': '正则表达式无效：{0}',
            'message.noDocument': '没有活动的文档。',
            'message.ripgrepMissing': '找不到 VS Code 自带的 ripgrep，改用较慢的内置搜索。',
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
            'group.path-file': 'Path then File',
            'group.project-file': 'Project then File',
            'group.project-path-file': 'Project, Path then File',
            'group.file': 'File Only',
            'lookIn.workspace': 'Entire Workspace',
            'lookIn.open': 'All Open Documents',
            'lookIn.document': 'Current Document',
            'lookIn.folder': 'Current Document\'s Folder',
            'toolbar.stop': 'Stop Find',
            'toolbar.refresh': 'Refresh: run the same find again',
            'toolbar.modify': 'Modify Find (M)',
            'toolbar.modifyTitle': 'Modify the find options (Alt+M)',
            'form.query': 'Find',
            'form.matchCase': 'Match Case (Alt+C)',
            'form.wholeWord': 'Match Whole Word (Alt+W)',
            'form.regex': 'Use Regular Expression (Alt+R)',
            'form.findAll': 'Find All',
            'form.lookIn': 'Look in:',
            'form.include': 'Files to include:',
            'form.includePlaceholder': 'e.g. *.cs, Assets/Scripts/**',
            'form.exclude': 'Files to exclude:',
            'form.excludePlaceholder': 'e.g. *.meta, **/Generated/**',
            'form.useExcludes': 'Use Exclude Settings and Ignore Files',
            'form.close': 'Close (Esc)',
            'find.viewTitle': 'Find Results',
            'find.resultTitle': 'Find "{0}"',
            'find.scope.solution': 'All Files',
            'find.toolbar.search': 'Search Find Results',
            'find.empty.hint': 'Press Ctrl+Shift+F (Cmd+Shift+F on macOS) to find in files, or run "Find in Files (VS Style)" from the Command Palette.',
            'find.empty.noReferences': 'No matches found for "{0}".',
            'find.footer': 'Matching lines: {0}  Matching files: {1}  Total files searched: {2}',
            'find.footer.truncated': 'Too many results; only the first {0} lines were kept.',
            'find.footer.stopped': 'The find was stopped; results are incomplete.',
            'find.describe.all': 'Find all "{0}"',
            'find.describe.matchCase': 'Match case',
            'find.describe.wholeWord': 'Whole word',
            'find.describe.regex': 'Regular expressions',
            'find.describe.include': 'include "{0}"',
            'find.describe.exclude': 'exclude "{0}"',
            'find.describe.noExcludes': 'without exclude settings and ignore files',
            'find.describe.separator': ', ',
            'find.describe.manage': 'Manage exclusions',
            'message.finding': 'Finding "{0}"…',
            'message.findingProgress': 'Finding "{0}"… {1} lines found',
            'message.findInFilesFailed': 'Find failed: {0}',
            'message.invalidRegex': 'Invalid regular expression: {0}',
            'message.noDocument': 'There is no active document.',
            'message.ripgrepMissing': 'Couldn\'t find the ripgrep bundled with VS Code; using the slower built-in search.',
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
