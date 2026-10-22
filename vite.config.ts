import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createLanRelay } from './bin/lan-relay.js'
import pkg from './package.json'
import { createControlLabRelay } from './server/controlLab'
import { controlLabStorage } from './server/controlLabStorage'
import { resolve } from 'node:path'

/** 把 `battle-city host` 的联机中继挂到 dev server 上；HMR 的升级请求路径不同，互不干扰 */
function lanRelay(): Plugin {
  return {
    name: 'battle-city-lan-relay',
    configureServer(server) {
      const relay = createLanRelay({ base: server.config.base })
      const lab = createControlLabRelay({
        base: server.config.base,
        storage: controlLabStorage(resolve(server.config.root, 'config/sterowanie.json')),
      })
      // 直接挂在 configureServer 里，排在 vite 的 base 重定向之前
      server.middlewares.use((req, res, next) => {
        if (!lab.handleRequest(req, res) && !relay.handleRequest(req, res)) next()
      })
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!lab.handleUpgrade(req, socket, head)) relay.handleUpgrade(req, socket, head)
      })
      server.httpServer?.on('close', () => {
        relay.close()
        lab.close()
      })
    },
  }
}

// 开发服务器沿用旧版 GitHub Pages 的 /battle-city/ 子路径；打包都用 --base ./，放在哪个路径下都能打开
export default defineConfig({
  base: '/battle-city/',
  plugins: [react(), lanRelay()],
  // 帮助面板里显示的版本号与编译时间（旧版 COMPILE_VERSION / COMPILE_DATE）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('zh-CN', { hour12: false })),
  },
  // serwer party (vite build --ssr server/main.ts) to jeden plik bez node_modules — łatwo wrzucić na VPS
  ssr: { noExternal: true },
  build: { commonjsOptions: { ignore: ['bufferutil', 'utf-8-validate'] } },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
