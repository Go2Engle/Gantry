import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|react-router-dom)\//.test(id)) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-ui'
          }
        }
      }
    }
  }
})
