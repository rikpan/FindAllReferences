// 结果窗口的静态骨架；不依赖 vscode，jsdom 冒烟测试直接复用。
// 文本由 main.js 按 data-i18n（文本）／data-i18n-title（提示）／data-i18n-placeholder（占位符）填入当前语言。

export const bodyMarkup = `<div class="toolbar" id="toolbar">
    <select id="scope" data-i18n-title="toolbar.scope"></select>
    <button id="copy" class="icon" data-i18n-title="toolbar.copy"><span class="codicon codicon-copy"></span></button>
    <button id="expand" class="icon" data-i18n-title="toolbar.expandAll"><span class="codicon codicon-expand-all"></span></button>
    <button id="collapse" class="icon" data-i18n-title="toolbar.collapseAll"><span class="codicon codicon-collapse-all"></span></button>
    <button id="clearFilters" class="icon" data-i18n-title="toolbar.clearFilters"><span class="codicon codicon-clear-all"></span></button>
    <span class="separator"></span>
    <label for="groupBy" class="label" data-i18n="toolbar.groupBy"></label>
    <select id="groupBy" data-i18n-title="toolbar.groupByTitle"></select>
    <span class="separator"></span>
    <button id="keep" class="toggle" data-i18n-title="toolbar.keepTitle"><span class="codicon codicon-lock"></span><span data-i18n="toolbar.keep"></span></button>
    <button id="listView" class="toggle" data-i18n-title="toolbar.listViewTitle"><span class="codicon codicon-list-flat"></span><span data-i18n="toolbar.listView"></span></button>
    <span class="spacer"></span>
    <div class="search"><input id="search" type="text" data-i18n-placeholder="toolbar.search" spellcheck="false"><span class="codicon codicon-search"></span></div>
</div>
<div class="tabs" id="tabs"></div>
<div class="status" id="status"></div>
<div class="scroller" id="scroller" tabindex="0">
    <table id="table"><colgroup id="cols"></colgroup><thead><tr id="header"></tr></thead><tbody id="body"></tbody></table>
    <div class="empty" id="empty"></div>
</div>
<div class="popup hidden" id="popup"></div>
<div class="menu hidden" id="menu"></div>`;
