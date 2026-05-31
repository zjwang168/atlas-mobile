# 实施步骤 — Reddit Parse & Fetch 功能

> 本文档供 Code 模式按顺序执行。每个步骤完成后标记为 ✅。

---

## Step 1: 后端基础设施

### 1.1 创建 `backend/requirements.txt`

```txt
fastapi==0.115.0
uvicorn==0.30.6
httpx==0.27.2
pydantic==2.9.2
```

### 1.2 创建 `backend/services/cache.py`

- 基于内存 `dict` 的缓存
- `get(key)` / `set(key, value, ttl=3600)` 接口
- key = URL 的 MD5 哈希
- TTL 检查：存时间戳，get 时比较

### 1.3 创建 `backend/services/reddit_fetcher.py`

- 函数: `fetch_reddit_post(url: str) -> dict`
- 从 URL 提取 subreddit 和 post ID（支持多种 Reddit URL 格式）
- 调用 `https://www.reddit.com/r/{subreddit}/comments/{post_id}/.json`
- 返回 `{title, selftext, url, subreddit}`
- 设置 User-Agent header（Reddit API 要求）

### 1.4 创建 `backend/services/llm_client.py`

- 函数: `extract_locations(text: str, api_key: str) -> dict`
- 调用 DeepSeek Chat API: `https://api.deepseek.com/chat/completions`
- 模型: `deepseek-chat`
- Prompt 结构见下文核心逻辑

### 1.5 创建 `backend/services/geocoder.py`

- 函数: `geocode(location_name: str, mapbox_token: str) -> dict`
- 调用 `https://api.mapbox.com/geocoding/v5/mapbox.places/{q}.json?access_token={token}&limit=1`
- 返回 `{name, latitude, longitude, full_address}`
- 函数: `batch_geocode(locations: list[str], mapbox_token: str) -> list[dict]`

### 1.6 创建 `backend/services/route_planner.py`

- 函数: `haversine(lat1, lon1, lat2, lon2) -> float`（返回 km）
- 函数: `plan_route(coords: list[dict], start_index=0) -> dict`
- 构建距离矩阵 → 贪心最近邻 → 2-opt 优化
- 返回 `{ordered_locations, total_distance_km, segments}`

### 1.7 创建 `backend/main.py`

- FastAPI 应用
- `POST /parse_link` 端点
- 请求体: `{"url": "..."}`
- 响应体: `{"title", "locations", "route", "removed_noise"}`
- 调用链: cache → fetcher → llm → geocode → route_planner → cache set → return

---

## Step 2: 前端类型与 API 层

### 2.1 创建 `src/types/route.ts`

```typescript
export interface GeocodedLocation {
  name: string;
  latitude: number;
  longitude: number;
  full_address: string;
}

export interface RouteSegment {
  from: string;
  to: string;
  distance_km: number;
}

export interface ParseResult {
  title: string;
  locations: GeocodedLocation[];
  route: {
    ordered_locations: GeocodedLocation[];
    total_distance_km: number;
    segments: RouteSegment[];
  };
  removed_noise: string[] | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}
```

### 2.2 创建 `src/services/apiService.ts`

- 基础 URL: `http://localhost:8000`（从 `Constants.expoConfig.extra.apiBaseUrl` 读取）
- 函数: `parseLink(url: string): Promise<ParseResult>`
- 函数: `chatWithAI(messages: ChatMessage[]): Promise<string>`（可选，后续对话用）

### 2.3 修改 `src/utils/constants.ts`

```typescript
export const API_BASE_URL = 'http://localhost:8000';
```

> DeepSeek API Key 仅在后端使用，不暴露到前端代码中。

---

## Step 3: 前端核心组件

### 3.1 创建 `src/features/home/SearchBar.tsx`

Props:
- `onSend: (url: string) => void`
- `isLoading: boolean`
- `onHistoryPress: () => void`

内部逻辑:
- `TextInput` 居中
- 左侧历史按钮（圆形图标）
- 右侧发送按钮（箭头图标，内容空时 disabled）
- 聚焦时调用 `expo-clipboard` 的 `getStringAsync()`，如果内容是 Reddit URL 则弹出提示
- 粘贴检测用 `Alert.alert` 或内联提示

### 3.2 创建 `src/features/home/Sidekick.tsx`

基于 `@gorhom/bottom-sheet`:
- `snapPoints: ['40%', '100%']`
- 三种内容状态:
  1. **idle** — 欢迎文案 "粘贴 Reddit 链接开始探索"
  2. **loading** — `ActivityIndicator` + "正在抓取帖子..." / "AI 分析中..." / "规划路线中..."
  3. **result** — 聊天消息列表 `FlatList<ChatMessage>` + 底部输入框

Props:
- `parseResult: ParseResult | null`
- `isLoading: boolean`
- `messages: ChatMessage[]`
- `onSendMessage: (text: string) => void`

### 3.3 修改 `src/features/map/MapboxMap.tsx`

新增可选 props（在 `MapboxMapProps` 接口中添加）:
```typescript
routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
routeMarkers?: MapMarker[];
```

在 `MapboxGL.MapView` 内部、`MarkerView` 循环之后添加:
```tsx
{routeGeoJSON && (
  <MapboxGL.ShapeSource id="routeSource" shape={routeGeoJSON}>
    <MapboxGL.LineLayer
      id="routeLine"
      style={{
        lineColor: '#007AFF',
        lineWidth: 4,
        lineOpacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
      }}
    />
  </MapboxGL.ShapeSource>
)}
```

`markers` 渲染逻辑适配:
- 如果 `routeMarkers` 存在，使用 routeMarkers 替代 markers
- 否则保持原有逻辑不变

### 3.4 修改 `src/features/home/HomeScreen.tsx`

状态管理:
```typescript
const [parseResult, setParseResult] = useState<ParseResult | null>(null);
const [isLoading, setIsLoading] = useState(false);
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [error, setError] = useState<string | null>(null);
```

核心函数 `handleSend(url)`:
1. `setIsLoading(true)`
2. `apiService.parseLink(url)`
3. 成功 → `setParseResult(result)` + 添加系统消息到 Sidekick
4. 失败 → `setError(err.message)`
5. `setIsLoading(false)`

渲染调整:
- 移除旧的 `View style={styles.header}` 卡片
- 添加 `<SearchBar>` 到顶部（绝对定位，`zIndex: 20`）
- 添加 `<Sidekick>` 到底部
- 传递 `parseResult` 给 `MapboxMap`（转换为 `routeGeoJSON` + `routeMarkers`）
- 地图默认缩放到 route 的 bounding box（或保持 Seattle 默认）

`GeoJSON` 转换辅助:
```typescript
const toRouteGeoJSON = (ordered: GeocodedLocation[]): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: ordered.map(loc => [loc.longitude, loc.latitude]),
  },
});
```

### 3.5 修改 `App.tsx`

- 新功能（SearchBar + Sidekick）完全在 HomeScreen 内部管理
- App.tsx 的 overlay 逻辑保持不动
- 但需确认 Sidekick（BottomSheet）与 ImportScreen/PreviewScreen 的全屏 overlay 不冲突
- 建议: 当 overlay 切换时，HomeScreen 内部暂停 Sidekick 的交互

---

## Step 4: 关键算法与 Prompt

### 4.1 LLM Prompt 模板

```
You are a location extraction assistant. Extract all real geographic locations 
(cities, landmarks, restaurants, shops, parks, natural features) from the 
Reddit post text below.

Rules:
1. Output ONLY a JSON object with this exact structure:
   {"locations": ["name1", "name2", ...], "removed_noise": ["noise1", ...] | null}
2. Include only actual geographic places that people can visit.
3. If multiple locations are mentioned, infer the main region from context.
4. Remove "noise addresses" that are far from the main region.
   - Example: post about San Francisco -> remove addresses in New York
   - Example: post about a 7-day Europe trip -> remove non-European addresses
   - Example: post about Jiang-Zhe-Hu region -> remove addresses outside it
5. If you removed any noise addresses, list them in "removed_noise" and explain why briefly.
6. If no noise was removed, set "removed_noise" to null.
7. For ambiguous names (e.g. "Chaoyang"), include clarifying context like city/region.

Text:
{post_title}

{post_text}

JSON:
```

### 4.2 Haversine 距离公式

```
a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2)
c = 2 · atan2(√a, √(1-a))
d = R · c
R = 6371 km (地球半径)
```

### 4.3 贪心 TSP 算法

```
1. 从 start_index 开始
2. 标记为已访问
3. 循环直到所有节点已访问:
   a. 从当前节点出发
   b. 找到最近且未访问的节点
   c. 移动到该节点
4. 可选项: 2-opt 局部优化（交换两条边看总距离是否减少）
```

---

## Step 5: 测试

### 5.1 后端单独测试
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# curl 测试:
curl -X POST http://localhost:8000/parse_link \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.reddit.com/r/AskSF/comments/1127auu/what_are_some_touristy_things_that_locals_enjoy/"}'
```

### 5.2 全链路测试
1. 启动后端
2. 启动 Expo: `npx expo start`
3. 在模拟器中打开 app
4. 粘贴测试 URL → 发送
5. 验证: Sidekick 显示地点列表 + 地图绘制路线

---

## Step 6: 后续对话支持（可选增强）

- Sidekick 底部输入框
- 发送消息 → 调用 DeepSeek Chat API（带历史上下文）
- 追加到 `messages` 列表
- FlatList 自动滚动到底部

---

## 执行顺序总结

```
Step 1: 后端全部文件 (8个)
  ├── requirements.txt
  ├── main.py
  └── services/*.py (6个)

Step 2: 前端类型 + API + 常量 (3个)
  ├── src/types/route.ts          (新建)
  ├── src/services/apiService.ts   (新建)
  └── src/utils/constants.ts       (修改)

Step 3: 前端 UI 组件 (4个)
  ├── SearchBar.tsx                (新建)
  ├── Sidekick.tsx                 (新建)
  ├── MapboxMap.tsx                (修改)
  └── HomeScreen.tsx               (修改)

Step 4: App.tsx 兼容性调整 (1个)

Step 5: 测试验证
```
