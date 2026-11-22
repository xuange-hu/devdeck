# 贡献指南

## 开发环境

- Node.js 20 或 22
- npm 10+
- Windows / macOS / Linux 均可

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## 代码约定

- 保持零运行时依赖；新增依赖前先说明理由
- TypeScript strict 模式，避免 `any`
- Web 控制台保持单文件内联，不引入外部 CDN
- 跨平台逻辑必须同时考虑 Windows（netstat / PowerShell）与 macOS/Linux（lsof / ss）
- 新增 API 必须更新 README，并补充令牌/Origin/Content-Type 相关测试
- 新增前端功能必须补充 `test/frontend.test.ts` 的完整性断言

## 提交 PR

1. 从 `main` 创建分支
2. 修改后运行 `npm run typecheck && npm test`
3. 在 PR 描述中写明动机、行为变化与验证方式
4. 涉及 UI 的改动请附截图或说明浏览器验证结果

## 安全

安全问题不要开公开 Issue，按 `SECURITY.md` 的方式私下报告。