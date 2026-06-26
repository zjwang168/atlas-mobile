# 文件清单 — Reddit Parse & Fetch 功能

> 本文档记录本功能涉及的所有文件，按操作类型分类。仅列出与 URL 解析、地点提取、路线规划直接相关的文件，其余模块与此功能无直接关联，暂不作修改。

---

## 一、新增文件（共 11 个）

### 后端 — FastAPI 服务

| # | 文件路径 | 职责 |
|---|----------|------|
| 1 | `backend/requirements.txt` | Python 依赖声明 |
| 2 | `backend/main.py` | FastAPI 应用入口，注册 `/parse_link` 端点 |
| 3 | `backend/services/__init__.py` | 包初始化 |
| 4 | `backend/services/reddit_fetcher.py` | Reddit 官方 JSON API 抓取帖子内容 |
| 5 | `backend/services/llm_client.py` | DeepSeek V4 Flash API 调用 + 地点提取 Prompt |
| 6 | `backend/services/geocoder.py` | Mapbox Geocoding API 地名→坐标转换 |
| 7 | `backend/services/route_planner.py` | TSP 贪心算法 + 2-opt 路径优化 |
| 8 | `backend/services/cache.py` | 内存缓存（URL→结果，避免重复请求） |

### 前端 — 类型与 API 层

| # | 文件路径 | 职责 |
|---|----------|------|
| 9 | `src/types/route.ts` | GeocodedLocation, ParseResult, ChatMessage 等类型定义 |
| 10 | `src/services/apiService.ts` | 封装 HTTP 请求调用后端 `/parse_link` |

### 前端 — UI 组件

| # | 文件路径 | 职责 |
|---|----------|------|
| 11 | `src/features/home/SearchBar.tsx` | 顶部搜索栏：历史按钮 + 输入框（剪贴板检测）+ 发送按钮 |
| 12 | `src/features/home/Sidekick.tsx` | 底部聊天面板（BottomSheet），显示加载/结果/对话 |

---

## 二、修改文件（共 4 个）

| # | 文件路径 | 修改内容 |
|---|----------|----------|
| 13 | `src/features/map/MapboxMap.tsx` | 新增可选 `routeGeoJSON` 和 `routeMarkers` props，内部用 ShapeSource+LineLayer 渲染路线折线；不破坏现有标记渲染逻辑 |
| 14 | `src/features/home/HomeScreen.tsx` | 集成 SearchBar 和 Sidekick；管理 parseResult/loading 状态；将路线数据和排序后标记传递给 MapboxMap |
| 15 | `src/utils/constants.ts` | 添加 `API_BASE_URL`、`DEEPSEEK_API_KEY` 等常量 |
| 16 | `App.tsx` | 调整 overlay 逻辑以兼容 Sidekick（Sidekick 在 HomeScreen 内部管理，App 层只需确保 ImportScreen/PreviewScreen 覆盖层不冲突） |

---

## 三、与此功能无直接关联、暂不作修改的模块

以下模块属于项目的其他功能领域，与本功能的 URL 解析→地点提取→路线规划流程无直接依赖，因此保持原状不做改动：

| 模块 | 文件 | 说明 |
|------|------|------|
| 导入界面 | `src/features/import/ImportScreen.tsx` | 已有的全屏导入界面，与新的 SearchBar 方案不重叠 |
| 预览界面 | `src/features/import/PreviewScreen.tsx` | 已有的地点预览面板，Sidekick 承担了类似角色 |
| 收藏功能 | `src/features/collections/*` | 独立的收藏模块 |
| 地点详情 | `src/features/place/PlaceDetailScreen.tsx` | 地点详情页，由其他队友负责 |
| 已有服务层 | `src/services/aiService.ts` | 与本功能无关的 AI 服务预留 |
| | `src/services/importService.ts` | 与本功能无关的导入服务预留 |
| | `src/services/placeService.ts` | 与本功能无关的地点服务预留 |
| | `src/services/supabaseClient.ts` | 数据持久化层，由其他队友负责 |
| 已有类型 | `src/types/place.ts` | Place 类型已定义，本功能新增 route.ts 而非修改 |
| | `src/types/collection.ts` | 收藏类型，由其他队友负责 |
| | `src/types/import.ts` | 导入类型，由其他队友负责 |
| | `src/types/user.ts` | 用户类型，由其他队友负责 |
| 模拟数据 | `src/data/mockPlaces.ts` | 模拟数据，与本功能无关 |
| 格式化工具 | `src/utils/format.ts` | 暂未使用，保持原状 |
| 组件库 | `src/component/*` | 共享组件，暂无修改必要 |

---

## 四、需新增的依赖

| 包名 | 版本 | 用途 | 安装命令 |
|------|------|------|----------|
| `expo-clipboard` | ~7.0.0 | 检测剪贴板内容（URL） | 内置在 Expo SDK 56 中，无需额外安装 |
| `fastapi` | 0.115+ | 后端框架 | `pip install` |
| `httpx` | 0.27+ | 异步 HTTP 客户端 | `pip install` |

---

## 五、文件操作汇总

```
操作总计: 新增 12 个 + 修改 4 个 = 16 个文件

parseAndFecthPlanning/           ← 设计文档
├── architecture-overview.md     ← 系统架构 + 数据流图 (新建)
├── implementation-plan.md       ← 实施步骤 (新建)
└── file-checklist.md            ← 本文件 (新建)

backend/                         ← 后端服务 (新建目录)
├── requirements.txt             ← (新建)
├── main.py                      ← (新建)
└── services/
    ├── __init__.py              ← (新建)
    ├── reddit_fetcher.py        ← (新建)
    ├── llm_client.py            ← (新建)
    ├── geocoder.py              ← (新建)
    ├── route_planner.py         ← (新建)
    └── cache.py                 ← (新建)

src/
├── types/
│   └── route.ts                 ← (新建)
├── services/
│   └── apiService.ts            ← (新建)
├── features/
│   ├── home/
│   │   ├── SearchBar.tsx        ← (新建)
│   │   ├── Sidekick.tsx         ← (新建)
│   │   └── HomeScreen.tsx       ← (修改)
│   └── map/
│       └── MapboxMap.tsx        ← (修改)
└── utils/
    └── constants.ts             ← (修改)
```
