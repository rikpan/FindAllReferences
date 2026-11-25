// @ts-check
// 结果窗口的交互：工具栏、页签、表头（排序／列宽／列筛选／显隐）、虚拟滚动表体、键盘导航。
(function ()
{
    'use strict';

    // @ts-ignore 由 Webview 注入
    const vscode = acquireVsCodeApi();
    // 同一份脚本服务两个窗口：body 的 data-view 为 find 时是「查找结果」，否则是「查找所有引用」
    const isFind = document.body.getAttribute('data-view') === 'find';
    // @ts-ignore 由 viewModel.js／findViewModel.js 挂载
    const VM = isFind ? window.FindViewModel : window.ReferencesViewModel;
    const t = VM.t;
    /**
     * 窗口专属的扩展（如查找窗口的查找表单），由更早加载的脚本挂到 window.ResultsPlugin。
     * @type {{ install?: (api: any) => void, render?: () => void, localize?: () => void, onMessage?: (message: any) => boolean, onKey?: (event: KeyboardEvent) => boolean }}
     */
    // @ts-ignore
    const plugin = window.ResultsPlugin || {};

    const ROW_HEIGHT = 22;
    const OVERSCAN = 12;

    /** @param {string} id */
    const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));
    const dom = {
        scope: /** @type {HTMLSelectElement} */ (byId('scope')),
        copy: byId('copy'),
        expand: byId('expand'),
        collapse: byId('collapse'),
        clearFilters: byId('clearFilters'),
        groupBy: /** @type {HTMLSelectElement} */ (byId('groupBy')),
        keep: byId('keep'),
        listView: byId('listView'),
        search: /** @type {HTMLInputElement} */ (byId('search')),
        tabs: byId('tabs'),
        status: byId('status'),
        scroller: byId('scroller'),
        table: byId('table'),
        cols: byId('cols'),
        header: byId('header'),
        body: byId('body'),
        empty: byId('empty'),
        popup: byId('popup'),
        menu: byId('menu'),
    };

    const state = {
        settings: defaultSettings(),
        /** @type {any[]} */
        results: [],
        /** @type {number | undefined} */
        activeId: undefined,
        context: { activeFileKey: '', activeProject: '', openFileKeys: [], changedFileKeys: [] },
        /** @type {string | null} */
        loading: null,
    };

    /** 当前可见行与筛选、排序后的条目。 */
    /** @type {any[]} */
    let rows = [];
    /** @type {any[]} */
    let currentItems = [];
    let suppressHeaderClick = false;
    let scrollFrame = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let searchTimer;

    // ---------- 设置 ----------

    function defaultSettings()
    {
        /** @type {Record<string, { width: number, visible: boolean }>} */
        const columns = {};
        for (const definition of VM.COLUMNS)
            columns[definition.id] = { width: definition.width, visible: definition.visible };
        return { groupBy: VM.GROUPINGS[0].id, listView: false, scope: VM.SCOPES[0].id, columns };
    }

    /** @param {any} saved */
    function mergeSettings(saved)
    {
        const settings = defaultSettings();
        if (!saved || typeof saved !== 'object')
            return settings;
        if (VM.GROUPINGS.some(/** @param {any} g */ g => g.id === saved.groupBy))
            settings.groupBy = saved.groupBy;
        if (VM.SCOPES.some(/** @param {any} s */ s => s.id === saved.scope))
            settings.scope = saved.scope;
        settings.listView = saved.listView === true;
        for (const id of Object.keys(settings.columns))
        {
            const column = saved.columns && saved.columns[id];
            if (!column)
                continue;
            if (typeof column.width === 'number' && column.width >= 24)
                settings.columns[id].width = column.width;
            if (typeof column.visible === 'boolean' && id !== 'code')
                settings.columns[id].visible = column.visible;
        }
        return settings;
    }

    function saveSettings()
    {
        vscode.postMessage({ type: 'settings', settings: state.settings });
    }

    // ---------- 结果与页签 ----------

    /** @param {any} result */
    function attach(result)
    {
        result.ui = {
            scope: state.settings.scope,
            /** @type {Record<string, string[] | undefined>} */
            filters: {},
            /** @type {{ column: string, descending: boolean } | null} */
            sort: null,
            search: '',
            collapsed: new Set(),
            selected: new Set(),
            /** @type {string | null} */
            anchorKey: null,
            /** @type {string | null} */
            focusKey: null,
            scrollTop: 0,
        };
        return result;
    }

    function activeResult()
    {
        return state.results.find(result => result.id === state.activeId);
    }

    function visibleColumns()
    {
        return VM.COLUMNS.filter(/** @param {any} c */ c => state.settings.columns[c.id].visible);
    }

    /** @param {number} id */
    function activate(id)
    {
        const previous = activeResult();
        if (previous)
            previous.ui.scrollTop = dom.scroller.scrollTop;
        state.activeId = id;
        vscode.postMessage({ type: 'activate', id });
        const result = activeResult();
        recompute();
        renderAll();
        dom.scroller.scrollTop = result ? result.ui.scrollTop : 0;
        renderBody();
    }

    /** @param {number} id */
    function closeResult(id)
    {
        const index = state.results.findIndex(result => result.id === id);
        if (index < 0)
            return;
        state.results.splice(index, 1);
        vscode.postMessage({ type: 'close', id });
        if (state.activeId === id)
        {
            const next = state.results[Math.min(index, state.results.length - 1)];
            state.activeId = next ? next.id : undefined;
            if (next)
                vscode.postMessage({ type: 'activate', id: next.id });
        }
        recompute();
        renderAll();
    }

    // ---------- 计算 ----------

    function recompute()
    {
        const result = activeResult();
        if (!result)
        {
            rows = [];
            currentItems = [];
            return;
        }
        const ui = result.ui;
        const filtered = VM.filterItems(result.items, {
            scope: ui.scope,
            context: state.context,
            result,
            filters: ui.filters,
            search: ui.search,
        });
        currentItems = VM.sortItems(filtered, ui.sort);
        rows = VM.buildRows(currentItems, {
            groupBy: state.settings.groupBy,
            listView: state.settings.listView,
            result,
            collapsed: ui.collapsed,
        });
    }

    function focusIndex()
    {
        const result = activeResult();
        if (!result || !result.ui.focusKey)
            return -1;
        return rows.findIndex(row => row.key === result.ui.focusKey);
    }

    // ---------- 渲染 ----------

    /** @param {unknown} value */
    function escapeHtml(value)
    {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderAll()
    {
        renderToolbar();
        renderTabs();
        renderHeader();
        renderStatus();
        renderBody();
        postTitle();
        if (plugin.render)
            plugin.render();
    }

    /** 按 data-i18n* 属性填入骨架里的静态文本。 */
    function applyStaticText()
    {
        document.documentElement.lang = VM.getLocale() === 'en' ? 'en' : 'zh-CN';
        for (const element of Array.from(document.querySelectorAll('[data-i18n]')))
            element.textContent = t(/** @type {string} */ (element.getAttribute('data-i18n')));
        for (const element of Array.from(document.querySelectorAll('[data-i18n-title]')))
            element.setAttribute('title', t(/** @type {string} */ (element.getAttribute('data-i18n-title'))));
        for (const element of Array.from(document.querySelectorAll('[data-i18n-placeholder]')))
            element.setAttribute('placeholder', t(/** @type {string} */ (element.getAttribute('data-i18n-placeholder'))));
    }

    /**
     * 切换界面语言。列筛选按显示文本保存，切换前后逐条对照，把已勾选的值换成新语言的写法。
     * @param {string} locale
     */
    function setLocale(locale)
    {
        if (!locale || locale === VM.getLocale())
            return;
        /** @type {{ result: any, id: string, before: string[] }[]} */
        const pending = [];
        for (const result of state.results)
        {
            for (const id of Object.keys(result.ui.filters))
            {
                if (result.ui.filters[id])
                    pending.push({ result, id, before: result.items.map(/** @param {any} item */ item => VM.filterValue(item, id)) });
            }
        }
        VM.setLocale(locale);
        for (const entry of pending)
        {
            /** @type {Map<string, string>} */
            const mapping = new Map();
            entry.result.items.forEach(/** @param {any} item @param {number} index */ (item, index) =>
                mapping.set(entry.before[index], VM.filterValue(item, entry.id)));
            entry.result.ui.filters[entry.id] = entry.result.ui.filters[entry.id]
                .map(/** @param {string} value */ value => mapping.has(value) ? mapping.get(value) : value);
        }
        closePopup();
        closeMenu();
        applyStaticText();
        fillOptions();
        if (plugin.localize)
            plugin.localize();
        recompute();
        renderAll();
    }

    function fillOptions()
    {
        dom.scope.innerHTML = VM.SCOPES
            .map(/** @param {any} s */ s => `<option value="${s.id}">${escapeHtml(s.title)}</option>`)
            .join('');
        dom.groupBy.innerHTML = VM.GROUPINGS
            .map(/** @param {any} g */ g => `<option value="${g.id}">${escapeHtml(g.title)}</option>`)
            .join('');
    }

    function renderToolbar()
    {
        const result = activeResult();
        dom.scope.value = result ? result.ui.scope : state.settings.scope;
        dom.groupBy.value = state.settings.groupBy;
        dom.groupBy.disabled = state.settings.listView;
        dom.keep.classList.toggle('checked', !!(result && result.kept));
        dom.listView.classList.toggle('checked', state.settings.listView);
        dom.search.value = result ? result.ui.search : '';
        const hasResult = !!result;
        for (const element of [dom.copy, dom.expand, dom.collapse, dom.clearFilters, dom.keep])
            /** @type {HTMLButtonElement} */ (element).disabled = !hasResult;
        dom.expand.toggleAttribute('disabled', !hasResult || state.settings.listView);
        dom.collapse.toggleAttribute('disabled', !hasResult || state.settings.listView);
        const filtered = !!result && (result.ui.search !== '' || Object.keys(result.ui.filters).some(id => result.ui.filters[id]));
        dom.clearFilters.classList.toggle('active', filtered);
    }

    function renderTabs()
    {
        if (state.results.length <= 1)
        {
            dom.tabs.classList.add('hidden');
            dom.tabs.innerHTML = '';
            return;
        }
        dom.tabs.classList.remove('hidden');
        dom.tabs.innerHTML = state.results.map(result =>
        {
            const active = result.id === state.activeId ? ' active' : '';
            const lock = result.kept ? `<span class="codicon codicon-lock tab-lock" title="${escapeHtml(t('tab.kept'))}"></span>` : '';
            const title = VM.resultTitle(result, result.ui.scope);
            return `<div class="tab${active}" data-id="${result.id}" title="${escapeHtml(title)}">` +
                `<span class="tab-title">${escapeHtml(title)}</span>${lock}` +
                `<span class="codicon codicon-close tab-close" data-close="${result.id}" title="${escapeHtml(t('tab.close'))}"></span></div>`;
        }).join('');
    }

    function renderHeader()
    {
        const result = activeResult();
        const columns = visibleColumns();
        let total = 0;
        dom.cols.innerHTML = columns.map(/** @param {any} c */ c =>
        {
            const width = state.settings.columns[c.id].width;
            total += width;
            return `<col data-col="${c.id}" style="width:${width}px">`;
        }).join('');
        dom.table.style.width = total + 'px';
        dom.header.innerHTML = columns.map(/** @param {any} c */ c =>
        {
            const sort = result && result.ui.sort && result.ui.sort.column === c.id ? result.ui.sort : null;
            const sortIcon = sort ? `<span class="codicon codicon-arrow-${sort.descending ? 'down' : 'up'} sort"></span>` : '';
            const filtered = !!(result && result.ui.filters[c.id]);
            const filter = c.filterable
                ? `<span class="codicon codicon-${filtered ? 'filter-filled' : 'filter'} th-filter${filtered ? ' active' : ''}" data-filter="${c.id}" title="${escapeHtml(t('header.filter'))}"></span>`
                : '';
            return `<th data-col="${c.id}" class="${c.numeric ? 'num' : ''}"><div class="th">` +
                `<span class="th-title">${escapeHtml(c.title)}</span>${sortIcon}${filter}</div>` +
                `<div class="resizer" data-resize="${c.id}"></div></th>`;
        }).join('');
    }

    function applyColumnWidths()
    {
        let total = 0;
        for (const col of Array.from(dom.cols.children))
        {
            const id = /** @type {HTMLElement} */ (col).dataset.col || '';
            const width = state.settings.columns[id].width;
            total += width;
            /** @type {HTMLElement} */ (col).style.width = width + 'px';
        }
        dom.table.style.width = total + 'px';
    }

    function renderStatus()
    {
        const result = activeResult();
        if (state.loading)
        {
            dom.status.innerHTML = `<span class="codicon codicon-loading codicon-modifier-spin"></span><span>${escapeHtml(state.loading)}</span>`;
            dom.status.classList.remove('hidden');
            return;
        }
        if (result && currentItems.length !== result.items.length)
        {
            dom.status.innerHTML = `<span class="codicon codicon-filter"></span><span>${escapeHtml(t('status.filtered', currentItems.length, result.items.length))}</span>`;
            dom.status.classList.remove('hidden');
            return;
        }
        dom.status.classList.add('hidden');
        dom.status.innerHTML = '';
    }

    function renderEmpty()
    {
        const result = activeResult();
        let text = '';
        if (!result)
            text = state.loading ? '' : t('empty.hint');
        else if (result.items.length === 0)
            text = t('empty.noReferences', result.symbol);
        else if (rows.length === 0)
            text = t('empty.noResults');
        dom.empty.textContent = text;
        dom.empty.classList.toggle('hidden', !text);
    }

    /** @param {number} level */
    function itemIndent(level)
    {
        return state.settings.listView ? 6 : 6 + level * 16 + 20;
    }

    /**
     * @param {any} row
     * @param {number} index
     * @param {any[]} columns
     * @param {any} ui
     */
    function rowHtml(row, index, columns, ui)
    {
        const classes = (ui.selected.has(row.key) ? ' selected' : '') + (ui.focusKey === row.key ? ' focused' : '');
        if (row.type === 'group')
        {
            const icon = row.icon ? `<span class="codicon codicon-${row.icon} group-icon"></span>` : '';
            return `<tr class="row group${classes}" data-index="${index}"><td colspan="${columns.length}">` +
                `<div class="group-cell" style="padding-left:${6 + row.level * 16}px">` +
                `<span class="codicon codicon-chevron-${row.expanded ? 'down' : 'right'} twistie" data-twistie="1"></span>` +
                `${icon}<span class="group-label">${escapeHtml(row.label)}</span>` +
                `<span class="group-count">(${row.count})</span></div></td></tr>`;
        }
        const item = row.item;
        const cells = columns.map(column =>
        {
            if (column.id === 'code')
            {
                const parts = VM.codeParts(item).map(/** @param {{ text: string, match: boolean }} part */ part =>
                    part.match ? `<span class="match">${escapeHtml(part.text)}</span>` : escapeHtml(part.text));
                return `<td class="c-code${item.isDefinition ? ' definition' : ''}" title="${escapeHtml(item.code.trim())}">` +
                    `<div class="code" style="padding-left:${itemIndent(row.level)}px">${parts.join('')}</div></td>`;
            }
            const text = VM.columnText(item, column.id);
            const tip = column.id === 'file' ? item.relativePath : text;
            return `<td class="c-${column.id}${column.numeric ? ' num' : ''}" title="${escapeHtml(tip)}">${escapeHtml(text)}</td>`;
        });
        return `<tr class="row item${classes}" data-index="${index}">${cells.join('')}</tr>`;
    }

    function renderBody()
    {
        renderEmpty();
        const result = activeResult();
        const columns = visibleColumns();
        if (!result || rows.length === 0)
        {
            dom.body.innerHTML = '';
            return;
        }
        const headerHeight = dom.header.offsetHeight || ROW_HEIGHT;
        const scrollTop = dom.scroller.scrollTop;
        const viewport = dom.scroller.clientHeight;
        const start = Math.max(0, Math.floor((scrollTop - headerHeight) / ROW_HEIGHT) - OVERSCAN);
        const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
        const parts = [];
        if (start > 0)
            parts.push(`<tr class="spacer" style="height:${start * ROW_HEIGHT}px"><td colspan="${columns.length}"></td></tr>`);
        for (let i = start; i < end; i++)
            parts.push(rowHtml(rows[i], i, columns, result.ui));
        if (end < rows.length)
            parts.push(`<tr class="spacer" style="height:${(rows.length - end) * ROW_HEIGHT}px"><td colspan="${columns.length}"></td></tr>`);
        dom.body.innerHTML = parts.join('');
    }

    /** 只刷新选中／焦点样式，不重建行（避免鼠标事件目标被替换）。 */
    function refreshRowClasses()
    {
        const result = activeResult();
        if (!result)
            return;
        for (const element of Array.from(dom.body.querySelectorAll('tr.row')))
        {
            const tr = /** @type {HTMLElement} */ (element);
            const row = rows[Number(tr.dataset.index)];
            if (!row)
                continue;
            tr.classList.toggle('selected', result.ui.selected.has(row.key));
            tr.classList.toggle('focused', result.ui.focusKey === row.key);
        }
    }

    function postTitle()
    {
        const result = activeResult();
        vscode.postMessage({ type: 'title', title: result ? VM.resultTitle(result, result.ui.scope) : t('viewTitle') });
    }

    // ---------- 选择与导航 ----------

    /** @param {any} row */
    function selectSingle(row)
    {
        const ui = activeResult().ui;
        ui.selected = new Set([row.key]);
        ui.anchorKey = row.key;
        ui.focusKey = row.key;
    }

    /** @param {any} row */
    function toggleSelect(row)
    {
        const ui = activeResult().ui;
        if (ui.selected.has(row.key))
            ui.selected.delete(row.key);
        else
            ui.selected.add(row.key);
        ui.anchorKey = row.key;
        ui.focusKey = row.key;
    }

    /** @param {number} index */
    function selectRange(index)
    {
        const ui = activeResult().ui;
        const anchor = rows.findIndex(row => row.key === ui.anchorKey);
        if (anchor < 0)
        {
            selectSingle(rows[index]);
            return;
        }
        const from = Math.min(anchor, index);
        const to = Math.max(anchor, index);
        ui.selected = new Set(rows.slice(from, to + 1).map(row => row.key));
        ui.focusKey = rows[index].key;
    }

    /** @param {number} index */
    function ensureVisible(index)
    {
        const headerHeight = dom.header.offsetHeight || ROW_HEIGHT;
        const top = index * ROW_HEIGHT;
        const viewport = dom.scroller.clientHeight - headerHeight;
        if (top < dom.scroller.scrollTop)
            dom.scroller.scrollTop = top;
        else if (top + ROW_HEIGHT > dom.scroller.scrollTop + viewport)
            dom.scroller.scrollTop = top + ROW_HEIGHT - viewport;
    }

    /**
     * @param {any} item
     * @param {{ preserveFocus: boolean, preview: boolean }} options
     */
    function openItem(item, options)
    {
        vscode.postMessage({
            type: 'open',
            uri: item.uri,
            line: item.line,
            column: item.column,
            endColumn: item.endColumn,
            preserveFocus: options.preserveFocus,
            preview: options.preview,
        });
    }

    /**
     * @param {number} index
     * @param {boolean} extend
     */
    function moveFocus(index, extend)
    {
        if (rows.length === 0)
            return;
        const target = Math.max(0, Math.min(rows.length - 1, index));
        const row = rows[target];
        if (extend)
            selectRange(target);
        else
            selectSingle(row);
        ensureVisible(target);
        renderBody();
        if (!extend && row.type === 'item')
            openItem(row.item, { preserveFocus: true, preview: true });
    }

    /** @param {any} row */
    function toggleGroup(row)
    {
        const ui = activeResult().ui;
        if (ui.collapsed.has(row.key))
            ui.collapsed.delete(row.key);
        else
            ui.collapsed.add(row.key);
        ui.focusKey = row.key;
        recompute();
        renderBody();
    }

    /** F4／Shift+F4：按树序走遍全部条目，目标在折叠组里时自动展开。 */
    /** @param {number} delta */
    function navigate(delta)
    {
        const result = activeResult();
        if (!result || currentItems.length === 0)
            return;
        const ui = result.ui;
        const expandedRows = VM.buildRows(currentItems, {
            groupBy: state.settings.groupBy,
            listView: state.settings.listView,
            result,
            collapsed: [],
        });
        const itemRows = expandedRows.filter(/** @param {any} row */ row => row.type === 'item');
        const current = itemRows.findIndex(/** @param {any} row */ row => row.key === ui.focusKey);
        const next = current < 0
            ? (delta > 0 ? 0 : itemRows.length - 1)
            : (current + delta + itemRows.length) % itemRows.length;
        const target = itemRows[next];
        let level = target.level;
        for (let i = expandedRows.indexOf(target) - 1; i >= 0 && level > 0; i--)
        {
            const row = expandedRows[i];
            if (row.type === 'group' && row.level < level)
            {
                ui.collapsed.delete(row.key);
                level = row.level;
            }
        }
        recompute();
        const index = rows.findIndex(row => row.key === target.key);
        selectSingle(rows[index]);
        ensureVisible(index);
        renderBody();
        openItem(target.item, { preserveFocus: false, preview: true });
    }

    // ---------- 复制、展开、筛选 ----------

    function copySelection()
    {
        const result = activeResult();
        if (!result)
            return;
        let items = VM.selectedItems(rows, result.ui.selected);
        if (items.length === 0)
            items = currentItems;
        const text = VM.formatCopy(items, visibleColumns().map(/** @param {any} c */ c => c.id));
        vscode.postMessage({ type: 'copy', text });
    }

    /** @param {boolean} expanded */
    function setAllExpanded(expanded)
    {
        const result = activeResult();
        if (!result || state.settings.listView)
            return;
        result.ui.collapsed = expanded
            ? new Set()
            : new Set(VM.allGroupKeys(currentItems, { groupBy: state.settings.groupBy, result }));
        recompute();
        renderBody();
    }

    function clearFilters()
    {
        const result = activeResult();
        if (!result)
            return;
        result.ui.filters = {};
        result.ui.search = '';
        recompute();
        renderToolbar();
        renderHeader();
        renderStatus();
        renderBody();
    }

    function toggleKeep()
    {
        const result = activeResult();
        if (!result)
            return;
        result.kept = !result.kept;
        vscode.postMessage({ type: 'keep', id: result.id, kept: result.kept });
        renderToolbar();
        renderTabs();
    }

    function toggleListView()
    {
        state.settings.listView = !state.settings.listView;
        saveSettings();
        recompute();
        renderToolbar();
        renderBody();
    }

    /** @param {string} columnId */
    function cycleSort(columnId)
    {
        const result = activeResult();
        if (!result)
            return;
        const sort = result.ui.sort;
        if (!sort || sort.column !== columnId)
            result.ui.sort = { column: columnId, descending: false };
        else if (!sort.descending)
            result.ui.sort = { column: columnId, descending: true };
        else
            result.ui.sort = null;
        recompute();
        renderHeader();
        renderBody();
    }

    function closePopup()
    {
        dom.popup.classList.add('hidden');
        dom.popup.innerHTML = '';
    }

    /**
     * @param {HTMLElement} element
     * @param {number} left
     * @param {number} top
     */
    function placeFloating(element, left, top)
    {
        element.classList.remove('hidden');
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        element.style.left = Math.max(0, Math.min(left, window.innerWidth - width - 4)) + 'px';
        element.style.top = Math.max(0, Math.min(top, window.innerHeight - height - 4)) + 'px';
    }

    /**
     * Excel 式列筛选：候选值来自应用了其他筛选后的结果。
     * @param {string} columnId
     * @param {HTMLElement} anchor
     */
    function openFilterPopup(columnId, anchor)
    {
        const result = activeResult();
        if (!result)
            return;
        closeMenu();
        const ui = result.ui;
        const base = VM.filterItems(result.items, {
            scope: ui.scope,
            context: state.context,
            result,
            filters: ui.filters,
            search: ui.search,
            skipFilter: columnId,
        });
        /** @type {{ value: string, count: number }[]} */
        const values = VM.distinctValues(base, columnId);
        const current = ui.filters[columnId];
        const checked = new Set(current || values.map(v => v.value));
        dom.popup.innerHTML =
            `<div class="popup-search"><input type="text" placeholder="${escapeHtml(t('popup.search'))}" spellcheck="false"></div>` +
            '<div class="popup-list">' +
            `<label class="popup-item popup-all"><input type="checkbox" data-all="1"><span>${escapeHtml(t('popup.selectAll'))}</span></label>` +
            values.map((v, i) =>
                `<label class="popup-item" data-text="${escapeHtml(v.value.toLowerCase())}">` +
                `<input type="checkbox" data-index="${i}"${checked.has(v.value) ? ' checked' : ''}>` +
                `<span class="popup-value">${escapeHtml(v.value)}</span><span class="popup-count">${v.count}</span></label>`).join('') +
            '</div>' +
            `<div class="popup-buttons"><button class="primary" data-ok="1">${escapeHtml(t('popup.ok'))}</button><button data-cancel="1">${escapeHtml(t('popup.cancel'))}</button></div>`;

        const all = /** @type {HTMLInputElement} */ (dom.popup.querySelector('[data-all]'));
        const boxes = /** @type {HTMLInputElement[]} */ (Array.from(dom.popup.querySelectorAll('input[data-index]')));
        const visibleBoxes = () => boxes.filter(box => !(/** @type {HTMLElement} */ (box.parentElement)).classList.contains('hidden'));
        const syncAll = () =>
        {
            const shown = visibleBoxes();
            const count = shown.filter(box => box.checked).length;
            all.checked = shown.length > 0 && count === shown.length;
            all.indeterminate = count > 0 && count < shown.length;
        };
        syncAll();
        all.addEventListener('change', () =>
        {
            for (const box of visibleBoxes())
                box.checked = all.checked;
            syncAll();
        });
        for (const box of boxes)
            box.addEventListener('change', syncAll);
        const searchBox = /** @type {HTMLInputElement} */ (dom.popup.querySelector('.popup-search input'));
        searchBox.addEventListener('input', () =>
        {
            const text = searchBox.value.trim().toLowerCase();
            for (const box of boxes)
            {
                const label = /** @type {HTMLElement} */ (box.parentElement);
                label.classList.toggle('hidden', !!text && (label.dataset.text || '').indexOf(text) < 0);
            }
            syncAll();
        });
        const apply = () =>
        {
            const chosen = boxes.filter(box => box.checked).map(box => values[Number(box.dataset.index)].value);
            if (chosen.length === values.length)
                delete ui.filters[columnId];
            else
                ui.filters[columnId] = chosen;
            closePopup();
            recompute();
            renderToolbar();
            renderHeader();
            renderStatus();
            renderBody();
        };
        /** @type {HTMLElement} */ (dom.popup.querySelector('[data-ok]')).addEventListener('click', apply);
        /** @type {HTMLElement} */ (dom.popup.querySelector('[data-cancel]')).addEventListener('click', closePopup);
        dom.popup.addEventListener('keydown', event =>
        {
            if (event.key === 'Enter')
                apply();
        });
        const rect = anchor.getBoundingClientRect();
        placeFloating(dom.popup, rect.left - 180, rect.bottom + 2);
        searchBox.focus();
    }

    // ---------- 右键菜单 ----------

    function closeMenu()
    {
        dom.menu.classList.add('hidden');
        dom.menu.innerHTML = '';
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {({ label: string, checked?: boolean, disabled?: boolean, keybinding?: string, action: () => void } | null)[]} entries null 为分隔线
     */
    function showMenu(x, y, entries)
    {
        closePopup();
        dom.menu.innerHTML = entries.map((entry, index) =>
        {
            if (!entry)
                return '<div class="menu-separator"></div>';
            const check = entry.checked === undefined ? '' : `<span class="codicon ${entry.checked ? 'codicon-check' : 'codicon-blank'}"></span>`;
            return `<div class="menu-item${entry.disabled ? ' disabled' : ''}" data-entry="${index}">` +
                `<span class="menu-check">${check}</span><span class="menu-label">${escapeHtml(entry.label)}</span>` +
                `<span class="menu-key">${escapeHtml(entry.keybinding || '')}</span></div>`;
        }).join('');
        for (const element of Array.from(dom.menu.querySelectorAll('[data-entry]')))
        {
            element.addEventListener('mousedown', event =>
            {
                event.preventDefault();
                event.stopPropagation();
                const entry = entries[Number(/** @type {HTMLElement} */ (element).dataset.entry)];
                if (!entry || entry.disabled)
                    return;
                closeMenu();
                entry.action();
            });
        }
        placeFloating(dom.menu, x, y);
    }

    /** @param {MouseEvent} event */
    function showColumnMenu(event)
    {
        event.preventDefault();
        const entries = VM.COLUMNS.map(/** @param {any} column */ column => ({
            label: column.title,
            checked: state.settings.columns[column.id].visible,
            disabled: column.id === 'code',
            action: () =>
            {
                state.settings.columns[column.id].visible = !state.settings.columns[column.id].visible;
                saveSettings();
                renderHeader();
                renderBody();
            },
        }));
        entries.push(null, {
            label: t('menu.resetColumns'),
            action: () =>
            {
                state.settings.columns = defaultSettings().columns;
                saveSettings();
                renderHeader();
                renderBody();
            },
        });
        showMenu(event.clientX, event.clientY, entries);
    }

    /**
     * @param {MouseEvent} event
     * @param {any} row
     */
    function showRowMenu(event, row)
    {
        event.preventDefault();
        const tree = !state.settings.listView;
        showMenu(event.clientX, event.clientY, [
            {
                label: row.type === 'item' ? t('menu.goTo') : t(row.expanded ? 'menu.collapse' : 'menu.expand'),
                keybinding: 'Enter',
                action: () =>
                {
                    if (row.type === 'item')
                        openItem(row.item, { preserveFocus: false, preview: false });
                    else
                        toggleGroup(row);
                },
            },
            { label: t('menu.copy'), keybinding: 'Ctrl+C', action: copySelection },
            null,
            { label: t('menu.expandAll'), disabled: !tree, action: () => setAllExpanded(true) },
            { label: t('menu.collapseAll'), disabled: !tree, action: () => setAllExpanded(false) },
        ]);
    }

    // ---------- 事件 ----------

    /** @param {EventTarget | null} target */
    function rowFromTarget(target)
    {
        const element = target instanceof Element ? target.closest('tr.row') : null;
        if (!element)
            return null;
        const index = Number(/** @type {HTMLElement} */ (element).dataset.index);
        return { index, row: rows[index] };
    }

    function bindEvents()
    {
        dom.scope.addEventListener('change', () =>
        {
            const result = activeResult();
            state.settings.scope = dom.scope.value;
            saveSettings();
            if (!result)
                return;
            result.ui.scope = dom.scope.value;
            recompute();
            renderAll();
        });
        dom.groupBy.addEventListener('change', () =>
        {
            state.settings.groupBy = dom.groupBy.value;
            saveSettings();
            recompute();
            renderBody();
        });
        dom.copy.addEventListener('click', copySelection);
        dom.expand.addEventListener('click', () => setAllExpanded(true));
        dom.collapse.addEventListener('click', () => setAllExpanded(false));
        dom.clearFilters.addEventListener('click', clearFilters);
        dom.keep.addEventListener('click', toggleKeep);
        dom.listView.addEventListener('click', toggleListView);
        dom.search.addEventListener('input', () =>
        {
            if (searchTimer)
                clearTimeout(searchTimer);
            searchTimer = setTimeout(() =>
            {
                const result = activeResult();
                if (!result)
                    return;
                result.ui.search = dom.search.value;
                recompute();
                renderToolbar();
                renderStatus();
                renderBody();
            }, 120);
        });
        dom.search.addEventListener('keydown', event =>
        {
            if (event.key === 'Escape' && dom.search.value)
            {
                dom.search.value = '';
                dom.search.dispatchEvent(new Event('input'));
            }
            else if (event.key === 'ArrowDown' || event.key === 'Enter')
            {
                event.preventDefault();
                dom.scroller.focus();
                if (focusIndex() < 0)
                    moveFocus(0, false);
            }
        });

        dom.tabs.addEventListener('mousedown', event =>
        {
            const target = /** @type {HTMLElement} */ (event.target);
            const close = target.closest('[data-close]');
            if (close)
            {
                event.preventDefault();
                closeResult(Number(/** @type {HTMLElement} */ (close).dataset.close));
                return;
            }
            const tab = target.closest('.tab');
            if (!tab)
                return;
            if (event.button === 1)
            {
                event.preventDefault();
                closeResult(Number(/** @type {HTMLElement} */ (tab).dataset.id));
            }
            else if (event.button === 0)
                activate(Number(/** @type {HTMLElement} */ (tab).dataset.id));
        });

        dom.header.addEventListener('mousedown', event =>
        {
            const target = /** @type {HTMLElement} */ (event.target);
            const resizer = target.closest('[data-resize]');
            if (!resizer || event.button !== 0)
                return;
            event.preventDefault();
            const id = /** @type {HTMLElement} */ (resizer).dataset.resize || '';
            const startX = event.clientX;
            const startWidth = state.settings.columns[id].width;
            suppressHeaderClick = true;
            document.body.classList.add('resizing');
            /** @param {MouseEvent} move */
            const onMove = move =>
            {
                state.settings.columns[id].width = Math.max(24, Math.round(startWidth + move.clientX - startX));
                applyColumnWidths();
            };
            const onUp = () =>
            {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('resizing');
                saveSettings();
                setTimeout(() =>
                {
                    suppressHeaderClick = false;
                }, 0);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        dom.header.addEventListener('click', event =>
        {
            if (suppressHeaderClick)
                return;
            const target = /** @type {HTMLElement} */ (event.target);
            const filter = target.closest('[data-filter]');
            if (filter)
            {
                event.stopPropagation();
                openFilterPopup(/** @type {HTMLElement} */ (filter).dataset.filter || '', /** @type {HTMLElement} */ (filter));
                return;
            }
            const th = target.closest('th');
            if (th && !target.closest('[data-resize]'))
                cycleSort(/** @type {HTMLElement} */ (th).dataset.col || '');
        });
        dom.header.addEventListener('dblclick', event =>
        {
            // 双击分隔线：按当前可见内容自动调整列宽
            const target = /** @type {HTMLElement} */ (event.target);
            const resizer = target.closest('[data-resize]');
            if (!resizer)
                return;
            const id = /** @type {HTMLElement} */ (resizer).dataset.resize || '';
            autoFitColumn(id);
        });
        dom.header.addEventListener('contextmenu', showColumnMenu);

        dom.body.addEventListener('mousedown', event =>
        {
            const hit = rowFromTarget(event.target);
            if (!hit || !hit.row)
                return;
            const result = activeResult();
            dom.scroller.focus({ preventScroll: true });
            if (event.button === 2)
            {
                if (!result.ui.selected.has(hit.row.key))
                    selectSingle(hit.row);
                refreshRowClasses();
                return;
            }
            if (event.button !== 0)
                return;
            const target = /** @type {HTMLElement} */ (event.target);
            if (hit.row.type === 'group' && target.closest('[data-twistie]'))
            {
                event.preventDefault();
                selectSingle(hit.row);
                toggleGroup(hit.row);
                return;
            }
            if (event.ctrlKey || event.metaKey)
                toggleSelect(hit.row);
            else if (event.shiftKey)
                selectRange(hit.index);
            else
                selectSingle(hit.row);
            refreshRowClasses();
            if (hit.row.type === 'item' && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.detail === 1)
                openItem(hit.row.item, { preserveFocus: true, preview: true });
        });
        dom.body.addEventListener('dblclick', event =>
        {
            const hit = rowFromTarget(event.target);
            if (!hit || !hit.row)
                return;
            if (hit.row.type === 'group')
            {
                if (!(/** @type {HTMLElement} */ (event.target)).closest('[data-twistie]'))
                    toggleGroup(hit.row);
            }
            else
                openItem(hit.row.item, { preserveFocus: false, preview: false });
        });
        dom.body.addEventListener('contextmenu', event =>
        {
            const hit = rowFromTarget(event.target);
            if (hit && hit.row)
                showRowMenu(event, hit.row);
        });

        dom.scroller.addEventListener('scroll', () =>
        {
            if (scrollFrame)
                return;
            scrollFrame = requestAnimationFrame(() =>
            {
                scrollFrame = 0;
                renderBody();
            });
        });
        new ResizeObserver(() => renderBody()).observe(dom.scroller);

        dom.scroller.addEventListener('keydown', onTableKey);
        document.addEventListener('keydown', onGlobalKey);
        document.addEventListener('mousedown', event =>
        {
            const target = /** @type {Node} */ (event.target);
            if (!dom.popup.contains(target))
                closePopup();
            if (!dom.menu.contains(target))
                closeMenu();
        });
        window.addEventListener('blur', () =>
        {
            closeMenu();
        });
        window.addEventListener('message', event => onMessage(event.data));
    }

    /** @param {string} id */
    function autoFitColumn(id)
    {
        const result = activeResult();
        const definition = VM.COLUMNS.find(/** @param {any} c */ c => c.id === id);
        if (!result || !definition)
            return;
        const canvas = document.createElement('canvas');
        const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        const sample = dom.body.querySelector(id === 'code' ? '.code' : `td.c-${id}`) || dom.body;
        context.font = getComputedStyle(sample).font;
        let width = context.measureText(definition.title).width + 40;
        for (const row of rows)
        {
            if (row.type !== 'item')
                continue;
            const text = id === 'code' ? row.item.code.trim() : VM.columnText(row.item, id);
            const extra = id === 'code' ? itemIndent(row.level) + 12 : 16;
            width = Math.max(width, context.measureText(text).width + extra);
        }
        state.settings.columns[id].width = Math.min(1600, Math.ceil(width));
        applyColumnWidths();
        saveSettings();
    }

    /** @param {KeyboardEvent} event */
    function onTableKey(event)
    {
        const result = activeResult();
        if (!result || rows.length === 0)
            return;
        const index = focusIndex();
        const row = index >= 0 ? rows[index] : null;
        const page = Math.max(1, Math.floor(dom.scroller.clientHeight / ROW_HEIGHT) - 1);
        const ctrl = event.ctrlKey || event.metaKey;
        switch (event.key)
        {
            case 'ArrowDown':
                moveFocus(index + 1, event.shiftKey);
                break;
            case 'ArrowUp':
                moveFocus(index < 0 ? 0 : index - 1, event.shiftKey);
                break;
            case 'PageDown':
                moveFocus(index + page, event.shiftKey);
                break;
            case 'PageUp':
                moveFocus(index - page, event.shiftKey);
                break;
            case 'Home':
                moveFocus(0, event.shiftKey);
                break;
            case 'End':
                moveFocus(rows.length - 1, event.shiftKey);
                break;
            case 'ArrowRight':
                if (row && row.type === 'group')
                {
                    if (!row.expanded)
                        toggleGroup(row);
                    else
                        moveFocus(index + 1, false);
                }
                break;
            case 'ArrowLeft':
                if (row && row.type === 'group' && row.expanded)
                    toggleGroup(row);
                else if (row)
                {
                    for (let i = index - 1; i >= 0; i--)
                    {
                        if (rows[i].type === 'group' && rows[i].level < row.level)
                        {
                            moveFocus(i, false);
                            break;
                        }
                    }
                }
                break;
            case 'Enter':
                if (row && row.type === 'item')
                    openItem(row.item, { preserveFocus: false, preview: false });
                else if (row)
                    toggleGroup(row);
                break;
            case ' ':
                if (row && row.type === 'item')
                    openItem(row.item, { preserveFocus: true, preview: true });
                break;
            case 'a':
            case 'A':
                if (!ctrl)
                    return;
                result.ui.selected = new Set(rows.map(r => r.key));
                refreshRowClasses();
                break;
            case 'c':
            case 'C':
                if (!ctrl)
                    return;
                copySelection();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    /** @param {KeyboardEvent} event */
    function letterOf(event)
    {
        if (event.code && /^Key[A-Z]$/.test(event.code))
            return event.code.slice(3).toLowerCase();
        return (event.key || '').toLowerCase();
    }

    /** @param {KeyboardEvent} event */
    function onGlobalKey(event)
    {
        if (plugin.onKey && plugin.onKey(event))
            return;
        if (event.key === 'Escape')
        {
            closePopup();
            closeMenu();
            return;
        }
        if (event.altKey && !event.ctrlKey && !event.metaKey)
        {
            // macOS 上 Alt 会改变 key（如 Alt+K 得到 ˚），优先按物理键位判断
            const letter = letterOf(event);
            if (letter === 'k')
            {
                event.preventDefault();
                toggleKeep();
            }
            else if (letter === 'l')
            {
                event.preventDefault();
                toggleListView();
            }
            return;
        }
        const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
        if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F') && !editing)
        {
            event.preventDefault();
            dom.search.focus();
            dom.search.select();
        }
    }

    /** @param {any} message */
    function onMessage(message)
    {
        if (plugin.onMessage && plugin.onMessage(message))
            return;
        switch (message.type)
        {
            case 'init':
                if (message.locale)
                {
                    VM.setLocale(message.locale);
                    applyStaticText();
                    fillOptions();
                    if (plugin.localize)
                        plugin.localize();
                }
                state.settings = mergeSettings(message.settings);
                state.results = (message.results || []).map(attach);
                state.activeId = message.activeId;
                state.context = message.context || state.context;
                state.loading = message.loading || null;
                recompute();
                renderAll();
                break;
            case 'result':
            {
                const result = attach(message.result);
                const index = message.replaceId === undefined
                    ? -1
                    : state.results.findIndex(candidate => candidate.id === message.replaceId);
                if (index >= 0)
                    state.results[index] = result;
                else
                    state.results.push(result);
                state.activeId = result.id;
                recompute();
                dom.scroller.scrollTop = 0;
                renderAll();
                dom.scroller.focus({ preventScroll: true });
                break;
            }
            case 'loading':
                state.loading = message.text;
                renderStatus();
                renderEmpty();
                if (plugin.render)
                    plugin.render();
                break;
            case 'context':
            {
                state.context = message.context;
                const result = activeResult();
                if (result && result.ui.scope !== 'solution')
                {
                    recompute();
                    renderStatus();
                    renderBody();
                }
                break;
            }
            case 'navigate':
                navigate(message.delta);
                break;
            case 'locale':
                setLocale(message.locale);
                break;
        }
    }

    VM.setLocale(document.body.getAttribute('data-locale') || VM.getLocale());
    if (plugin.install)
    {
        plugin.install({
            vscode,
            VM,
            t,
            state,
            dom,
            activeResult,
            escapeHtml,
            renderAll,
            focusTable: () => dom.scroller.focus({ preventScroll: true }),
            letterOf,
        });
    }
    applyStaticText();
    fillOptions();
    if (plugin.localize)
        plugin.localize();
    bindEvents();
    vscode.postMessage({ type: 'ready' });
    renderAll();
})();
