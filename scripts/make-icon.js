// 生成应用商店图标 media/icon.png（128×128）：蓝色圆角方块上的白色放大镜，镜内两行列表，
// 与面板图标 media/icon.svg 同一图形。不依赖图像库：按有向距离场逐像素算覆盖率，自己编码 PNG。
// 用法：node scripts/make-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const SAMPLES = 4; // 每像素 4×4 超采样，配合距离场的 1px 软边

// 面板图标是 24×24 的 SVG，这里按 4.6 倍放大并居中偏移 8px。
const scale = 4.6;
const offset = 8;
const p = v => offset + v * scale;

const shapes = {
    background: { radius: 26 },
    ring: { cx: p(10), cy: p(10), r: 6 * scale, width: 8.5 },
    handle: { x1: p(14.5), y1: p(14.5), x2: p(20), y2: p(20), width: 12.5 },
    lines: [
        { x1: p(7), y1: p(9), x2: p(13), y2: p(9), width: 6.5 },
        { x1: p(7), y1: p(11.5), x2: p(11), y2: p(11.5), width: 6.5 },
    ],
};

/** 圆角矩形（整张画布）的有向距离，内部为负。 */
function roundedRect(x, y, radius)
{
    const half = SIZE / 2;
    const qx = Math.abs(x - half) - (half - radius);
    const qy = Math.abs(y - half) - (half - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** 两端为半圆的线段（胶囊）的有向距离。 */
function capsule(x, y, s)
{
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t)) - s.width / 2;
}

function ring(x, y, s)
{
    return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r) - s.width / 2;
}

/** 前景（白色图形）的有向距离：各部分取并集。 */
function foreground(x, y)
{
    let d = Math.min(ring(x, y, shapes.ring), capsule(x, y, shapes.handle));
    for (const line of shapes.lines)
        d = Math.min(d, capsule(x, y, line));
    return d;
}

const coverage = d => Math.max(0, Math.min(1, 0.5 - d));

/** 背景色：左上 #3d8bfd 到右下 #1f5fd1 的对角渐变。 */
function backgroundColor(x, y)
{
    const t = (x + y) / (2 * SIZE);
    const from = [0x3d, 0x8b, 0xfd];
    const to = [0x1f, 0x5f, 0xd1];
    return from.map((c, i) => c + (to[i] - c) * t);
}

function render()
{
    const pixels = Buffer.alloc(SIZE * SIZE * 4);
    for (let py = 0; py < SIZE; py++)
    {
        for (let px = 0; px < SIZE; px++)
        {
            let alpha = 0;
            let r = 0, g = 0, b = 0;
            for (let sy = 0; sy < SAMPLES; sy++)
            {
                for (let sx = 0; sx < SAMPLES; sx++)
                {
                    const x = px + (sx + 0.5) / SAMPLES;
                    const y = py + (sy + 0.5) / SAMPLES;
                    const bg = coverage(roundedRect(x, y, shapes.background.radius) * SAMPLES);
                    if (bg === 0)
                        continue;
                    const fg = coverage(foreground(x, y) * SAMPLES);
                    const base = backgroundColor(x, y);
                    r += bg * (base[0] + (255 - base[0]) * fg);
                    g += bg * (base[1] + (255 - base[1]) * fg);
                    b += bg * (base[2] + (255 - base[2]) * fg);
                    alpha += bg;
                }
            }
            const i = (py * SIZE + px) * 4;
            // 预乘转直通 alpha
            pixels[i] = alpha ? Math.round(r / alpha) : 0;
            pixels[i + 1] = alpha ? Math.round(g / alpha) : 0;
            pixels[i + 2] = alpha ? Math.round(b / alpha) : 0;
            pixels[i + 3] = Math.round((alpha / (SAMPLES * SAMPLES)) * 255);
        }
    }
    return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) =>
{
    let c = n;
    for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buffer)
{
    let c = 0xffffffff;
    for (const byte of buffer)
        c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data)
{
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(pixels)
{
    const header = Buffer.alloc(13);
    header.writeUInt32BE(SIZE, 0);
    header.writeUInt32BE(SIZE, 4);
    header[8] = 8; // 位深
    header[9] = 6; // RGBA
    const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
    for (let y = 0; y < SIZE; y++)
        pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const output = path.join(__dirname, '..', 'media', 'icon.png');
fs.writeFileSync(output, encodePng(render()));
console.log(`wrote ${path.relative(process.cwd(), output)}`);
