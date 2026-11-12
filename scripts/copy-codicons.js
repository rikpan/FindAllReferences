// 把 codicon 字体与样式复制进 media，供 Webview 加载（打包时不带 node_modules）
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist');
const target = path.join(__dirname, '..', 'media', 'codicons');
fs.mkdirSync(target, { recursive: true });
for (const name of ['codicon.css', 'codicon.ttf'])
    fs.copyFileSync(path.join(source, name), path.join(target, name));
