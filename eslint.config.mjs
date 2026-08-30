import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // next-env.d.ts lo genera Next en cada build; los archivos de configuración
    // exportan objetos anónimos por contrato de sus herramientas.
    ignores: [
      '.next/**',
      'node_modules/**',
      'scripts/**',
      'next-env.d.ts',
      '*.config.mjs',
      'next.config.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
