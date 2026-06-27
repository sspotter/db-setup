// const Jimp = require('jimp');
// const path = require('path');
// const fs = require('fs');

// /**
//  * CONFIGURATION
//  * Change these variables to customize your icon!
//  */
// const CONFIG = {
//     // Colors for the 3-point gradient (Hex format)
//     colors: {
//         top: '#833ab4',    // Purple (Instagram-like)
//         middle: '#fd1d1d', // Red
//         bottom: '#fcb045'  // Yellow/Orange
//     },
//     // Text settings
//     text: 'IvxcvxcS',
//     fontSize: Jimp.FONT_SANS_64_WHITE, // Built-in Jimp font
    
//     // Output settings
//     outputDir: path.join(__dirname,  'extension', 'icons'),
//     sizes: [16, 32, 48, 128],
//     baseSize: 512 // Generate at high res then downscale
// };

// /**
//  * Draws a 3-point linear gradient on a Jimp image
//  */
// function drawGradient(image, colors) {
//     const width = image.bitmap.width;
//     const height = image.bitmap.height;

//     const c1 = Jimp.cssColorToHex(colors.top);
//     const c2 = Jimp.cssColorToHex(colors.middle);
//     const c3 = Jimp.cssColorToHex(colors.bottom);

//     image.scan(0, 0, width, height, function(x, y, idx) {
//         let r, g, b;
//         const pct = y / height;

//         if (pct < 0.5) {
//             // Interpolate between top and middle
//             const subPct = pct * 2;
//             r = ((c1 >> 24) & 0xff) * (1 - subPct) + ((c2 >> 24) & 0xff) * subPct;
//             g = ((c1 >> 16) & 0xff) * (1 - subPct) + ((c2 >> 16) & 0xff) * subPct;
//             b = ((c1 >> 8) & 0xff) * (1 - subPct) + ((c2 >> 8) & 0xff) * subPct;
//         } else {
//             // Interpolate between middle and bottom
//             const subPct = (pct - 0.5) * 2;
//             r = ((c2 >> 24) & 0xff) * (1 - subPct) + ((c3 >> 24) & 0xff) * subPct;
//             g = ((c2 >> 16) & 0xff) * (1 - subPct) + ((c3 >> 16) & 0xff) * subPct;
//             b = ((c2 >> 8) & 0xff) * (1 - subPct) + ((c3 >> 8) & 0xff) * subPct;
//         }

//         this.bitmap.data[idx] = r;
//         this.bitmap.data[idx + 1] = g;
//         this.bitmap.data[idx + 2] = b;
//         this.bitmap.data[idx + 3] = 255; // Alpha
//     });
// }

// async function generateIconsFromScratch() {
//     try {
//         console.log('🚀 Starting dynamic icon generation...');

//         // 1. Ensure output directory exists
//         if (!fs.existsSync(CONFIG.outputDir)) {
//             fs.mkdirSync(CONFIG.outputDir, { recursive: true });
//         }

//         // 2. Create high-res base image
//         console.log(`🎨 Creating ${CONFIG.baseSize}x${CONFIG.baseSize} base canvas...`);
//         const image = new Jimp(CONFIG.baseSize, CONFIG.baseSize);

//         // 3. Draw Gradient
//         console.log('🌈 Drawing 3-point gradient...');
//         drawGradient(image, CONFIG.colors);

//         // 4. Add Text Overlay
//         console.log(`✍️ Adding text: "${CONFIG.text}"...`);
//         const font = await Jimp.loadFont(Jimp.FONT_SANS_128_WHITE);
        
//         // Measure text for centering
//         const textWidth = Jimp.measureText(font, CONFIG.text);
//         const textHeight = Jimp.measureTextHeight(font, CONFIG.text, CONFIG.baseSize);

//         image.print(
//             font,
//             (CONFIG.baseSize - textWidth) / 2,
//             (CONFIG.baseSize - textHeight) / 2,
//             CONFIG.text
//         );

//         // 5. Generate each size by downscaling
//         for (const size of CONFIG.sizes) {
//             const outputPath = path.join(CONFIG.outputDir, `icon${size}.png`);
//             console.log(`📦 Downscaling to ${size}x${size}...`);
            
//             const resized = image.clone().resize(size, size, Jimp.RESIZE_BEZIER);
//             await resized.writeAsync(outputPath);
//             console.log(`✅ Saved: ${outputPath}`);
//         }

//         console.log('\n✨ Dynamic icons generated successfully!');
//     } catch (error) {
//         console.error('❌ Error generating icons:', error);
//     }
// }

// generateIconsFromScratch();


const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

/**
 * CONFIGURATION
 * Change these variables to customize your icon!
 */
const CONFIG = {
    // Colors for the 3-point gradient (Hex format)
    colors: {
        top: '#eaff00ce',    // Purple (Instagram-like)
        middle: '#fdab1de4', // Red
        bottom: '#9d00ffc4'  // Yellow/Orange
    },
    // Text settings
    text: 'Insta_Multi',
    fontSize: Jimp.FONT_SANS_64_WHITE, // Built-in Jimp font
    
    // Output settings
    outputDir: path.join(__dirname,  'extension', 'icons'),
    sizes: [16, 32, 48, 128],
    baseSize: 512 // Generate at high res then downscale
};

/**
 * Draws a 3-point linear gradient on a Jimp image
 */
function drawGradient(image, colors) {
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    const c1 = Jimp.cssColorToHex(colors.top);
    const c2 = Jimp.cssColorToHex(colors.middle);
    const c3 = Jimp.cssColorToHex(colors.bottom);

    image.scan(0, 0, width, height, function(x, y, idx) {
        let r, g, b;
        const pct = y / height;

        if (pct < 0.5) {
            // Interpolate between top and middle
            const subPct = pct * 2;
            r = ((c1 >> 24) & 0xff) * (1 - subPct) + ((c2 >> 24) & 0xff) * subPct;
            g = ((c1 >> 16) & 0xff) * (1 - subPct) + ((c2 >> 16) & 0xff) * subPct;
            b = ((c1 >> 8) & 0xff) * (1 - subPct) + ((c2 >> 8) & 0xff) * subPct;
        } else {
            // Interpolate between middle and bottom
            const subPct = (pct - 0.5) * 2;
            r = ((c2 >> 24) & 0xff) * (1 - subPct) + ((c3 >> 24) & 0xff) * subPct;
            g = ((c2 >> 16) & 0xff) * (1 - subPct) + ((c3 >> 16) & 0xff) * subPct;
            b = ((c2 >> 8) & 0xff) * (1 - subPct) + ((c3 >> 8) & 0xff) * subPct;
        }

        this.bitmap.data[idx] = r;
        this.bitmap.data[idx + 1] = g;
        this.bitmap.data[idx + 2] = b;
        this.bitmap.data[idx + 3] = 255; // Alpha
    });
}

async function generateIconsFromScratch() {
    try {
        console.log('🚀 Starting dynamic icon generation...');

        // 1. Ensure output directory exists
        if (!fs.existsSync(CONFIG.outputDir)) {
            fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        }

        // 2. Create high-res base image
        console.log(`🎨 Creating ${CONFIG.baseSize}x${CONFIG.baseSize} base canvas...`);
        const image = new Jimp(CONFIG.baseSize, CONFIG.baseSize);

        // 3. Draw Gradient
        console.log('🌈 Drawing 3-point gradient...');
        drawGradient(image, CONFIG.colors);

        // 4. Add Text Overlay
        console.log(`✍️ Adding text: "${CONFIG.text}"...`);
        const font = await Jimp.loadFont(Jimp.FONT_SANS_128_WHITE);
        
        // Measure text for centering
        const textWidth = Jimp.measureText(font, CONFIG.text);
        const textHeight = Jimp.measureTextHeight(font, CONFIG.text, CONFIG.baseSize);

        image.print(
            font,
            (CONFIG.baseSize - textWidth) / 2,
            (CONFIG.baseSize - textHeight) / 2,
            CONFIG.text
        );

        // 5. Generate each size by downscaling
        for (const size of CONFIG.sizes) {
            const outputPath = path.join(CONFIG.outputDir, `icon${size}.png`);
            console.log(`📦 Downscaling to ${size}x${size}...`);
            
            const resized = image.clone().resize(size, size, Jimp.RESIZE_BEZIER);
            await resized.writeAsync(outputPath);
            console.log(`✅ Saved: ${outputPath}`);
        }

        console.log('\n✨ Dynamic icons generated successfully!');
    } catch (error) {
        console.error('❌ Error generating icons:', error);
    }
}

generateIconsFromScratch();
