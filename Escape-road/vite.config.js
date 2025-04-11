import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import Sitemap from 'vite-plugin-sitemap'
import { games } from './src/data/games'

// 从 games 数据中提取 addressBar 并生成路由路径 (去掉 /game/ 前缀)
const gameRoutes = Object.values(games)
  .map(game => game.addressBar ? `/${game.addressBar.trim()}` : null)
  .filter(route => route !== null);

// *** 关键部分：你需要提供你的实际游戏路由列表 ***
// 你需要根据你的游戏数据生成这个数组
// const dynamicRoutes = Object.values(games)
//   .map(game => game.addressBar ? `/${game.addressBar.toLowerCase()}` : null)
//   .filter(Boolean);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
    Sitemap({
      hostname: 'https://escape-road-online.com/', // !!! 重要：替换成你的网站最终域名 !!!
      dynamicRoutes: gameRoutes, // 使用修正后的 gameRoutes
      // 可选配置:
      // changefreq: 'weekly', // 页面更新频率
      // priority: 0.7, // 页面优先级
      // outDir: 'dist', // 输出目录 (默认就是 dist)
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
