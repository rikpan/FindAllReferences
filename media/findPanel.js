// @ts-check
// 「查找结果」窗口专属的部分：查找表单（Ctrl+Shift+F／修改查找）、停止与刷新、描述行与底部统计。
// 挂到 window.ResultsPlugin，由 main.js 在启动时 install。
(function ()
{
    'use strict';

    /** @type {any} */
    let api;
    /** @type {Record<string, HTMLElement>} */
    const dom = {};
    const form = {
        matchCase: false,
        wholeWord: false,
        regex: false,
        useExcludeSettings: true,
        /** 「修改查找」时要替换的页签；新查找为 undefined。 */
        /** @type {number | undefined} */
        targetId: undefined,
    };
    /** @type {string[]} */
    let history = [];
    /** 上下键浏览历史时的位置；-1 表示正在编辑新内容。 */
    let historyIndex = -1;
    let draft = '';

    /** @param {string} id */
    const byId = id => /** @type {HTMLElement} */ (document.getElementById(id));
    const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (dom[id]);

    function visible()
    {
        return !dom.findForm.classList.contains('hidden');
    }

    function renderOptions()
    {
        dom.optCase.classList.toggle('checked', form.matchCase);
        dom.optWord.classList.toggle('checked', form.wholeWord);
        dom.optRegex.classList.toggle('checked', form.regex);
        dom.optExcludes.classList.toggle('checked', form.useExcludeSettings);
        for (const id of ['optCase', 'optWord', 'optRegex', 'optExcludes'])
            dom[id].setAttribute('aria-pressed', String(dom[id].classList.contains('checked')));
    }

    /** @param {string} text */
    function setError(text)
    {
        dom.findError.textContent = text;
        dom.findError.classList.toggle('hidden', !text);
    }

    /** @param {any} options */
    function applyOptions(options)
    {
        if (!options)
            return;
        input('findQuery').value = typeof options.query === 'string' ? options.query : input('findQuery').value;
        form.matchCase = !!options.matchCase;
        form.wholeWord = !!options.wholeWord;
        form.regex = !!options.regex;
        form.useExcludeSettings = options.useExcludeSettings !== false;
        /** @type {HTMLSelectElement} */ (dom.findLookIn).value = api.VM.LOOK_IN.indexOf(options.lookIn) >= 0 ? options.lookIn : 'workspace';
        input('findInclude').value = options.include || '';
        input('findExclude').value = options.exclude || '';
    }

    function currentOptions()
    {
        return {
            query: input('findQuery').value,
            matchCase: form.matchCase,
            wholeWord: form.wholeWord,
            regex: form.regex,
            lookIn: /** @type {HTMLSelectElement} */ (dom.findLookIn).value || 'workspace',
            include: input('findInclude').value.trim(),
            exclude: input('findExclude').value.trim(),
            useExcludeSettings: form.useExcludeSettings,
        };
    }

    /**
     * 显示表单并聚焦查找框。seed 非空时（如编辑器里选中的文本）替换查找内容。
     * @param {{ seed?: string, options?: any, targetId?: number }} request
     */
    function showForm(request)
    {
        if (request.options)
            applyOptions(request.options);
        if (request.seed)
            input('findQuery').value = request.seed;
        form.targetId = request.targetId;
        historyIndex = -1;
        setError('');
        renderOptions();
        dom.findForm.classList.remove('hidden');
        dom.modify.classList.toggle('checked', form.targetId !== undefined);
        input('findQuery').focus();
        input('findQuery').select();
    }

    function hideForm()
    {
        dom.findForm.classList.add('hidden');
        dom.modify.classList.remove('checked');
        setError('');
        if (api.activeResult())
            api.focusTable();
    }

    function submit()
    {
        const options = currentOptions();
        if (!options.query)
        {
            input('findQuery').focus();
            return;
        }
        history = [options.query].concat(history.filter(entry => entry !== options.query)).slice(0, 30);
        historyIndex = -1;
        api.vscode.postMessage({ type: 'find', options, targetId: form.targetId });
        dom.findForm.classList.add('hidden');
        dom.modify.classList.remove('checked');
        setError('');
    }

    /** 修改查找：用当前页签的条件打开表单，查找结果替换当前页签。 */
    function modify()
    {
        if (visible())
        {
            hideForm();
            return;
        }
        const result = api.activeResult();
        showForm(result ? { options: Object.assign({ query: result.symbol }, result.options), targetId: result.id } : {});
    }

    function refresh()
    {
        const result = api.activeResult();
        if (!result || api.state.loading)
            return;
        api.vscode.postMessage({ type: 'find', options: Object.assign({ query: result.symbol }, result.options), targetId: result.id });
    }

    /** @param {'matchCase' | 'wholeWord' | 'regex' | 'useExcludeSettings'} key */
    function toggle(key)
    {
        form[key] = !form[key];
        renderOptions();
    }

    /** @param {number} delta 1 为更早的历史 */
    function browseHistory(delta)
    {
        if (history.length === 0)
            return;
        if (historyIndex < 0)
            draft = input('findQuery').value;
        const next = Math.max(-1, Math.min(history.length - 1, historyIndex + delta));
        if (next === historyIndex)
            return;
        historyIndex = next;
        input('findQuery').value = next < 0 ? draft : history[next];
        input('findQuery').select();
    }

    function render()
    {
        const result = api.activeResult();
        const loading = !!api.state.loading;
        /** @type {HTMLButtonElement} */ (dom.stop).disabled = !loading;
        /** @type {HTMLButtonElement} */ (dom.refresh).disabled = !result || loading;
        dom.description.classList.toggle('hidden', !result);
        dom.footer.classList.toggle('hidden', !result);
        if (!result)
            return;
        dom.descriptionText.textContent = api.VM.describe(result) + api.t('describe.separator');
        dom.descriptionText.title = dom.descriptionText.textContent;
        dom.manageExcludes.classList.toggle('hidden', !(result.options && result.options.useExcludeSettings !== false));
        dom.footerText.textContent = api.VM.summary(result);
        dom.footerNotice.textContent = api.VM.notice(result);
    }

    function localize()
    {
        const select = /** @type {HTMLSelectElement} */ (dom.findLookIn);
        const value = select.value || 'workspace';
        select.innerHTML = api.VM.LOOK_IN
            .map(/** @param {string} id */ id => `<option value="${id}">${api.escapeHtml(api.t('lookIn.' + id))}</option>`)
            .join('');
        select.value = value;
        render();
    }

    /** @param {KeyboardEvent} event */
    function onKey(event)
    {
        const target = /** @type {HTMLElement} */ (event.target);
        const inForm = target instanceof Element && dom.findForm.contains(target);
        if (event.altKey && !event.ctrlKey)
        {
            // 与 VS Code 搜索视图一致：Alt+C／Alt+W／Alt+R（macOS 上也接受 Cmd+Alt）切换查找选项
            const letter = api.letterOf(event);
            const toggles = /** @type {Record<string, 'matchCase' | 'wholeWord' | 'regex'>} */ ({ c: 'matchCase', w: 'wholeWord', r: 'regex' });
            if (toggles[letter] && visible())
            {
                event.preventDefault();
                toggle(toggles[letter]);
                return true;
            }
            if (letter === 'm' && !event.metaKey)
            {
                event.preventDefault();
                modify();
                return true;
            }
        }
        if (!inForm)
            return false;
        if (event.key === 'Escape')
        {
            event.preventDefault();
            hideForm();
            return true;
        }
        if (target === dom.findQuery && !event.altKey && !event.ctrlKey && !event.metaKey
            && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))
        {
            event.preventDefault();
            browseHistory(event.key === 'ArrowUp' ? 1 : -1);
            return true;
        }
        return false;
    }

    /** @param {any} message */
    function onMessage(message)
    {
        switch (message.type)
        {
            case 'init':
                if (message.find)
                {
                    history = Array.isArray(message.find.history) ? message.find.history.slice() : [];
                    applyOptions(message.find.options);
                    renderOptions();
                }
                return false;
            case 'showFind':
                if (Array.isArray(message.history))
                    history = message.history.slice();
                showForm({ seed: message.seed, options: message.options });
                return true;
            case 'findError':
                showForm({ options: message.options, targetId: message.targetId });
                setError(message.text);
                return true;
            default:
                return false;
        }
    }

    function install(/** @type {any} */ host)
    {
        api = host;
        for (const id of ['findForm', 'findQuery', 'optCase', 'optWord', 'optRegex', 'optExcludes', 'findAll', 'findClose', 'findLookIn',
            'findInclude', 'findExclude', 'findError', 'stop', 'refresh', 'modify', 'description', 'descriptionText', 'manageExcludes',
            'footer', 'footerText', 'footerNotice'])
            dom[id] = byId(id);
        dom.findForm.addEventListener('submit', event =>
        {
            event.preventDefault();
            submit();
        });
        dom.optCase.addEventListener('click', () => toggle('matchCase'));
        dom.optWord.addEventListener('click', () => toggle('wholeWord'));
        dom.optRegex.addEventListener('click', () => toggle('regex'));
        dom.optExcludes.addEventListener('click', () => toggle('useExcludeSettings'));
        for (const id of ['optCase', 'optWord', 'optRegex', 'optExcludes'])
            /** @type {HTMLButtonElement} */ (dom[id]).type = 'button';
        dom.findClose.addEventListener('click', hideForm);
        dom.stop.addEventListener('click', () => api.vscode.postMessage({ type: 'stop' }));
        dom.refresh.addEventListener('click', refresh);
        dom.modify.addEventListener('click', modify);
        dom.manageExcludes.addEventListener('click', event =>
        {
            event.preventDefault();
            api.vscode.postMessage({ type: 'manageExcludes' });
        });
        renderOptions();
    }

    // @ts-ignore
    window.ResultsPlugin = { install, render, localize, onKey, onMessage };
})();
