// 扩展端与 Webview 之间传递的结果数据。

export interface ReferenceItem
{
    id: number;
    /** uri.toString()，用于打开文件。 */
    uri: string;
    /** 归一化的文件键，用于和「打开的文档」「已更改的文档」比较。 */
    fileKey: string;
    fileName: string;
    relativePath: string;
    /** 0 起的行列；显示时加 1。 */
    line: number;
    column: number;
    endColumn: number;
    /** 引用所在的整行原文。 */
    code: string;
    project: string;
    member: string;
    type: string;
    kind: string;
    repository: string;
    isDefinition: boolean;
}

export interface DefinitionInfo
{
    label: string;
    icon: string;
}

export interface ReferenceResult
{
    id: number;
    symbol: string;
    kept: boolean;
    definition: DefinitionInfo;
    originFileKey: string;
    originProject: string;
    items: ReferenceItem[];
}

export interface ViewContext
{
    activeFileKey: string;
    activeProject: string;
    openFileKeys: string[];
    changedFileKeys: string[];
}
