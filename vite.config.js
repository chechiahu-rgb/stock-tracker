import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      manifest: {
        name: '個人資產管理系統',
        short_name: '資產管理',
        description: '台美股純單機記帳系統',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [{
            src: 'https://www.google.com/s2/favicons?sz=192&domain=google.com',
            sizes: '192x192',
            type: 'image/png'
        }]
      }
    })
  ],
  // 新增這個 server 區塊：這是突破 CORS 最穩定的本地解法
  server: {
    proxy: {
      '/yahoo': {
        target: 'https://query1.finance.yahoo.com', // 真實目標網址
        changeOrigin: true, // 偽裝來源
        rewrite: (path) => path.replace(/^\/yahoo/, '') // 將 /yahoo 替換為空
      }
    }
  }
})