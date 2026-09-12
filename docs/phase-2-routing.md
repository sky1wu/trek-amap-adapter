# Phase 2：高德路线规划

代码版本 `0.2.0`，尚未创建 tag / Release。`v0.1.0` 保持为仅包含 Places 的稳定版。

## 接入依据

2026-09-12 核对 TREK main / 4.2.1，提交 `515398f8ee3000b36a5f5b80365d6214f3f1a723`：

- [RouteCalculator.ts](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/client/src/components/Map/RouteCalculator.ts) 内置路线直接使用 OSRM，不经过 `PLACES_API_BASE`，也没有可配置的 Google Routes base。
- [官方路线插件类型](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/plugin-sdk/src/index.ts) 支持 `routeProvider.getRoute`；2–30 个有序坐标，返回 `[lat,lng]` 折线、距离、时间和 `waypoints.length - 1` 个 legs。
- [插件 manifest 校验](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/plugin-sdk/src/manifest.ts) 每个插件最多声明三个 profile。提供 `amap-routes`（驾车／步行／骑行）和 `amap-transit`（公交）两个 ZIP，共用本仓库路线实现。
- [路线控制器](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/server/src/nest/plugins/contributions/plugin-routes.controller.ts) 保留 TREK 自身的登录、行程访问和插件权限检查，拒绝超过 10000 顶点或 legs 数不匹配的结果。

高德使用[路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)：`/v5/direction/driving`、`walking`、`bicycling`、`transit/integrated`。请求 `show_fields=cost,polyline`；公交用逆地理编码解析两端 citycode，不把 adcode 当作 citycode。
输入统一为 WGS-84，向高德发送前转换为 GCJ-02 并保留六位小数；每个返回轨迹顶点转换为 WGS-84。大陆、香港、澳门、台湾沿用现有转换范围，海外保持原坐标。

## 部署

**推荐直接安装路线插件，现有 Places `v0.1.0` 部署无需升级。** TREK 正式插件沙箱的[出站规则](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/server/src/nest/plugins/runtime/egress-policy.ts)拒绝私网 IP，即使 Allowed hosts 包含 Docker 主机名仍会被拦截。插件因此直接请求固定公网域名 `restapi.amap.com`，共享的路线服务与坐标转换经 esbuild 打包进插件，未修改 TREK 或绕过网络限制。

源码构建插件：

```sh
npm ci
npm run plugins:build
```

也可从 GitHub Actions 成功运行的 `trek-amap-plugins` artifact 下载两个 ZIP。

在 TREK Admin → Plugins 上传 `dist/amap-routes-0.2.0.zip` 和 `dist/amap-transit-0.2.0.zip`，分别在 Instance settings 的“高德 Web 服务 Key”填入 Key 后启用。字段名为 `amapKey`，标记为 secret，由 TREK 加密保存；可以使用适配器 `.env` 中 `AMAP_KEY` 的同一个值，需具备路线及逆地理编码权限。具体步骤见[插件安装说明](../trek-plugins/README.md)。无需开启 dev-link 或配置 Allowed hosts。

若其他客户端需要新的独立 `/v1/routes` HTTP 接口，可将 `.env` 的 `ADAPTER_IMAGE` 设为 `trek-amap-adapter:phase2-local`，执行 `docker compose -f docker-compose.example.yml up -d --build trek-amap-adapter`。或固定到成功构建的 `ghcr.io/sky1wu/trek-amap-adapter:sha-<完整40位提交>`，执行 Compose pull 和 up。该 HTTP 接口继续使用适配器 `.env` 的 `AMAP_KEY` 与 `ADAPTER_TOKEN`。main 构建更新 `latest`，`v0.1.0` 保持不变。

## HTTP 契约

`POST /v1/routes`，鉴权沿用 `X-Goog-Api-Key: <ADAPTER_TOKEN>`。

```json
{
  "profile": "driving",
  "waypoints": [
    { "lat": 34.261014, "lng": 108.942397 },
    { "lat": 34.220364, "lng": 108.959468 }
  ]
}
```

`profile` 可选 `driving`、`walking`、`cycling`、`transit`。返回 `{"route":{"coordinates":[[纬度,经度],...],"distance":米,"duration":秒,"legs":[{"distance":米,"duration":秒}]}}`。
每个 waypoint 可选 `amapId`，值为不带 `amap_` 前缀的高德原始 ID，例如 `B0FFIV1KBY`。驾车／步行分别发送 `origin_id`、`destination_id`；公交仅在两端都有 ID 时发送 `originpoi`、`destinationpoi`；骑行不发送未声明的 ID 参数。坐标始终同时传入，缓存包含 POI ID，避免复用未指定入口的结果。
公交 leg 可包含最多 120 字符的 `note` 线路名。无路线返回 HTTP 200 / `{"route":null}`；无效输入 400、令牌错误 401、限流 429、上游数据错误 502、权限不可用 503、超时 504。

## 完整性和限制

- 每对相邻途经点分别请求真实路线，最多三个并行请求；按输入顺序拼接，距离和时间逐段求和。HTTP 服务与 Places 共用上游并发限制；每个插件进程单独限制为三个并发。一天内多个中间停靠不会被略过，但不保证等价于高德整条多途经点路线的全局最优解。
- 驾车／公交每段缓存 60 秒，步行／骑行 5 分钟，最多 100 条；城市编码缓存一天。Key 错误和无路线结果不缓存；重启清空缓存。TREK 自身仍有浏览器内路线缓存。
- 路线总预算 17 秒，TREK hook 为 20 秒。HTTP 服务单次高德请求遵循 `AMAP_TIMEOUT_MS`；插件默认 8 秒。失败会取消同次尚未完成的请求。
- 公交按高德推荐方案规划，采用方案总时间（含候车）；拼接步行、公交／地铁和末段步行。`buslines` 视为同段备选，只选一条，不把备选线串成路线。兼容普通 polyline 字符串和 v5 公交的嵌套 polyline 对象。
- 火车／出租车等分段缺少真实轨迹时尝试后续完整方案；没有完整方案、任一 leg 无路线或超过 10000 顶点时返回空路线，不补画伪造轨迹。TREK 会按原有失败行为显示直线。
- 此接口不传行程出发时间，公交不是某个未来日期的时刻表；相邻公交 leg 独立按查询时刻规划。暂不提供自定义避让、交通策略、候选路线 UI 或时刻表选项。
- 港澳台坐标正常转换；路线是否存在仍由高德覆盖与 Key 权限决定。[20800–20803](https://lbs.amap.com/api/webservice/guide/tools/info) 映射为空路线，不误认为 WGS-84 区域。
- 插件只向高德发送算路参数、坐标、可用的高德 POI ID 和必需的 Key，不发送行程／用户 ID、名称或备注。新增 `db:read:trips` 权限，只通过 `ctx.trips.getPlaces` 读取当前用户可访问行程的地点，用 `google_place_id=amap_...` 恢复原始 ID，不缓存地点记录、不写数据库。Key 在 TREK 加密设置和插件子进程中使用，不提供给浏览器路线调用；异常只返回固定提示，不记录坐标、Key、请求正文或完整 URL。
- TREK 当前客户端只传坐标，虽然 hook 类型允许数字 `placeId`，它并不是高德原始 ID。插件在当前行程中按完全一致的坐标进行唯一匹配；若传了数字 `placeId`，同时要求该行及坐标一致。重复坐标、地点已移动、非 `amap_` ID、读取失败或超过 800 ms 时只用坐标，不用名称或附近位置猜测。此 RPC 由 TREK 执行行程访问权限检查。
- TREK 路线选择器中的内置模式仍使用 OSRM；需主动选择新增高德模式。打印书页等固定调用内置驾车的功能不受插件影响。

## 验证记录（2026-09-12）

Windows Node 24.14.0 / WSL Linux Node 22.23.2：221 项测试，TypeScript、ESLint、Prettier 和生产构建全部通过。
官方 `trek-plugin-sdk@1.7.0` 验证两份 manifest 并打包成功。测试覆盖插件直接调用共享服务、固定出站域名、Key 轮换和必填检查、港澳台轨迹、海外原样输出、鉴权、错误、缓存、坐标范围、响应大小、轨迹上限、途经点顺序、公交候选方案与缺失轨迹。

另在 WSL 全新临时 TREK 4.2.1 生产容器（Node 24.20.0）上传两份实际 ZIP，配置加密 Key、启用插件、创建测试行程，经 `/api/plugin-routes/...` 验证四种模式全部返回有效轨迹与距离／时间。保持正式插件沙箱，不开启 dev-link，不改网络安全规则；测试后已清理临时容器、网络和数据，未修改现有部署。

POI ID 增强后再次验证：通过真实高德搜索取得西安钟楼和大雁塔，保存 `amap_` ID 与 WGS-84 坐标到临时行程；插件读取这些记录后，驾车／步行／骑行／公交均成功。单位测试另确认原始 `B0FFIV1KBY` 从 TREK 地点字段直达高德 `origin_id`，Google ID、歧义地点及无权限行程不会误传。

WSL 使用现有 Key、公开测试坐标，真实 API 实测：

| 城市 | 模式 | 顶点 | 距离（米） | 时间（秒） |
| ---- | ---- | ---: | ---------: | ---------: |
| 西安 | 驾车 |  208 |       7428 |       1795 |
| 西安 | 步行 |  191 |       6855 |       5484 |
| 西安 | 骑行 |  226 |       6814 |       2363 |
| 西安 | 公交 |   88 |       7522 |       3058 |
| 香港 | 驾车 |   46 |        960 |        250 |
| 香港 | 步行 |   55 |       1048 |        838 |
| 香港 | 骑行 |   51 |        960 |        391 |
| 香港 | 公交 |   80 |       1592 |       1278 |

公交实测分别返回西安地铁 2 号线 → 3 号线、香港九巴 978 路。距离／时间为当次高德返回值，会随路况与时刻变化，不构成测绘或到站时间保证。
重跑命令为 `npm run smoke:routes`，结果写入已忽略的 `docs/routes-smoke-results.json`。没有 Key 时明确跳过。

**Phase 2 路线功能人工验收通过（2026-09-12，维护者确认“功能验证可用”）。** 用户截图展示西安公交路线。遗留问题为四种路线均显示闪电：TREK 4.2.1 忽略已声明的 profile.icon，插件本身已配置不同图标。详情见[人工验收记录](ui-acceptance.md)及[可选的 TREK 图标补丁](upstream/README.md)。
