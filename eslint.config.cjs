const tseslint = require('@electron-toolkit/eslint-config-ts')
const reactPlugin = require('eslint-plugin-react')
const configPrettier = require('@electron-toolkit/eslint-config-prettier')

module.exports = tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'out/**', '.gitignore']
  },
  ...tseslint.configs.recommended,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-control-regex': 'off',
      'no-empty': 'off'
    },
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  configPrettier
)
