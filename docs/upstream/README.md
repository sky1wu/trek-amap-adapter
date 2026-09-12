# TREK 路线图标补丁

适用版本：TREK 4.2.1 / `515398f8ee3000b36a5f5b80365d6214f3f1a723`。

状态：按维护者 2026-09-12 的选择，仅在本仓库保留补丁，不向 TREK 提交 PR。

当前插件 manifest 已分别声明 `Car`、`Footprints`、`Bike`、`Bus`。
TREK 的路线选择器没有读取 profile.icon，统一把插件路线画成 `Zap`；行程中距离／时间连接器也使用相同的默认图标。

[trek-route-profile-icons.patch](trek-route-profile-icons.patch) 改动两个前端文件：

- `DayPlanSidebar.tsx`：保留 profile.icon，使用 TREK 已有 `resolvePluginIcon` 渲染。
- `DayPlanSidebarRouteConnector.tsx`：从当前激活插件中读取对应 profile.icon，让行程连接器和住宿连接器显示一致。

保留原生驾车／步行图标；插件未声明图标时继续用闪电；无效图标名称由现有图标解析器安全回退。
该补丁适用于所有路线插件，不针对高德硬编码。

已完成针对上述提交的 `git apply --check` 和两个 TSX 文件的语法转换检查。
尚未在完整 TREK 工程执行类型检查、组件测试或浏览器验收，也未修改已部署 TREK。
重新打包高德插件不能让现有 TREK 前端自动采用此补丁。

在对应 TREK 源码目录中应用后，需按 TREK 的构建流程重新构建前端和镜像：

```sh
git apply --check /path/to/trek-route-profile-icons.patch
git apply /path/to/trek-route-profile-icons.patch
```

上游依据：[路线选择器](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/client/src/components/Planner/DayPlanSidebar.tsx#L2822)、[行程连接器](https://github.com/liketrek/TREK/blob/515398f8ee3000b36a5f5b80365d6214f3f1a723/client/src/components/Planner/DayPlanSidebarRouteConnector.tsx#L7)。
