import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// Needed for OPFS @sqlite.org/sqlite-wasm to work.
const sqliteheaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
}


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
		headers: sqliteheaders
	},
	preview: {
		headers: sqliteheaders
	},

	optimizeDeps: {
		// Needed for @sqlite.org/sqlite-wasm dependency.
		exclude: ['@sqlite.org/sqlite-wasm'],
	},
})
