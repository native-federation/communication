const esbuild = require('esbuild');
const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');

const PACKAGE_NAME = '@softarc/native-federation-communication';
const FILES_TO_COPY = ['README.md', 'LICENSE.md'];
const TSCONFIG_TYPES = 'tsconfig.build.json';

// The output directory is a parameter so the bundle tests can build into their own folder.
const OUT_DIR = process.argv[2] ?? 'dist';

const OUTPUT_PATHS = {
  fesm2022: path.join(OUT_DIR, 'fesm2022', '@softarc'),
  types: path.join(OUT_DIR, 'types'),
};

const logger = {
  info: msg => console.log(`ℹ️  ${msg}`),
  success: msg => console.log(`✅ ${msg}`),
  warn: msg => console.warn(`⚠️ ${msg}`),
  error: msg => console.error(`❌ ${msg}`),
  start: msg => console.log(`🚀 ${msg}`),
  complete: msg => console.log(`✨ ${msg}`),
};

const createBaseConfig = () => ({
  platform: 'browser',
  target: 'es2022',
  define: { __NF_COMMUNICATION_VERSION__: JSON.stringify(require('./package.json').version) },
  resolveExtensions: ['.ts', '.js'],
  treeShaking: true,
  metafile: true,
  bundle: true,
  splitting: false,
});

function generateBundles() {
  const baseConfig = createBaseConfig();

  return {
    [PACKAGE_NAME]: {
      ...baseConfig,
      format: 'esm',
      entryPoints: ['src/lib/index.ts'],
      outfile: path.join(OUTPUT_PATHS.fesm2022, 'native-federation-communication.mjs'),
      minify: false,
      sourcemap: true,
    },

    [`${PACKAGE_NAME}/init-bus.js`]: {
      ...baseConfig,
      format: 'iife',
      entryPoints: ['src/scripts/init-bus.ts'],
      outfile: path.join(OUT_DIR, 'init-bus.js'),
      minify: true,
      sourcemap: false,
    },
  };
}

function generatePackageExports() {
  return {
    exports: {
      './package.json': { default: './package.json' },
      './init-bus.js': { default: './init-bus.js' },
      '.': {
        types: './types/lib/index.d.ts',
        default: `./fesm2022/${PACKAGE_NAME}.mjs`,
      },
    },
    typings: './types/lib/index.d.ts',
    module: `./fesm2022/${PACKAGE_NAME}.mjs`,
    type: 'module',
    sideEffects: ['./init-bus.js'],
  };
}

function generateTypes() {
  logger.info('Generating declaration files...');
  try {
    execFileSync(
      process.execPath,
      [require.resolve('typescript/bin/tsc'), '-p', TSCONFIG_TYPES, '--declarationDir', OUTPUT_PATHS.types],
      { stdio: 'inherit' }
    );
    logger.success('Types generated');
  } catch (err) {
    throw new Error(`Failed to generate declaration files: ${err.message}`);
  }
}

async function writePackageJson() {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const distPkg = { ...pkg, ...generatePackageExports() };
  delete distPkg.scripts;
  delete distPkg.devDependencies;
  delete distPkg.devEngines;

  await fs.writeFile(path.join(OUT_DIR, 'package.json'), JSON.stringify(distPkg, null, 2));
}

async function runBuilds(configs) {
  const results = await Promise.all(
    Object.entries(configs).map(async ([name, config]) => {
      try {
        const result = await esbuild.build(config);
        const [output] = Object.values(result.metafile.outputs);
        logger.success(`${name}: ${(output.bytes / 1024).toFixed(1)}KB`);
        return true;
      } catch (err) {
        logger.error(`${name}: ${err.message}`);
        return false;
      }
    })
  );
  if (!results.every(Boolean)) throw new Error('One or more bundles failed');
}

async function copyProjectFiles() {
  await Promise.all(FILES_TO_COPY.map(file => fs.copyFile(file, path.join(OUT_DIR, file))));
}

async function build() {
  try {
    logger.start(`Building into ${OUT_DIR}...`);

    await fs.rm(OUT_DIR, { force: true, recursive: true });
    await fs.mkdir(OUTPUT_PATHS.fesm2022, { recursive: true });

    generateTypes();
    await runBuilds(generateBundles());
    await Promise.all([writePackageJson(), copyProjectFiles()]);

    logger.complete('Build successful!');
  } catch (error) {
    logger.error(`Build failed: ${error.message}`);
    process.exit(1);
  }
}

build();
