import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * 鱼阵编辑器 —— **纯 web 内部工具**，不进任何游戏包。
 *
 * 为什么它不在 Cocos 工程里：编辑器要复用的是游戏的**逻辑**（`FishVM` / `pathSystem` /
 * `waveFeeder` / `render-map`），而那些本来就零 `cc`、是普通 TS 模块 —— 复用它们不需要
 * Cocos。留在 Cocos 里换来的只有「用一个没有 CSS 的 UI 工具重画一遍」，以及一个只有策划
 * 用的工具跟着产品一起下发给玩家。判据见 `docs/design/…-fish-editor-html.md`。
 *
 * 它**没有自己的 package.json**：monorepo 是 `nodeLinker: hoisted`，vite 和 bitecs 都在根
 * `node_modules` 里，再挂一层工作区包只是多一次 install。入口是根脚本 `pnpm editor`。
 */
export default defineConfig({
  root: at('.'),
  // 别名跟 `vitest.config.ts` 保持一致：直接吃源码，省掉「改完 kit 得先 build 才看得见」
  resolve: {
    alias: {
      '@cck/core': at('../../packages/core/src/index.ts'),
      '@cck/ecs-bitecs': at('../../packages/ecs-bitecs/src/index.ts'),
      // 游戏本体那份零 `cc` 的逻辑与美术。**编辑器与游戏的唯一接缝就是它**。
      '@game': at('../demo/assets/modules/mini-fish'),
    },
  },
  server: {
    port: 5174,
    // 图集与逻辑都在 `apps/demo/` 下，在 root 之外 —— 不放行 dev server 会 403
    fs: { allow: [at('../..')] },
  },
  build: { outDir: at('dist'), emptyOutDir: true },
});
