# 实现计划与上游契约

调研日期：2026-09-11。TREK main 固定为
[`515398f8ee3000b36a5f5b80365d6214f3f1a723`](https://github.com/liketrek/TREK/tree/515398f8ee3000b36a5f5b80365d6214f3f1a723)。
实现独立 Node.js 22 / TypeScript strict / Fastify 服务，不复制或修改 TREK 源码。

## 已阅读的上游文件

- `server/src/nest/maps/maps.service.ts`
- `server/src/nest/maps/maps.helpers.ts`
- `server/src/nest/settings/instance-api-keys.ts`
- `server/src/app-config/derive.ts`
- `wiki/Places-and-Search.md`、`wiki/Environment-Variables.md`
- `docker-compose.yml`

## 实际请求与响应契约

| 方法与路径                     | TREK 请求                                                                                     | TREK 读取的字段                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/v1/places:searchText`   | textQuery、languageCode、可选 circle locationBias；API key、field mask headers                | places[].id、displayName.text、formattedAddress、location.latitude/longitude、rating、websiteUri、nationalPhoneNumber、types、googleMapsUri、businessStatus |
| POST `/v1/places:autocomplete` | input、languageCode、可选 sessionToken、rectangle locationBias；API key header，无 field mask | suggestions[].placePrediction.placeId、structuredFormat.mainText.text、secondaryText.text；TREK 取前 5 条                                                   |
| GET `/v1/places/{id}`          | languageCode、可选 sessionToken，基础或扩展 field mask                                        | 基础地点字段、userRatingCount、regularOpeningHours 的 weekdayDescriptions/openNow/periods/specialDays；扩展读取 reviews 和 editorialSummary.text            |
| GET `/v1/places/{id}`          | photos-only / editorialSummary-only mask                                                      | photos[].name/authorAttributions、editorialSummary.text                                                                                                     |
| GET `/v1/{photoName}/media`    | maxHeightPx                                                                                   | 图片字节；仅在已有照片引用时调用，MVP 返回 photos=[]，因此不实现                                                                                            |

源码有 9 个 Places 调用点，去重后是上述 4 类路径；MVP 实现前 3 类。源码确认 `photos=[]` 会在下载 media 前退出。
`placesEndpoint()` 保留路径与查询参数；`PLACES_API_KEY` 优先于实例和用户 Key。
详情用 `includes(':')` 进入 OSM 分支，必须使用 `amap_` ID。

## 当前官方高德接口

- [POI 2.0](https://lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch)：`/v5/place/text`、`/v5/place/detail`；请求 `show_fields=business` 获取电话和评分。
- [输入提示](https://lbs.amap.com/api/webservice/guide/api-advanced/inputtips)：`/v3/assistant/inputtips`，使用 `datatype=poi`，过滤无有效 POI ID/坐标的提示。
- [逆地理编码](https://lbs.amap.com/api/webservice/guide/api/georegeo)：`/v3/geocode/regeo`，仅用于 bias 中心取得 citycode，结果缓存；失败降级为普通关键词搜索。
- [错误码](https://lbs.amap.com/api/webservice/guide/tools/info)：解析业务 status 和 infocode，不以 HTTP 200 判断成功。

## 与任务书的补充/差异

1. 详情还带 sessionToken；接受并忽略计费会话，不转发给高德。
2. POI 2.0 文本搜索没有 location 参数，使用 bias 中心逆地理编码所得 region，`city_limit=false`；不改用会严格限半径的周边搜索。
3. 输入提示文档要求 city 非空时 location 才生效，使用 city+location，`citylimit=false`。
4. POI 2.0 英文 `langCode=en` 属于高级服务。默认回退中文；提供显式英文开关给已开通权限的 Key，接受其他 TREK languageCode。
5. 原任务书中的输入提示文档旧路径已变为 `api-advanced/inputtips`。
6. Wiki 尚未列出 PLACES_API_BASE/KEY，以 derive.ts 和 MapsService 为准。配置示例使用可覆盖的 TREK 镜像标签；当前 main 不等于已发布镜像的保证。

## 提交顺序

1. 基础工程、忽略任务书、记录上游契约和计划。
2. 坐标/ID 纯函数、集中 mapper、高德 client、缓存、三个兼容路由和健康检查；随实现添加核心测试。
3. 扩展错误与 TREK 契约测试，Docker/Compose、CI、README、真实 Key smoke 脚本及坐标验证记录。

验收先用 mock 自动验证，有 AMAP_KEY 再执行真实 POI 测试。无 Docker 或 Key 时明确记录未完成的环境验收，不用 mock 结果替代真实地图定位证据。

2026-09-12 实测补充：显式 `langCode=zh` 同样触发当前普通 Key 的多语言权限错误 `10012`，默认中文必须省略 `langCode`。已修复搜索及详情，并加入回归测试；详细证据见 [WSL 验收记录](wsl-validation.md)。
