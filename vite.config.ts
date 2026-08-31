import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_')
  const apiTarget = environment.VITE_API_TARGET || 'http://127.0.0.1:8787'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
        '/status.json': { target: apiTarget, changeOrigin: false },
      },
    },
  }
})
