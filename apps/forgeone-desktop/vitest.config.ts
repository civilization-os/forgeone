import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.{ts,tsx,js}'],
    css: true,
    server: {
      deps: {
        inline: ['react'],
      },
    },
  },
});
