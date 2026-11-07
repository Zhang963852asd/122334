# 知行 · 月考后学习提升计划

一个纯静态的学习计划单页站点。把「月考后补短板」拆成每天六个小动作，做完就打勾。
没有构建步骤、没有自建后端：数据默认存在浏览器的 localStorage，登录后可选择同步到云端。

## 页面

| 页面 | 做什么 |
| --- | --- |
| 总览 | 今日进度、连续打卡、本周完成率、累计任务，以及今天的任务清单 |
| 每日打卡 | 按日期查看/勾选任务，进度环与剩余分钟；可回看历史日期 |
| 每周复盘 | 三句话复盘（丢分原因 / 错题是否弄懂 / 下周主攻），按 ISO 周保存，可删除 |
| 学习计划 | 平日六个小任务、周末整块学习、每周复盘方法、本月可勾选目标 |
| 学习工具 | 二次函数求根、成绩换算、质因数分解、一元二次不等式、随机抽背、番茄钟 |
| 错题本 | 按科目记录错题与错因，勾掉已弄懂的，只留还没懂的 |
| 每日名句 | 每天一句名句 + 解析，可写自己的理解、查看历史、收藏 |
| 收藏 | 收藏过的句子连同解析与你的理解一起陈列 |
| AI 答疑 | 登录后直接用内置通道提问（Key 在服务端）；也可以切成自己的 Key。对话只存本机 |
| 设置 | 昵称、起始日期、提醒开关、云端同步、清空数据 |

## 任务怎么来的

任务不是写死的清单，而是按日期自动生成：

- 周一至周五：语文 3 项 + 文综 1 项（单日政治 / 双日历史）+ 英语 1 项 + 数理化 1 项，约 85 分钟
- 周六：语文限时阅读、文综主观题、数理化专项，按考试节奏
- 周日：错题复盘、作文（双周写整篇，单周写提纲）、素材摘抄

## 文件

```
├── index.html          页面结构与 SVG 图标集（全部视图在一个文件里，用 data-view 切换）
├── style.css           设计系统：配色变量、组件、响应式断点（1080 / 900 / 560 / 520 / 430）
├── app.js              原生 JS：路由、状态、localStorage 持久化、云端同步、工具计算
├── vendor/
│   └── supabase-js.js  Supabase 浏览器 SDK（本地内置，避免运行时依赖 CDN）
├── functions/
│   └── api/ai.js       Cloudflare Pages Function：AI 通道代理（Key 只放在服务端环境变量里）
├── test/
│   └── merge.test.js   同步合并逻辑用例（node test/merge.test.js）
├── hero-bg.png         首屏水彩插画
├── closing-bg.png      页尾水彩插画
└── quotes-bg.png       名句页水彩背景
```

## 本地预览

直接双击 `index.html` 即可；也可以用任意静态服务器：

```bash
python -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

## 云端同步（可选）

不登录时一切照旧，数据只在本机。设置页登录后才会启用同步。

- 后端用的是 **Supabase**（Postgres + Auth + 行级权限），前端用官方 SDK 直连，没有自建服务器
- 每个账号在 `public.zhixing_saves` 里占一行，`data`（jsonb）存整份状态快照
- 表开启了 RLS，四条策略限制成「只能读写自己那一行」；publishable key 公开在前端是允许的，真正的保护是 RLS
- 会话由 SDK 存在浏览器里，下次打开自动恢复，无需重复登录
- 登录状态下可在设置页直接**修改密码**（`auth.updateUser`），不用旧密码、也不用收邮件验证码

**同步策略（本地优先）**：任何改动先落本机、再延迟 1.2 秒推云端；拉取时先合并再回写，所以两台设备离线各改各的也不会互相覆盖。

| 数据类型 | 合并方式 |
| --- | --- |
| 打卡记录 | **按日期取较晚的一次**（`checkinAt`）：取消勾选必须能传出去，取并集会被另一端加回来 |
| 每周复盘 | 同一周取 `at` 较晚的一份；删除写入 `del` 标记，同样按 `at` 比新旧 |
| 错题 | 按 `id` 合并，同一条取 `upd` 较晚的；删除记入 `mkTrash` 墓碑，不会被另一台设备带回 |
| 名句理解 | 按「时间 + 内容」去重取并集（只增不减） |
| 收藏 | **整份取较晚的一次**（`favAt`），取消收藏同理不能被并集带回 |
| 昵称 / 目标 / 开关 | 取 `updatedAt` 较晚的那一份 |
| 清空数据 | 记 `resetAt`，较晚的一次整份覆盖，其他设备同步后一起清空 |

已知限制：同一天在两台**同时离线**的设备上各勾了不同任务时，以那次改动更晚的清单为准（先联网的那台会先同步、再动手，实际很少撞上）。

合并逻辑有独立用例：`node test/merge.test.js`（直接抽取 `app.js` 里的合并函数跑断言，不连网）。

**换成自己的 Supabase 项目**：改 `app.js` 顶部的 `CLOUD` 常量即可，并按下表建好库：

```sql
create table if not exists public.zhixing_saves (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  device_hint text
);
alter table public.zhixing_saves enable row level security;
-- select / insert / update / delete 四条策略均限定 auth.uid() = user_id
```

## AI 答疑

默认走 **账号内置通道**：浏览器只出示 Supabase 登录令牌，Key 保存在服务端，登录后开箱即用，任何设备都不用再填。

链路由 `functions/api/ai.js`（Cloudflare Pages Function）承担：

```
浏览器 --(Supabase 令牌)--> /api/ai --(服务端 Key)--> 模型服务商
                            ↑ 校验令牌 + 允许名单 + 裁剪消息
```

**需要在 Cloudflare Pages 里配的环境变量**（Settings → Environment variables，改完重新部署）：

| 变量 | 说明 |
| --- | --- |
| `AI_API_KEY` | 模型服务商的 Key（必填，选加密保存） |
| `AI_BASE_URL` | 接口根地址，默认 `https://api.deepseek.com` |
| `AI_MODEL` | 模型名，默认 `deepseek-chat` |
| `SUPABASE_URL` | 你的 Supabase 项目地址（用于校验令牌） |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase 的 publishable / anon key |
| `AI_ALLOWED_EMAILS` | 允许使用的邮箱或用户 id，逗号分隔；**站点开放注册时强烈建议填上**，否则任何注册用户都能用你的额度 |

智谱 GLM 的免费模型（如 `glm-4-flash`）也能用，只是要换个 `AI_BASE_URL`：`https://open.bigmodel.cn/api/paas/v4`。

**也支持「自带 Key」模式**：切过去之后请求由浏览器直连服务商，Key 只存本机、不上传云端。这条路要求服务商开放 CORS——DeepSeek、Kimi、通义千问、OpenAI 都可以；智谱 GLM 官方接口没开，界面里会提示。

**费用与安全**：内置通道烧的是服务端那把 Key，接口对已登录用户开放，记得配 `AI_ALLOWED_EMAILS`；单次请求已限制 24 条消息、每条 8000 字符、`max_tokens` 1500，模型名由服务端固定，前端无法指定更贵的模型。

## 数据与隐私

- 本机存储键：`zhixing.study.plan.v1`（数据）、`zhixing.study.auth`（登录会话）、`zhixing.study.sync.v1`（同步时间戳）、`zhixing.ai.cfg.v1` / `zhixing.ai.msgs.v1` / `zhixing.ai.key.<服务商>`（AI 设置与对话）
- 未登录时**不发起任何业务请求**；字体来自 Google Fonts（Instrument Serif / Geist），断网回落到系统字体
- 云端只存学习记录（打卡、复盘、错题、笔记、收藏），没有手机号、支付信息；**AI 的 Key 与对话记录都不进数据库**
- 内置通道下，提问内容只经过你自己的 Cloudflare Function 转给模型服务商；自带 Key 模式下由浏览器直连服务商
- 换浏览器、换设备、清缓存都不会带走数据；设置页的「清空数据」会一次清掉打卡、复盘、目标、错题、名句笔记与收藏（登录状态下连同云端一起清）
- 网络或 SDK 加载失败时同步会自动降级：界面提示「云端不可用」，打卡等功能照常可用

## 技术与设计

- 原生 HTML / CSS / JavaScript（ES5 风格写法，无需编译）
- 无框架、无构建；唯一的第三方脚本是内置的 `vendor/supabase-js.js`
- 设计语言：米白纸感背景 + 深墨绿 + 陶土红，衬线斜体标题，水彩插画与颗粒质感
- 无障碍：语义化标签、`aria-pressed` / `aria-checked` / `aria-current`、键盘可操作、`prefers-reduced-motion` 降级

## 许可

个人学习用途，随意取用。
