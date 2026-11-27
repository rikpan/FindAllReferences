// 解决方案文件（.sln／.slnx）解析：列出其中的工程路径。不依赖 vscode，便于单元测试。

import * as path from 'path';

const projectExtensions = /\.(csproj|vbproj|fsproj)$/i;

/** 返回解决方案里各工程文件的绝对路径（相对于解决方案所在目录解析）。 */
export function parseSolutionProjects(solutionPath: string, text: string): string[]
{
    const directory = path.dirname(solutionPath);
    const relative: string[] = [];
    if (/\.slnx$/i.test(solutionPath))
    {
        const pattern = /<Project\s+[^>]*?Path\s*=\s*"([^"]+)"/g;
        for (let match = pattern.exec(text); match; match = pattern.exec(text))
            relative.push(match[1]);
    }
    else
    {
        // Project("{类型 GUID}") = "名称", "相对路径", "{工程 GUID}"
        const pattern = /^\s*Project\("[^"]*"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+)"/gm;
        for (let match = pattern.exec(text); match; match = pattern.exec(text))
            relative.push(match[1]);
    }
    return relative
        .filter(entry => projectExtensions.test(entry))
        .map(entry => path.resolve(directory, entry.replace(/\\/g, '/')));
}
