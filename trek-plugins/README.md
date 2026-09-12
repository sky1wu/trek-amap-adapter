# TREK 高德路线插件

适用于 TREK 4.2.1。插件直接请求高德，复用本仓库的路线服务和坐标转换代码；无需升级现有 Places 适配器。

`amap-routes` 提供高德驾车、步行、骑行；`amap-transit` 提供公交、地铁换乘。
TREK 每个插件最多声明三个 profile，因此分为两个可独立安装的插件。

## 构建和安装

在适配器仓库执行 `npm ci`、`npm run plugins:build`，生成
`dist/amap-routes-0.2.1.zip` 和 `dist/amap-transit-0.2.1.zip`。
在 TREK 管理后台的 Plugins 页面选择 Upload plugin，上传所需 ZIP 并启用。
这是本地构建的未签名插件包；TREK 会展示来源及权限提示。

两个插件分别配置：

1. 上传 ZIP，在 `Instance settings` 的“高德 Web 服务 Key”中填写 Key，保存后启用插件。
2. 打开行程，在路线模式中选择“高德驾车／步行／骑行／公交”验证实际算路。

两个插件可使用 Places 适配器 `.env` 中 `AMAP_KEY` 的同一个值；需具备路径规划和公交所需逆地理编码权限。插件字段为 `secret`，由 TREK 加密保存；需要保留 TREK 数据卷和稳定的 `ENCRYPTION_KEY`。
插件声明路线提供、`restapi.amap.com` 出站和 `db:read:trips` 权限。只调用当前行程的地点读取接口来获取原始 POI ID，不修改行程。
只向高德发送算路参数、转换后的 GCJ-02 坐标和必需的 Key，不发送用户／行程 ID、地点名称或备注。
TREK 的正式插件沙箱会拦截 Docker 私网，即使加入 Allowed hosts 也不例外；因此插件不调用内网适配器，不需设置公网代理或关闭安全限制。

若地点保存了 `google_place_id=amap_B0FFIV1KBY`，插件会提取 `B0FFIV1KBY`。TREK 当前界面仅传坐标，插件只接受当前行程中坐标完全一致且唯一的地点；接口调用方传了 TREK 数字 `placeId` 时同时核对 ID 和坐标。不做名称或附近地点猜测。驾车／步行发送 `origin_id`、`destination_id`；公交仅在两端齐全时发送 `originpoi`、`destinationpoi`；骑行接口未声明这些参数，因此保持坐标请求。无法读取、无法唯一匹配、非高德 ID 或坐标已修改时自动回退为坐标请求。

## 行为与限制

返回 WGS-84 `[纬度, 经度]` 折线、每段距离（米）和时间（秒）。公交时间含高德返回的候车时间，连接器显示公交线路名。
2–30 个途经点按相邻点分别算路，保持顺序，不做路线优化。公交按查询时刻规划；TREK 此接口不传行程出发时间。
无路线、缺少完整轨迹、超过 10000 顶点时返回空路线；高德权限、限流或连接错误会使 TREK 按原有行为退回直线。
插件模式需在行程中选择，不会覆盖 TREK 默认 OSRM 模式。打印书页等直接使用内置驾车模式的功能仍遵循 TREK 原有逻辑。
港澳台坐标正常转换，但能否规划具体路线由高德服务覆盖和 Key 权限决定。

开发与实测记录见仓库的 `docs/phase-2-routing.md`。
