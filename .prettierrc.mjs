/** @type {import("prettier").Config} */
const config = {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  printWidth: 100,
  trailingComma: 'es5',
  endOfLine: 'lf',
  arrowParens: 'always',
  bracketSpacing: true,
  overrides: [
    {
      files: '*.css',
      options: {
        printWidth: 120,
      },
    },
    {
      files: '*.md',
      options: {
        proseWrap: 'preserve',
      },
    },
  ],
};

export default config;
