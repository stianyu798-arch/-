import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站任意子路径均可：相对资源路径，避免写死仓库名
// https://vite.dev/config/shared-options.html#base
export default defineConfig({
  plugins: [react()],
  base: './',
})
