import os from 'node:os'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** IP для доступа с телефона (192.168.x / 10.x / 172.16–31.x). Без VPN-диапазона 198.18.x. */
function pickLanIPv4(): string | undefined {
  const nets = os.networkInterfaces()
  const found: string[] = []
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      const a = net.address
      if (a.startsWith('198.18.')) continue // часто служебный интерфейс VPN
      if (a.startsWith('169.254.')) continue // link-local
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(a)) found.push(a)
    }
  }
  found.sort((a, b) => {
    if (a.startsWith('192.168.')) return b.startsWith('192.168.') ? a.localeCompare(b) : -1
    if (b.startsWith('192.168.')) return 1
    return a.localeCompare(b)
  })
  return found[0]
}

const lanHost = process.env.VITE_DEV_HOST ?? pickLanIPv4()

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    {
      name: 'lan-url-hint',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const port = server.config.server.port ?? 5173
          if (lanHost) {
            console.log(`\n  ➜  Телефон (та же Wi‑Fi): http://${lanHost}:${port}/`)
            console.log(`      (не используйте 198.18.x.x — это часто VPN)\n`)
          }
        })
      },
    },
  ],
  server: {
    // 0.0.0.0 — слушаем все интерфейсы (доступ по LAN-IP)
    host: '0.0.0.0',
    port: 5173,
    // Явный HMR-host: иначе на телефоне страница может грузиться, а WS цепляется за localhost телефона
    ...(lanHost ? { hmr: { host: lanHost } } : {}),
    // Разрешить любой Host (удобно для .local / нестандартных имён в LAN; только для dev)
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
