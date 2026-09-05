# 正式 Web 界面 / M0-2

本目录是正式 React Web 的新呈现入口，行为基于 `apps/web-next/src` 的迁入快照。
首页、桌面/手机导航和轻量学习界面重新设计；其余页面保留原型事件与交接，转换为
Tailwind recipes 并适配浏览器。原型目录保留，旧 Web 的 API/IndexedDB/outbox 文件也保留。

2026-09-05 owner 指示：前端由 supervisor 直接实施，不委派 worker；可运行的正式 Web
是主要交付，界面稿/流程图等不是硬性产物；原型与领域文档不一致时本轮先遵循原型，
全部界面迁入后再逐页裁决和优化。本次保留学习方式选项、签到与练习等原型行为，
不据此修改受邀生产发布范围。

技术栈：React / TypeScript / Vite / TanStack Router / Zustand / Tailwind CSS 4。
`../theme.css` 只包含 Tailwind 入口和主题；页面不加载原型的全局 CSS。
`ui/recipes.ts` 为原型呈现转换的静态 Tailwind 类，`ui/classes.ts` 管理迁入页面的呈现适配；
新界面直接使用 Tailwind。协议、gateway、planner 和 reducer 保持原型行为。

## 运行与验证

- `npm run web:dev`：http://127.0.0.1:3000
- `npm run sensa:web-ui-smoke`：把原型的九组无成本场景应用于本目录模块。
- `npm run typecheck`、`npm run build`、`npm run lint`：仓库交付检查。

## 当前接线边界

这是正式工程中的前端交付，尚不是已接通生产服务的应用。账号、云端同步、导出/删除、
持久任务和真实插件未在本轮实现；设置中的未接入项仍按原型显示真实限制。
`services/previewStorage.ts` 用 `sensa:web-ui:v1:` 隔离本机预览数据，不读写旧 Web 数据。
学习旅程的刷新限制、测试内容与原型调度语义保持原样，不能算 M1 生产持久化验收。

语义澄清仍调用 `/api/prototype/semantic-agent/turn` 开发接口，经 Vite 转发到本机 5175。
没有服务时显示请求失败；本轮验证不启动付费模型或 TTS。采集模拟器仍明确标为模拟器，
不能作为浏览器插件已交付的证据。

已完成浏览器走查：桌面首页与导航；目标加入、轻量揭示/again 回想/成功完成；个人材料
保存不触发澄清及刷新恢复；手机导航、学习设置、学习方式、内容与个人意义页面。
完整语义模型服务结果和真实多设备恢复留待生产接入验证。全量迁入目前仍有较大的入口
JS/CSS；后续逐页设计收敛时拆分加载和压缩呈现 recipes，不把构建通过当作性能验收。
