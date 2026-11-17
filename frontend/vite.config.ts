import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, calls to /api go to the NestJS server on port 3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    // Split big libraries into their own files so browsers can cache them.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          charts: ['recharts'],
        },
      },
    },
    chunkSizeWarningLimit: 1400,
  },
})
