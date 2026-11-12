// 「项目」列：把文件映射到 .csproj。
// Unity 生成的工程逐个列出 <Compile Include>，按清单精确映射；SDK 风格工程用通配，按目录包含映射。

import * as path from 'path';

export interface ProjectFileInfo
{
    compileIncludes: string[];
    usesGlobs: boolean;
}

export function parseProjectFile(text: string): ProjectFileInfo
{
    const compileIncludes: string[] = [];
    let usesGlobs = false;
    const pattern = /<Compile\s+[^>]*?Include\s*=\s*"([^"]+)"/g;
    for (let match = pattern.exec(text); match; match = pattern.exec(text))
    {
        for (const include of match[1].split(';'))
        {
            const trimmed = include.trim();
            if (!trimmed)
                continue;
            if (/[*?]/.test(trimmed))
                usesGlobs = true;
            else
                compileIncludes.push(trimmed);
        }
    }
    return { compileIncludes, usesGlobs };
}

export function normalizeFilePath(filePath: string, platform: string = process.platform): string
{
    const resolved = path.resolve(filePath);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class ProjectIndex
{
    private readonly files = new Map<string, string>();
    private readonly directories: { directory: string; name: string }[] = [];
    private projectCount = 0;

    get size(): number
    {
        return this.projectCount;
    }

    add(projectPath: string, text: string): void
    {
        const name = path.basename(projectPath, path.extname(projectPath));
        const directory = path.dirname(projectPath);
        const info = parseProjectFile(text);
        this.projectCount++;
        for (const include of info.compileIncludes)
        {
            const key = normalizeFilePath(path.resolve(directory, include.replace(/\\/g, '/')));
            if (!this.files.has(key))
                this.files.set(key, name);
        }
        if (info.usesGlobs || info.compileIncludes.length === 0)
        {
            this.directories.push({ directory: normalizeFilePath(directory), name });
            this.directories.sort((a, b) => b.directory.length - a.directory.length);
        }
    }

    resolve(filePath: string): string | undefined
    {
        const key = normalizeFilePath(filePath);
        const explicit = this.files.get(key);
        if (explicit)
            return explicit;
        for (const entry of this.directories)
        {
            if (key.startsWith(entry.directory + path.sep))
                return entry.name;
        }
        return undefined;
    }
}
