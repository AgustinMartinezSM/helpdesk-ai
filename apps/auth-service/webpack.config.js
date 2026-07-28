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
      externalDependencies: 'all',
    }),
    // @nestjs/mapped-types probes class-transformer/storage inside a
    // try/catch at runtime; the deep path does not exist in
    // class-transformer 0.5, so webpack must not treat it as a hard error.
    new IgnorePlugin({ resourceRegExp: /^class-transformer\/storage$/ }),
    // NxAppWebpackPlugin overwrites `externals` from the config root, so the
    // native-module exclusion must be appended AFTER it configures the
    // compiler. argon2 is a native N-API module and a direct dependency of
    // this app: it must be required from node_modules at runtime — inlining
    // it makes the prebuilt binary unresolvable from dist.
    {
      apply(compiler) {
        const existing = compiler.options.externals;
        const nativeExternals = { argon2: 'commonjs argon2' };
        compiler.options.externals = Array.isArray(existing)
          ? [...existing, nativeExternals]
          : existing
            ? [existing, nativeExternals]
            : [nativeExternals];
      },
    },
  ],
};
