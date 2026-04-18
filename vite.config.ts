import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',   // 相对路径（Electron file:// 协议）
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 PixiJS 和 Live2D 分离为独立 chunk（延迟加载）
          'pixi': ['pixi.js'],
          'live2d': ['pixi-live2d-display'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['pixi.js', 'pixi-live2d-display'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  define: {
    // pixi-live2d-display 内部检查
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
