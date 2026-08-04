const { Jimp } = require('jimp');
const path = require('path');
const fs = require('fs');

const SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = path.join(__dirname, 'icons');
const BASE_SIZE = 512;

// Instagram Gradient Colors
const COLORS = [
    { pos: 0, color: '#833ab4' }, // Purple
    { pos: 0.5, color: '#fd1d1d' }, // Red
    { pos: 1, color: '#fcb045' }  // Orange
];

function lerpColor(c1, c2, t) {
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    const a = Math.round(c1.a + (c2.a - c1.a) * t);
    return Jimp.rgbaToInt(r, g, b, a);
}

function getGradientColor(pct, alpha = 255) {
    let c1, c2, t;
    if (pct <= 0.5) {
        c1 = Jimp.intToRGBA(Jimp.cssColorToHex(COLORS[0].color));
        c2 = Jimp.intToRGBA(Jimp.cssColorToHex(COLORS[1].color));
        t = pct * 2;
    } else {
        c1 = Jimp.intToRGBA(Jimp.cssColorToHex(COLORS[1].color));
        c2 = Jimp.intToRGBA(Jimp.cssColorToHex(COLORS[2].color));
        t = (pct - 0.5) * 2;
    }
    const res = Jimp.intToRGBA(lerpColor(c1, c2, t));
    return Jimp.rgbaToInt(res.r, res.g, res.b, alpha);
}

async function generate() {
    console.log('Generating Geometric Matrix Logo...');
    
    const image = new Jimp(BASE_SIZE, BASE_SIZE, 0x00000000);

    // Draw Gradients and Shapes
    // Since Jimp is pixel-based, we'll scan and draw diamonds
    
    image.scan(0, 0, BASE_SIZE, BASE_SIZE, function(x, y, idx) {
        const cx = BASE_SIZE / 2;
        const cy = BASE_SIZE / 2;
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const dist = dx + dy; // Diamond distance
        
        const pctX = x / BASE_SIZE;
        const pctY = y / BASE_SIZE;
        const gradPct = (pctX + pctY) / 2;

        // Outer Diamond 1 (90% width)
        if (dist < BASE_SIZE * 0.45) {
            const color = getGradientColor(gradPct, 25);
            this.bitmap.data[idx] = (color >> 24) & 0xff;
            this.bitmap.data[idx + 1] = (color >> 16) & 0xff;
            this.bitmap.data[idx + 2] = (color >> 8) & 0xff;
            this.bitmap.data[idx + 3] = color & 0xff;
        }
        
        // Outer Diamond 2 (70% width)
        if (dist < BASE_SIZE * 0.35) {
            const color = getGradientColor(gradPct, 51);
            this.bitmap.data[idx] = (color >> 24) & 0xff;
            this.bitmap.data[idx + 1] = (color >> 16) & 0xff;
            this.bitmap.data[idx + 2] = (color >> 8) & 0xff;
            this.bitmap.data[idx + 3] = color & 0xff;
        }

        // Core Diamond (50% width)
        if (dist < BASE_SIZE * 0.25) {
            const color = getGradientColor(gradPct, 255);
            this.bitmap.data[idx] = (color >> 24) & 0xff;
            this.bitmap.data[idx + 1] = (color >> 16) & 0xff;
            this.bitmap.data[idx + 2] = (color >> 8) & 0xff;
            this.bitmap.data[idx + 3] = color & 0xff;
        }

        // Inner White Diamond (30% width)
        if (dist < BASE_SIZE * 0.15) {
            this.bitmap.data[idx] = 255;
            this.bitmap.data[idx + 1] = 255;
            this.bitmap.data[idx + 2] = 255;
            this.bitmap.data[idx + 3] = 255;
        }
    });

    // Add Accents (Dots)
    // Jimp doesn't have a simple circle but we can scan again
    image.scan(0, 0, BASE_SIZE, BASE_SIZE, function(x, y, idx) {
        const dots = [
            { x: BASE_SIZE * 0.5, y: BASE_SIZE * 0.15 },
            { x: BASE_SIZE * 0.5, y: BASE_SIZE * 0.85 },
            { x: BASE_SIZE * 0.15, y: BASE_SIZE * 0.5 },
            { x: BASE_SIZE * 0.85, y: BASE_SIZE * 0.5 }
        ];

        for (const dot of dots) {
            const d = Math.sqrt((x - dot.x)**2 + (y - dot.y)**2);
            if (d < BASE_SIZE * 0.02) {
                this.bitmap.data[idx] = 255;
                this.bitmap.data[idx + 1] = 255;
                this.bitmap.data[idx + 2] = 255;
                this.bitmap.data[idx + 3] = 200;
            }
        }
    });

    // Save sizes
    for (const size of SIZES) {
        const out = image.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
        await out.writeAsync(path.join(OUTPUT_DIR, `icon${size}.png`));
        console.log(`Generated icon${size}.png`);
    }

    // Save high-res for concept reference
    await image.writeAsync(path.join(OUTPUT_DIR, `insta_matrix_logo.png`));
    console.log('Done!');
}

generate().catch(console.error);
