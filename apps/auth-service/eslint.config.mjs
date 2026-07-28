import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // Generated Prisma client — not hand-written code.
    ignores: ['src/generated'],
  },
];
