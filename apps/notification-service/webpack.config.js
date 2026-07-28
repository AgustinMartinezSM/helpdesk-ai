const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { IgnorePlugin } = require('webpack');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    // @nestjs/mapped-types probes class-transformer/storage inside a
    // try/catch at runtime; the deep path does not exist in
    // class-transformer 0.5, so webpack must not treat it as a hard error.
    new IgnorePlugin({ resourceRegExp: /^class-transformer\/storage$/ }),
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
    // NxAppWebpackPlugin overwrites root-level `externals`, so shared
    // runtime packages are appended AFTER it by this inline plugin.
    // class-transformer/class-validator MUST stay external: Nest's
    // ValidationPipe loads them dynamically at runtime (loadPackage), which
    // webpack cannot rewrite — bundling them gives the DTO decorators a
    // second, private copy whose metadata storage the pipe never sees, and
    // @Type() conversions silently stop working in production bundles.
    {
      apply(compiler) {
        const existing = compiler.options.externals;
        const runtimeShared = {
          'class-transformer': 'commonjs class-transformer',
          'class-validator': 'commonjs class-validator',
        };
        compiler.options.externals = Array.isArray(existing)
          ? [...existing, runtimeShared]
          : existing
            ? [existing, runtimeShared]
            : [runtimeShared];
      },
    },
  ],
};
