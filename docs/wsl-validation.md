# WSL / Docker 实测记录

日期：2026-09-12（Asia/Hong_Kong）。Ubuntu WSL2、Linux 6.6.87.2、Docker 29.6.1、Compose v5.3.0；宿主架构 linux/amd64，镜像内 Node.js v22.23.2。

## 港澳台坐标修复复测

2026-09-12 修正港澳台转换范围后，Windows Node.js 24.14.0 与 WSL Docker Node.js 22.23.2 均通过 `npm run check`：TypeScript、ESLint、Prettier、161 项自动测试和生产构建。WSL 测试容器禁用网络，使用本次新构建的源码与范围数据。

回归包含香港、澳门、台湾的双向转换、固定数值向量、搜索与详情输出、自动补全到详情，以及搜索/自动补全 bias；还覆盖香港机场、澳门路氹、澎湖、金门等地点及海外不转换。详见[坐标验证](coordinate-validation.md)。此次复测不包含港澳台真实 POI 的底图视觉验收。

## 首次验证已通过

- Linux 生产镜像构建，生产依赖安装审计为 0 vulnerabilities。
- Linux 构建容器禁用网络运行 145 项测试，全部通过。
- 原始 Compose 示例在隔离项目 `placesadapter-validation-20260912` 启动完整栈，TREK 4.2.1 与 Adapter 均 healthy。
- Adapter 用户 UID=1000，文件系统只读，镜像中没有 `.env`。
- `/health` 正常；无凭据查询返回 401；正确适配器凭据取得空照片列表。
- 从 TREK 官方容器内使用 `PLACES_API_BASE`、`PLACES_API_KEY` 发起实际西安SKP搜索，取得 `amap_B0FFIV1KBY`。
- Adapter 停止退出码为 0；重新启动后仍可查询同一地点详情，不依赖原来的内存缓存。
- 实际 Key 的十地点 smoke 全部通过，包括搜索、提示、提示选择后的详情、搜索结果详情和实际坐标记录。

验证栈使用单独数据卷和随机本机端口，没有修改其他 TREK 实例。验证结束后清理临时栈及其测试数据卷；项目 `.env` 保留且被 Git 忽略。

## 实测发现并修复的问题

相同 Key、相同关键词 `西安SKP` 的对照：

| 请求参数                                    | 结果                         |
| ------------------------------------------- | ---------------------------- |
| keywords + page_size                        | 成功                         |
| keywords + page_size + show_fields=business | 成功                         |
| keywords + page_size + langCode=zh          | 高德 10012，Adapter 返回 503 |

错误由显式语言参数触发，不能据此判断整个 Key 无 POI 权限。高德[错误码说明](https://lbs.amap.com/api/webservice/guide/tools/info)将 10012 定义为权限不足。

修复：中文及回退中文请求省略 `langCode`；仅在 `AMAP_ENGLISH_ENABLED=true` 且请求英文时发送 `langCode=en`。搜索和详情都应用此规则，新增回归测试。

## 十地点结果

| 查询       | 实际 Place ID   | 搜索/提示/详情 |
| ---------- | --------------- | -------------- |
| 西安SKP    | amap_B0FFIV1KBY | 通过           |
| 西安城墙   | amap_B001D0WP6V | 通过           |
| 大唐不夜城 | amap_B001D0VWAX | 通过           |
| 西安北站   | amap_B001D09TZP | 通过           |
| 北京故宫   | amap_B000A8UIN8 | 通过           |
| 上海虹桥站 | amap_B00155MPRL | 通过           |
| 深圳湾口岸 | amap_B02F37UK27 | 通过           |
| 广州塔     | amap_B00140WBI1 | 通过           |
| 成都太古里 | amap_B0FFF6X49V | 通过           |
| 杭州西湖   | amap_B023B13L9M | 通过           |

完整本地结果在已忽略的 `docs/smoke-results.json`，只包含公开地点数据和坐标，不含 Key。

## Key 配置与复测

Windows：`D:\workspace\PlacesAdapter\.env`。
WSL：`/mnt/d/workspace/PlacesAdapter/.env`。

```dotenv
AMAP_KEY=你的高德Web服务Key
```

在 WSL 项目根目录运行：

```sh
docker compose -f docker-compose.example.yml pull
docker compose -f docker-compose.example.yml up -d --no-build --wait
```

有 Node.js 22 开发环境时执行 `npm ci`、`npm run smoke` 可复测十个地点。本次通过 Dockerfile 的 `build` 阶段运行 smoke，由环境文件注入 Key，未将其写入镜像或日志。

## 后续验收更新

- 2026-09-12，维护者确认 TREK UI 人工验收已完成，西安、香港实测通过，见[人工验收记录](ui-acceptance.md)。
- GitHub Actions 已通过 amd64、arm64 原生构建及健康检查，见[发布验证](https://github.com/sky1wu/trek-amap-adapter/actions/runs/34672393343)。
- WSL 已成功免登录拉取公开 GHCR 镜像，验证 `/health`、非 root 用户以及港澳台坐标转换。
- 部署示例默认固定为 `ghcr.io/sky1wu/trek-amap-adapter:v0.1.0`。

后续扩大入口、建筑中心、填海区及更多城市的实测覆盖。
