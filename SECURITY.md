# 安全策略

## 支持的版本

安全修复只针对当前主分支与最新发布版本。

| 版本 | 支持 |
| --- | --- |
| 0.8.x | 是 |
| < 0.8 | 否 |

## 设计边界

DevDeck 是本地工具，默认只监听 `127.0.0.1`：

- 页面请求必须携带启动时注入的令牌
- API 校验 `Host`、`Origin`、`Sec-Fetch-Site` 与 `Content-Type`
- 写操作只接受 `application/json`
- 服务拒绝非本机 Host，降低 DNS rebinding 风险
- 未提供远程访问、账号体系或云同步

如果自行修改绑定地址、反向代理或加入远程访问，请自行补充认证、TLS 与网络隔离。

## 报告问题

请通过 GitHub Security Advisories 私下报告：

https://github.com/xuange-hu/devdeck/security/advisories/new

报告时请包含：

- 受影响版本
- 复现步骤或最小请求
- 预期行为与实际行为
- 是否可在默认配置下触发

在修复发布前，请不要公开可直接利用的细节。