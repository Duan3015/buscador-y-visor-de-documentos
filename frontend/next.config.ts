import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Monorepo: las dependencias estan hoisted en la raiz del repositorio.
  turbopack: { root: path.resolve(process.cwd(), '..') },
};

export default config;
