// 界面语言：设置 findAllReferences.language 为 auto 时跟随 VS Code 显示语言，也可手动指定中文或英文。
// 字符串表在 media/i18n.js，与 Webview 共用。

import * as vscode from 'vscode';

export type Locale = 'zh-cn' | 'en';

interface StringsModule
{
    LOCALES: Locale[];
    PROJECT_MISCELLANEOUS: string;
    PROJECT_EXTERNAL: string;
    resolveLocale(setting: unknown, displayLanguage: string): Locale;
    t(locale: Locale, key: string, ...args: (string | number)[]): string;
}

// 编译后位于 out/src，字符串表随扩展打包在 media 目录。
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const strings: StringsModule = require('../../media/i18n.js');

export const languageSetting = 'findAllReferences.language';

export function currentLocale(): Locale
{
    return strings.resolveLocale(vscode.workspace.getConfiguration().get(languageSetting), vscode.env.language);
}

export function t(key: string, ...args: (string | number)[]): string
{
    return strings.t(currentLocale(), key, ...args);
}
