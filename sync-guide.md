# 🔄 平台同步到 GitHub 操作指南

## 背景

本项目由 z.ai（ClawdBot）AI 平台生成，部署在 GitHub + Vercel。
平台更新后需要经过"清理 → 验证 → 推送"三步才能上线。

---

## 每次同步的标准流程

### Step 1：清理平台专属文件

这些文件是 z.ai 平台的，GitHub/Vercel 不需要，应当删除：

```bash
# 删除 z.ai 平台脚本（Linux Bash，Vercel 不需要）
rm -rf .zscripts/

# 删除 Caddy 反向代理配置（Vercel 自带路由）
rm -f Caddyfile

# 删除 AI Agent 上下文文件
rm -rf agent-ctx/

# 删除 Mini-services 空目录
rm -rf mini-services/

# 删除示例代码
rm -rf examples/

# 删除开发日志
rm -f worklog.md

# 删除上传备份目录
rm -rf upload/

# 删除 QA 截图目录（如不需要）
rm -rf download/
```

### Step 2：清理死依赖

检查 `package.json` 中是否有未使用的依赖，常见需要删除的：

- `@prisma/client` — 本项目无数据库
- `prisma` — 同上
- `next-auth` — 无用户系统
- `bun-types` — 已切换到 npm
- `z-ai-web-dev-sdk` — z.ai 平台 SDK，Vercel 不需要

### Step 3：确保 package.json scripts 正确

```json
{
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  }
}
```

### Step 4：确保 next.config.ts 正确

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
};
export default nextConfig;
```

### Step 5：本地验证

```bash
npm install
npm run build
```

✅ 构建成功才能继续。

### Step 6：提交并推送

```bash
git add -A
git commit -m "sync: platform update $(date +%Y-%m-%d)"
git push origin main
```

### Step 7：Vercel 自动部署

推送后 Vercel 会自动检测到新 commit 并重新部署，无需手动操作。

---

## 注意事项

- `.env` 文件不要提交（已在 .gitignore 中）
- `node_modules` 不要提交（已在 .gitignore 中）
- 如果 GitHub 推送失败（国内网络），使用 SSH 或代理
