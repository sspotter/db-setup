const fs = require('fs-extra');
const path = require('path');
const { minify } = require('terser');
const archiver = require('archiver');

// ==========================
// ⚙️ CONFIG
// ==========================

const CONFIG = {
    SRC_DIR: path.join(__dirname, 'extension'),
    OUTPUT_ROOT: path.join(__dirname, 'outputfolder'),

    BASE_EXCLUDED: [
        'generate_icons.js',
        'test-ui.js',
        'test-version.js',
        'update_dev.json',
        'update_copy.json'
    ],

    REVIEW_EXCLUDED: [
        'tests',
        '__tests__',
        'scripts',
        'option2.js'
    ],

    SPECIAL_MINIFY_FOLDERS: ['utils', 'update-module']
};


// ==========================
// 🔢 VERSION SYSTEM
// ==========================

function parseVersion(name) {
    const match = name.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;

    return {
        major: +match[1],
        minor: +match[2],
        patch: +match[3]
    };
}

function compareVersions(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
}

async function getAutoVersion(outputDir) {
    if (!await fs.pathExists(outputDir)) return '1.0.0';

    const items = await fs.readdir(outputDir);

    const versions = items.map(parseVersion).filter(Boolean);
    if (!versions.length) return '1.0.0';

    versions.sort(compareVersions);

    const last = versions[versions.length - 1];
    return `${last.major}.${last.minor}.${last.patch + 1}`;
}

function getVersionFromArg(arg) {
    const match = arg.match(/^v(\d+)\.(\d+)(?:\.(\d+))?$/);
    if (!match) return null;

    return {
        major: +match[1],
        minor: +match[2],
        patch: match[3] === undefined ? null : +match[3]
    };
}

async function getNextPatch(outputDir, major, minor) {
    if (!await fs.pathExists(outputDir)) return 0;

    const items = await fs.readdir(outputDir);

    const patches = items
        .map(parseVersion)
        .filter(v => v && v.major === major && v.minor === minor)
        .map(v => v.patch);

    if (!patches.length) return 0;

    return Math.max(...patches) + 1;
}

async function resolveVersion(outputDir) {
    const arg = process.argv[2];

    if (arg) {
        const manual = getVersionFromArg(arg);
        if (!manual) {
            console.error('❌ Invalid version format. Use: vX.Y or vX.Y.Z');
            process.exit(1);
        }

        // vX.Y.Z → build exactly that version (overwrite guard still applies)
        if (manual.patch !== null) {
            return `${manual.major}.${manual.minor}.${manual.patch}`;
        }

        // vX.Y → take the next free patch in that series
        const patch = await getNextPatch(outputDir, manual.major, manual.minor);
        if (patch > 0) {
            console.log(`ℹ️  v${manual.major}.${manual.minor} already in use → bumping to v${manual.major}.${manual.minor}.${patch}`);
        }
        return `${manual.major}.${manual.minor}.${patch}`;
    }

    return await getAutoVersion(outputDir);
}


// ==========================
// 🚀 BUILD
// ==========================

async function build() {
    try {
        const VERSION = await resolveVersion(CONFIG.OUTPUT_ROOT);

        const VERSION_DIR = path.join(CONFIG.OUTPUT_ROOT, `v${VERSION}`);
        const DIST_DIR = path.join(VERSION_DIR, 'dist');
        const CLEAN_DEV_DIR = path.join(VERSION_DIR, 'clean_dev');
        const CLEAN_REVIEW_DIR = path.join(VERSION_DIR, 'clean_review');

        const ZIP_NAME = `tiksurfer_v${VERSION}.zip`;
        const ZIP_PATH = path.join(VERSION_DIR, ZIP_NAME);

        console.log(`\n🚀 Building v${VERSION}\n`);

        // 🛑 Prevent overwrite
        if (await fs.pathExists(VERSION_DIR)) {
            console.error(`❌ Version already exists: v${VERSION}`);
            process.exit(1);
        }

        // 📁 Setup folders
        await fs.ensureDir(DIST_DIR);
        await fs.ensureDir(CLEAN_DEV_DIR);
        await fs.ensureDir(CLEAN_REVIEW_DIR);

        // 📝 README
        const COMMIT_MESSAGE = process.argv[3];
        await createReadme(VERSION_DIR, VERSION, COMMIT_MESSAGE);

        // ==========================
        // 📦 DIST BUILD
        // ==========================
        const files = await fs.readdir(CONFIG.SRC_DIR);

        for (const file of files) {
            if (CONFIG.BASE_EXCLUDED.includes(file)) continue;

            const srcPath = path.join(CONFIG.SRC_DIR, file);
            const distPath = path.join(DIST_DIR, file);
            const stats = await fs.stat(srcPath);

            if (stats.isDirectory()) {
                await handleDirectory(srcPath, distPath, file);
            } else {
                await handleFile(srcPath, distPath, file);
            }
        }

        console.log('\n✅ Dist ready');

        // ==========================
        // 🧼 CLEAN BUILDS
        // ==========================
        await copyRecursive(CONFIG.SRC_DIR, CLEAN_DEV_DIR, CONFIG.BASE_EXCLUDED);
        console.log('  🟢 clean_dev ready');

        await copyRecursiveReview(
            CONFIG.SRC_DIR,
            CLEAN_REVIEW_DIR,
            [...CONFIG.BASE_EXCLUDED, ...CONFIG.REVIEW_EXCLUDED]
        );
        console.log('  🔵 clean_review ready');

        // ==========================
        // 📦 ZIP
        // ==========================
        await createZip(DIST_DIR, ZIP_PATH);

        console.log(`\n📦 ${ZIP_NAME}`);
        console.log(`🎉 Build v${VERSION} completed\n`);

    } catch (err) {
        console.error('❌ Build failed:', err);
        process.exit(1);
    }
}


// ==========================
// 📂 HANDLERS
// ==========================

async function handleDirectory(srcDir, distDir, folderName) {
    if (CONFIG.SPECIAL_MINIFY_FOLDERS.includes(folderName)) {
        await fs.ensureDir(distDir);

        const files = await fs.readdir(srcDir);

        for (const file of files) {
            const src = path.join(srcDir, file);
            const dist = path.join(distDir, file);

            if (file.endsWith('.js') && !file.endsWith('.min.js')) {
                await minifyAndSave(src, dist);
            } else {
                await fs.copy(src, dist);
            }
        }
    } else {
        await fs.copy(srcDir, distDir);
    }
}

async function handleFile(src, dist, fileName) {
    if (fileName.endsWith('.js')) {
        await minifyAndSave(src, dist);
    } else {
        await fs.copy(src, dist);
    }
}


// ==========================
// 🧼 CLEAN COPY
// ==========================

async function copyRecursive(srcDir, destDir, excluded) {
    const items = await fs.readdir(srcDir);

    for (const item of items) {
        if (excluded.includes(item)) continue;

        const srcPath = path.join(srcDir, item);
        const destPath = path.join(destDir, item);
        const stats = await fs.stat(srcPath);

        if (stats.isDirectory()) {
            await fs.ensureDir(destPath);
            await copyRecursive(srcPath, destPath, excluded);
        } else {
            await fs.copy(srcPath, destPath);
        }
    }
}

async function copyRecursiveReview(srcDir, destDir, excluded) {
    const items = await fs.readdir(srcDir);

    for (const item of items) {
        if (excluded.includes(item)) continue;

        const srcPath = path.join(srcDir, item);
        const destPath = path.join(destDir, item);
        const stats = await fs.stat(srcPath);

        if (stats.isDirectory()) {
            await fs.ensureDir(destPath);
            await copyRecursiveReview(srcPath, destPath, excluded);
        } else {
            if (item.endsWith('.js')) {
                let code = await fs.readFile(srcPath, 'utf8');
                code = code.replace(/console\.(log|debug|info)\(.*?\);?/g, '');
                await fs.writeFile(destPath, code);
            } else {
                await fs.copy(srcPath, destPath);
            }
        }
    }
}


// ==========================
// ⚙️ MINIFY
// ==========================

async function minifyAndSave(src, dist) {
    const code = await fs.readFile(src, 'utf8');

    const result = await minify(code, {
        mangle: true,
        compress: {
            passes: 2,
            dead_code: true
        }
    });

    if (result.error) throw result.error;

    await fs.writeFile(dist, result.code);
}


// ==========================
// 📝 README
// ==========================

async function createReadme(dir, version, message) {
    const commitSection = message
        ? `\nCommit:\n${message.replace(/\\n/g, '\n')}\n`
        : '';

    const content = `# Build v${version}

Generated automatically.
${commitSection}
Contents:
- dist → production build
- clean_dev → full source
- clean_review → stripped for review
`;

    await fs.writeFile(path.join(dir, 'README.md'), content);
}


// ==========================
// 📦 ZIP
// ==========================

function createZip(sourceDir, outPath) {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outPath);

    return new Promise((resolve, reject) => {
        archive
            .directory(sourceDir, false)
            .on('error', reject)
            .pipe(stream);

        stream.on('close', resolve);
        archive.finalize();
    });
}


// ▶️ RUN
build();