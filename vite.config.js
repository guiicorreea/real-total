import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Caminhos relativos: o mesmo build funciona na raiz de um dominio
  // e em um subpath de projeto do GitHub Pages, como /real-total/.
  base: './',
  plugins: [react()],
})
