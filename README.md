# trek-amap-adapter

为 TREK 提供高德 POI 搜索的独立兼容服务。无需修改 TREK 源码或数据库；保留 TREK 原有 OpenStreetMap / OpenFreeMap 底图，返回 WGS-84 坐标。

支持 Text Search、Autocomplete、Place Details、GCJ-02/WGS-84 双向转换。Node.js 22、TypeScript strict、Fastify；无数据库，使用有容量上限的内存 TTL 缓存。

## 快速部署

需要 Docker Compose 和高德开放平台的 **Web服务 API Key**，并开通 POI 2.0、输入提示所需权限。Key 从[高德控制台](https://console.amap.com/dev/key/app)获取；浏览器 JS API Key 不能直接替代。

在项目根目录执行：

```sh
cp .env.example .env
# 编辑 .env，填写 AMAP_KEY
docker compose -f docker-compose.example.yml up -d --build
docker compose -f docker-compose.example.yml ps
```

PowerShell 第一步使用 `Copy-Item .env.example .env`。默认 TREK 端口为 3000；适配器不映射宿主机端口。首次登录信息按 TREK 官方流程从其日志取得。

完整 Compose 示例见 [docker-compose.example.yml](docker-compose.example.yml)，复制为 `docker-compose.yml` 后可直接执行 `docker compose up -d --build`：

```yaml
services:
  trek:
    image: ${TREK_IMAGE:-mauriceboe/trek:4.2.1}
    ports:
      - '${TREK_PORT:-3000}:3000'
    environment:
      NODE_ENV: production
      PORT: '3000'
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:-}
      PLACES_API_BASE: http://trek-amap-adapter:8080
      PLACES_API_KEY: ${ADAPTER_TOKEN:-trek-amap-adapter}
    volumes:
      - trek-data:/app/data
      - trek-uploads:/app/uploads
    depends_on:
      trek-amap-adapter:
        condition: service_healthy
    restart: unless-stopped
  trek-amap-adapter:
    image: ${ADAPTER_IMAGE:-ghcr.io/sky1wu/trek-amap-adapter:latest}
    build: .
    environment:
      AMAP_KEY: ${AMAP_KEY:?Set AMAP_KEY in .env}
      PORT: '8080'
      LOG_LEVEL: ${LOG_LEVEL:-info}
      ADAPTER_TOKEN: ${ADAPTER_TOKEN:-trek-amap-adapter}
    expose:
      - '8080'
    read_only: true
    cap_drop: [ALL]
    security_opt: ['no-new-privileges:true']
    init: true
    restart: unless-stopped
volumes:
  trek-data:
  trek-uploads:
```

为已有 TREK 增加适配器时，保留原来的数据卷、镜像、端口及其他环境变量，只添加适配器服务、依赖关系和以下设置：

```dotenv
PLACES_API_BASE=http://trek-amap-adapter:8080
PLACES_API_KEY=trek-amap-adapter
```

`PLACES_API_KEY` 是适配器兼容凭据，**不是高德 Key**。高德 Key 仅设置于适配器的 `AMAP_KEY`。Compose 默认启用相同的 `ADAPTER_TOKEN`；改成自己的令牌时两边保持一致。健康检查不要求凭据。`ENCRYPTION_KEY` 是 TREK 的独立设置，已有部署继续使用原值。

本次核对源码为 [TREK main / v4.2.1，515398f](https://github.com/liketrek/TREK/tree/515398f8ee3000b36a5f5b80365d6214f3f1a723)。旧镜像需确认包含 `PLACES_API_BASE` 支持；容器运行验收状态见下文。

## 使用 GHCR 镜像

镜像地址：`ghcr.io/sky1wu/trek-amap-adapter:latest`，包含 `linux/amd64` 和 `linux/arm64`。每次 `main` 通过 CI 后，工作流在两种原生架构上构建和检查，再发布 `sha-<完整提交 SHA>`；拉取、运行验证通过后更新 `latest`。也可在 Actions 中手动运行 CI。发布使用仓库自带的 `GITHUB_TOKEN`，无需额外配置发布密钥。

当前[镜像包](https://github.com/users/sky1wu/packages/container/package/trek-amap-adapter)为公开镜像，部署机器无需登录 GHCR 即可拉取。

```sh
docker pull ghcr.io/sky1wu/trek-amap-adapter:latest
# 已按快速部署配置 .env 后，直接拉取并运行，无需本地构建
docker compose -f docker-compose.example.yml pull
docker compose -f docker-compose.example.yml up -d --no-build
```

需要固定版本时，在 `.env` 中设置 `ADAPTER_IMAGE=ghcr.io/sky1wu/trek-amap-adapter:sha-<完整提交 SHA>`，然后重新执行上述 Compose 命令。`--build` 仍可用于从本地源码构建。

如果以后将包改为私有，部署机器需先执行 `docker login ghcr.io -u sky1wu`，密码使用具有包访问权限和 `read:packages` scope 的 personal access token (classic)，见 [GitHub GHCR 认证说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic)。这与 `.env` 中的高德 `AMAP_KEY` 是不同凭据。

## 本地开发

```sh
npm ci
cp .env.example .env
# 填写 AMAP_KEY
npm run dev
```

生产启动：

```sh
npm run build
npm start
```

开发和本地生产命令会读取 `.env`；已有进程环境变量优先。Docker 通过 Compose 传入环境变量，不把 `.env` 打包进镜像。服务支持 SIGTERM/SIGINT 关闭。

## 配置

| 设置                    | 默认值  | 含义                                                                                   |
| ----------------------- | ------- | -------------------------------------------------------------------------------------- |
| AMAP_KEY                | 必填    | 高德 Web服务 Key                                                                       |
| HOST                    | 0.0.0.0 | 监听地址                                                                               |
| PORT                    | 8080    | 本地运行端口；示例 Compose 固定内部端口 8080                                           |
| LOG_LEVEL               | info    | fatal/error/warn/info/debug/trace/silent                                               |
| ADAPTER_TOKEN           | 未设置  | 可选，至少 16 字符；与 TREK 的 X-Goog-Api-Key 比较；Compose 默认设为 trek-amap-adapter |
| AMAP_TIMEOUT_MS         | 8000    | 单次高德请求及响应体读取总时限，最大 15000ms                                           |
| AMAP_MAX_RESPONSE_BYTES | 2000000 | 单次响应体上限，包括流式/解压后的内容                                                  |
| AMAP_MAX_CONCURRENT     | 20      | 同时进行的高德调用上限，超出返回 503                                                   |
| CACHE_MAX_ENTRIES       | 1000    | 每种缓存的条目上限                                                                     |
| AMAP_ENGLISH_ENABLED    | false   | 已购买英文 POI 权限时可设 true                                                         |

## 接口与映射

| 接口                           | 高德实现                                               |
| ------------------------------ | ------------------------------------------------------ |
| POST `/v1/places:searchText`   | GET `/v5/place/text`                                   |
| POST `/v1/places:autocomplete` | GET `/v3/assistant/inputtips`                          |
| GET `/v1/places/amap_<POIID>`  | GET `/v5/place/detail`                                 |
| GET `/health`                  | 本地返回 `{"status":"ok"}`，仅检测进程，不消耗高德配额 |

仅支持 [上游契约](docs/implementation-plan.md) 中 TREK 实际使用的请求字段。输入关键词限制为 80 字符；JSON body 上限 16 KiB。请求语言接受合法 BCP-47 形式，未知语言默认使用中文。`en` 也默认回退中文；启用英文权限后搜索与详情发送 `langCode=en`，输入提示仍使用高德默认语言。`sessionToken` 被接受但不传到高德。

默认中文请求省略高德 `langCode` 参数。实测普通 Key 显式传 `langCode=zh` 也可能返回 `10012`；省略后可正常使用。只在明确启用英文且请求英文时发送该参数。

ID 使用 `amap_B0...`，不含冒号、斜杠或 URL 元字符。Mapper 过滤无有效 ID、名称或坐标的 POI；输入提示使用 `datatype=poi` 并去除无法解析的提示、公交线路以及重复 ID，保留原始顺序。

评分、电话仅从 `show_fields=business` 的真实字段映射。未知评分、评论数、网站、营业时间和营业状态省略，不猜测；高德分类不冒充 Google types，因此返回 `types=[]`。`googleMapsUri=null`，避免显示“Google Maps”却打开高德。

FieldMask 允许返回字段超集。仅请求 `photos`、`reviews`、`editorialSummary` 或这些字段组合时直接返回空数据，无需访问高德。普通详情也始终返回 `photos=[]`、`reviews=[]`。按 TREK 源码，空照片列表不会继续请求 media；不实现图片代理。

## 坐标与位置偏好

按[高德官方坐标说明](https://lbs.amap.com/faq/advisory/others/39840/)，中国大陆、香港、澳门、台湾返回 GCJ-02，海外返回 WGS-84。Adapter 对上述 GCJ-02 范围内的 POI 迭代反算为 WGS-84，对 TREK 发来的 bias 中心进行反向转换；海外坐标保持不变。所有转换为纯函数，经纬度零值有效。

范围数据采用 Natural Earth 1:10m 的 CHN、HKG、MAC、TWN 四组几何，包含海南及数据内的离岛。香港、澳门使用各自包围范围覆盖港口及机场填海区；港澳台近岸增加 1 km 容差，大陆与其他国家的边界不扩张。这是服务用的近似范围，具体限制见[坐标验证](docs/coordinate-validation.md)。

升级到此修复后重启 Adapter，清空旧内存缓存。此前在 TREK 中保存的港澳台错误坐标不会自动改写，需要重新搜索并更新地点。

文本搜索没有 Google circle bias 的直接对应参数：先用 `/v3/geocode/regeo` 获取中心城市，再传 `region` 和 `city_limit=false`。输入提示使用 `city`、GCJ-02 `location` 和 `citylimit=false`。矩形取中心，支持跨日期变更线。城市解析限时 1.5 秒，结果缓存一天；失败短暂缓存 5 秒并回退普通关键词搜索。

这不是严格的半径/矩形过滤，保留高德排序和跨城召回，也不会自行按名称重排。详见 [坐标验证](docs/coordinate-validation.md)。边界数据有概化误差，填海区、小岛和边境需额外核验；数值 round-trip 精度不能证明真实 POI 或底图误差。

## 缓存、错误和日志

Autocomplete 缓存 45 秒、文本搜索 2 分钟、详情 6 小时。缓存按查询、语言、完整 bias、分页大小或地点 ID 隔离；会话令牌不影响缓存。每种缓存有 TTL/LRU 容量限制，无 Redis。搜索和详情的错误不缓存；适配器重启会清空缓存，ID 仍可重新查询。

高德 `status=0` 即使 HTTP 为 200 也按错误处理：输入问题返回 400、找不到详情返回 404、限流返回 429、Key/权限/配额不可用返回 503、超时返回 504，其余高德错误返回 502。返回 `{"error":{"message":"..."}}`，日志保留 `infocode`。

日志包含 requestId、method、route、upstream、latency、status、cacheHit，不写请求 body、完整 URL、Key、Authorization 或原始上游异常。高德域名固定、拒绝重定向，客户端不能指定代理目标。默认部署只供 TREK 内网访问；如需对外使用，应先配置自己的 `ADAPTER_TOKEN`。

## 测试与验收

```sh
npm run check
npm run smoke
```

`check` 包含类型、Lint、格式、单元/接口测试和构建。测试使用 mock 高德响应，覆盖六城市坐标、海外原样返回、ID、异常字段、真实 TREK 请求形状、缓存、空照片、参数校验、上游错误/限流/超时/响应大小和日志密钥保护。

`smoke` 需要 `.env` 或环境中的 `AMAP_KEY`，会真实调用高德并消耗配额，按任务书的十个 POI 依次验证搜索、提示与详情，保存实际 GCJ-02/WGS-84 坐标到已忽略的 `docs/smoke-results.json`。未设置 Key 时明确跳过。API 通过后还需在 TREK 中确认名称、地址、地图 Marker、保存重开和重启结果；脚本不会声称已完成这些人工步骤。

2026-09-12 验收：Windows Node.js 24 和 WSL Docker 内 Linux Node.js 22 下 **161 项测试通过**，类型/Lint/格式/生产构建通过，包含港澳台转换范围及接口回归。此前已通过 Docker amd64 镜像、完整 Compose 栈、真实高德十地点搜索/提示/详情、TREK 容器到适配器的调用链、非 root/只读运行、健康检查与适配器重启后详情。详见 [WSL 验收记录](docs/wsl-validation.md)。

OpenFreeMap Marker 视觉对照及 TREK 界面保存/重开/重启仍需人工验收；本机未配置 ARM64 仿真，ARM64 容器尚未运行。仓库已配置双架构 CI，尚未远程执行。

## 已知限制和后续阶段

Adapter 模式下，TREK 内部可能仍将高德 POI 标记为 Google source，这是当前零侵入兼容方案的已知限制。

只解析 `amap_` ID，不能把以前保存的 Google Place ID 自动映射到高德。Google/Naver 链接导入、Google 专属元数据和境外地点完整覆盖不在 MVP 保证范围。TREK 自身的详情缓存可能比适配器缓存更久，刷新行为仍由 TREK 控制。

当前不支持高德底图、路线规划、公交、天气、照片代理、Google Reviews 或 Editorial Summary，也不修改 TREK 前端、MCP 和数据库。

- Phase 2：单独设计驾车/步行/骑行/公交路线适配，输入 WGS-84→GCJ-02，返回 polyline GCJ-02→WGS-84；后续再评估照片代理。
- Phase 3：向 TREK 提原生 AMap Provider 设计，统一数据来源、底图、路线和地图跳转。

文件结构与交付状态见 [交付报告](docs/delivery-report.md)。原始 `任务书.md` 保留在本地，已加入 Git 忽略规则。
