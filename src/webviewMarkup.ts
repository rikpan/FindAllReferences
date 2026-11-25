// 结果窗口的静态骨架；不依赖 vscode，jsdom 冒烟测试直接复用。
// 文本由 main.js 按 data-i18n（文本）／data-i18n-title（提示）／data-i18n-placeholder（占位符）填入当前语言。

const iconButton = (id: string, titleKey: string, icon: string) =>
    `<button id="${id}" class="icon" data-i18n-title="${titleKey}"><span class="codicon codicon-${icon}"></span></button>`;

const toggleButton = (id: string, titleKey: string, icon: string, textKey: string) =>
    `<button id="${id}" class="toggle" data-i18n-title="${titleKey}"><span class="codicon codicon-${icon}"></span><span data-i18n="${textKey}"></span></button>`;

const leadingTools = `<select id="scope" data-i18n-title="toolbar.scope"></select>
    ${iconButton('copy', 'toolbar.copy', 'copy')}
    ${iconButton('expand', 'toolbar.expandAll', 'expand-all')}
    ${iconButton('collapse', 'toolbar.collapseAll', 'collapse-all')}
    ${iconButton('clearFilters', 'toolbar.clearFilters', 'clear-all')}
    <span class="separator"></span>
    <label for="groupBy" class="label" data-i18n="toolbar.groupBy"></label>
    <select id="groupBy" data-i18n-title="toolbar.groupByTitle"></select>`;

const searchBox = `<span class="spacer"></span>
    <div class="search"><input id="search" type="text" data-i18n-placeholder="toolbar.search" spellcheck="false"><span class="codicon codicon-search"></span></div>`;

const table = `<div class="tabs" id="tabs"></div>
<div class="status" id="status"></div>
<div class="scroller" id="scroller" tabindex="0">
    <table id="table"><colgroup id="cols"></colgroup><thead><tr id="header"></tr></thead><tbody id="body"></tbody></table>
    <div class="empty" id="empty"></div>
</div>`;

const floating = `<div class="popup hidden" id="popup"></div>
<div class="menu hidden" id="menu"></div>`;

/** 「查找所有引用」窗口。 */
export const bodyMarkup = `<div class="toolbar" id="toolbar">
    ${leadingTools}
    <span class="separator"></span>
    ${toggleButton('keep', 'toolbar.keepTitle', 'lock', 'toolbar.keep')}
    ${toggleButton('listView', 'toolbar.listViewTitle', 'list-flat', 'toolbar.listView')}
    ${searchBox}
</div>
${table}
${floating}`;

const option = (id: string, titleKey: string, icon: string) =>
    `<button id="${id}" class="opt" data-i18n-title="${titleKey}"><span class="codicon codicon-${icon}"></span></button>`;

/** 「查找结果」窗口：上方多一个查找表单（Ctrl+Shift+F／修改查找时出现），下方多描述行与统计栏。 */
export const findBodyMarkup = `<form class="find-form hidden" id="findForm" autocomplete="off">
    <div class="find-row">
        <div class="find-input grow">
            <input id="findQuery" type="text" data-i18n-placeholder="form.query" spellcheck="false">
            <div class="find-options">
                ${option('optCase', 'form.matchCase', 'case-sensitive')}
                ${option('optWord', 'form.wholeWord', 'whole-word')}
                ${option('optRegex', 'form.regex', 'regex')}
            </div>
        </div>
        <button id="findAll" type="submit" class="primary" data-i18n="form.findAll"></button>
        <button id="findClose" type="button" class="icon" data-i18n-title="form.close"><span class="codicon codicon-close"></span></button>
    </div>
    <div class="find-row">
        <label for="findLookIn" class="label" data-i18n="form.lookIn"></label>
        <select id="findLookIn"></select>
        <label for="findInclude" class="label" data-i18n="form.include"></label>
        <div class="find-input"><input id="findInclude" type="text" data-i18n-placeholder="form.includePlaceholder" spellcheck="false"></div>
        <label for="findExclude" class="label" data-i18n="form.exclude"></label>
        <div class="find-input">
            <input id="findExclude" type="text" data-i18n-placeholder="form.excludePlaceholder" spellcheck="false">
            <div class="find-options">${option('optExcludes', 'form.useExcludes', 'exclude')}</div>
        </div>
    </div>
    <div class="find-error hidden" id="findError"></div>
</form>
<div class="toolbar" id="toolbar">
    ${leadingTools}
    ${iconButton('stop', 'toolbar.stop', 'close')}
    ${iconButton('refresh', 'toolbar.refresh', 'refresh')}
    ${toggleButton('keep', 'toolbar.keepTitle', 'lock', 'toolbar.keep')}
    ${toggleButton('listView', 'toolbar.listViewTitle', 'list-flat', 'toolbar.listView')}
    ${toggleButton('modify', 'toolbar.modifyTitle', 'edit', 'toolbar.modify')}
    ${searchBox}
</div>
<div class="description hidden" id="description"><span id="descriptionText"></span><a href="#" id="manageExcludes" data-i18n="find.describe.manage"></a></div>
${table}
<div class="footer hidden" id="footer"><span id="footerText"></span><span class="footer-notice" id="footerNotice"></span></div>
${floating}`;
