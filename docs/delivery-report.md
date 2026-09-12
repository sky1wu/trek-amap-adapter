# MVP 交付报告

## 已实现

三个 TREK Places 兼容接口、`amap_` 稳定 ID、集中高德数据 mapper、GCJ-02/WGS-84 迭代转换、城市偏好降级、TTL/LRU 缓存、健康检查、可选适配器鉴权、输入/上游校验、安全日志和错误码转换。

## 新增文件

- `src/app.ts`、`server.ts`、`config.ts`、`service.ts`、`cache.ts`、`errors.ts`：服务与生命周期。
- `src/amap/`：固定域名 HTTP 客户端、响应 schema、POI/提示 mapper。
- `src/google/`：TREK 请求 schema、输出类型和 ID 编解码。
- `src/geo/`：高德 GCJ-02 适用范围数据、范围判断、坐标正反转换。
- `test/`：坐标、ID、mapper、缓存、TREK HTTP 契约、异常和密钥保护测试。
- `scripts/smoke.ts`：使用真实 Key 的十地点 API 验证与坐标记录。
- `Dockerfile`、`.dockerignore`、`docker-compose.example.yml`、`.env.example`：部署。
- `.github/workflows/ci.yml`：Node 22/24 检查及 Linux amd64/arm64 容器构建/健康检查。
- `README.md`、本目录文档、`THIRD_PARTY_NOTICES.md`：部署、接口调研、坐标验证和数据来源。
- TypeScript/ESLint/Prettier/Vitest 配置、`package.json` 与锁文件、Git 忽略规则。

原始任务书不纳入版本控制，未改动原文件。项目无数据库，无 TREK fork 或源码改动。

## 兼容接口

- `POST /v1/places:searchText`
- `POST /v1/places:autocomplete`
- `GET /v1/places/{amap_id}`（含照片/评论/简介专属 field mask）
- `GET /health`

TREK main/v4.2.1 的 9 处 Google Places 调用中，media 在空照片列表下不会触发，因此未实现 media。详情额外接受 sessionToken。各字段和与任务书的差异见 [implementation-plan.md](implementation-plan.md)。

## 坐标策略

按[高德官方说明](https://lbs.amap.com/faq/advisory/others/39840/)，大陆、香港、澳门、台湾 POI 使用 GCJ-02→WGS-84 迭代反算，bias 使用 WGS-84→GCJ-02，海外原样返回。Natural Earth 范围已补入 HKG、MAC、TWN，香港和澳门包含港口及填海区，港澳台有 1 km 近岸容差。输入校验经纬度，不混用经纬顺序。大陆及港澳台离线坐标、搜索/详情输出和 bias 回归已通过，真实 Marker 位置尚未验证；见 [coordinate-validation.md](coordinate-validation.md)。

## 验证结果

| 检查                                               | 结果                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Windows Node.js 24.14.0：161 项自动测试            | 通过                                                                              |
| WSL Docker / Linux Node.js 22.23.2：161 项自动测试 | 通过                                                                              |
| TypeScript strict、ESLint、Prettier、生产构建      | 通过                                                                              |
| 依赖安装时 npm audit                               | 0 vulnerabilities                                                                 |
| 真实高德十地点 API 验收                            | 搜索、提示、详情全部通过                                                          |
| OSM/OpenFreeMap 视觉对照                           | 真实坐标已记录，视觉待确认                                                        |
| TREK 保存、重开、重启人工验收                      | 未执行                                                                            |
| WSL Docker amd64 与完整 Compose 栈                 | 通过                                                                              |
| ARM64 容器运行                                     | 未执行，本机无 ARM64 仿真                                                         |
| GitHub Actions                                     | 已配置，结果见[仓库 Actions](https://github.com/sky1wu/trek-amap-adapter/actions) |

自动接口测试包含模拟持久化 ID 后新建 Adapter 实例重新解析；它不能替代实际 TREK 数据库/界面重启验收。

另外已在实际项目目录执行 `npm ci` 和完整检查，并用 Node.js 22.23.2 启动生产构建，通过真实 HTTP 验证 `/health`、无凭据返回 401 和 `photos=[]`；该检查没有调用高德。Compose 与 CI YAML 已通过解析和内部服务地址检查，但不能替代 Docker 实际运行。

2026-09-12 已补充 WSL Docker 实际运行：完整 Compose 中 TREK 4.2.1 与 Adapter 均 healthy，从 TREK 容器成功查询真实西安SKP；Adapter SIGTERM 退出码为 0，重新启动后同一 `amap_` ID 可正常查询。发现并修复显式中文 `langCode` 触发高德 `10012` 的问题。详见 [wsl-validation.md](wsl-validation.md)。

## 启动与 TREK 配置

复制 `.env.example` 为 `.env`，填写 AMAP_KEY；执行：

```sh
docker compose -f docker-compose.example.yml up -d --build
```

TREK 配置 `PLACES_API_BASE=http://trek-amap-adapter:8080`、`PLACES_API_KEY=trek-amap-adapter`；高德 Key 只进入 Adapter。完整可复制的 Compose 在 [README](../README.md) 与 [示例文件](../docker-compose.example.yml)。示例默认 TREK 4.2.1，容器采用非 root Node 22，适配器端口只供内部访问。

## 限制及后续

目前仍可能显示 Google source；地图和 routes 未替换；无 Google 照片、评论和简介；旧 Google ID 不自动转换；语言和 bias 不是完整 Google 语义。边界和填海地区仍需实测。

Phase 2 只记录路线与照片适配建议，未实现。Phase 3 再设计原生 AMap Provider，不在本次范围。
