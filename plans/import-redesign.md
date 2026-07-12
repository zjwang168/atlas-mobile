# Add Places 完整重构方案

## 涉及文件及具体改动

### 1. HomeScreen.tsx — 简化 "+" 按钮行为

**改动 A: 移除 AddMenu**
- 删除第 5 行 `import AddMenu`
- 删除第 172 行 `const handleAddPress = useCallback(() => setAddMenuOpen(true), [])`
- 删除第 103 行 `const [addMenuOpen, setAddMenuOpen] = useState(false)`
- 删除第 271-281 行 `<AddMenu ...>` 组件

**改动 B: "+" 按钮直接触发 import**
- `handleAddPress` 改为直接调用 `onOpenImport?.()`，即：
  ```tsx
  const handleAddPress = useCallback(() => {
    onOpenImport?.();
  }, [onOpenImport]);
  ```

### 2. AIChatBox.tsx — 纯对话模式

**改动: 移除 import/discover 逻辑**
- 移除 `onImportRequest` prop 类型定义
- 从 `AIChatBoxProps` 中删除 `onImportRequest`
- 移除 `looksLikePastedContent()` 函数
- 移除 `looksLikeLocationDiscoveryRequest()` 函数
- 从 `handleSend` 中移除调用 `onImportRequest` 的代码分支
- 保留 `chatWithAtlas` 对话逻辑
- 输入框 placeholder 改为 `"Ask Atlas AI..."`

### 3. ImportScreen.tsx — 完整重写

**UI 布局：**
```
┌─────────────────────────────┐
│  Add places            [X]  │
├─────────────────────────────┤
│                             │
│  ┌─────┐  ┌─────┐          │
│  │📝   │  │🖼️   │          │
│  │Smart │  │Image │          │
│  │Text  │  │Scan  │          │
│  └─────┘  └─────┘          │
│                             │
│  ┌─────┐  ┌─────┐          │
│  │📎   │  │🔗   │          │
│  │Reddit│  │Any   │          │
│  │Links │  │Links │          │
│  └─────┘  └─────┘          │
│                             │
│  [输入框/图片选择器]          │
│  [发送按钮]                  │
└─────────────────────────────┘
```

**改动 A: 新增 import**
- `useState<ImportMode>` — 当前选中的模式（'smartText' | 'imageScan' | 'redditLinks' | 'anyLinks' | null）
- `useState<string>` — 输入文本

**改动 B: 4 个模式按钮**

每个按钮包含：
- 图标 (Ionicons)
- 标题
- 副标题（灰色小字）

| 按钮 | 图标 | 标题 | 副标题 |
|------|------|------|--------|
| Smart Text | `document-text-outline` | Smart Text | Extract Places from Smart Chat |
| Image Scan | `image-outline` | Image Scan | Extract Places from Images |
| Reddit Links | `logo-reddit` | Reddit Links | Extract Places from Reddit Posts/Threads |
| Any Links | `link-outline` | Any Links | Extract Places from any URLs |

被选中的按钮高亮（绿色边框 + 浅绿色背景）。

**改动 C: 输入框根据模式变化**

| 模式 | 输入框行为 |
|------|-----------|
| Smart Text | placeholder: "Show me Breaking Bad filming locations..."；去掉 "+" 按钮 |
| Reddit Links | placeholder: "Copy a Reddit post/thread URL here..."；去掉 "+" 按钮 |
| Image Scan | 输入框变为图片选择按钮（最多 3 张）；去掉文本输入 |
| Any Links | placeholder: "Extract places from URLs here..."；去掉 "+" 按钮 |
| 未选择模式 | placeholder: "Choose a mode above..."；禁用发送按钮 |

**改动 D: onSubmit 签名**
- `onSubmit: (text: string, mode: ImportMode) => void`
- 当 mode 为 'smartText' 时，App.tsx 走 `discoverFromAtlasQuery` 路径
- 当 mode 为 'redditLinks' 时，App.tsx 走 `parseInput` 路径
- 当 mode 为 'imageScan' / 'anyLinks' 时，显示 "Coming soon"（Toast/Alert）

### 4. App.tsx — 适配 ImportScreen 新模式

**改动 A: ImportScreen onSubmit (第 233 行附近)**
- 接收 `(text: string, mode: ImportMode)`
- 根据 mode 设置 `importMeta`
- 如果 mode 是 'imageScan' 或 'anyLinks'，展示 Alert("Coming soon")

**改动 B: HomeScreen onOpenImport (第 218 行附近)**
- 保持不变（直接设置 overlay 为 'import'）

**改动 C: 移除 onStartAiImport**
- 从 HomeScreen props 中移除 `onStartAiImport`（因为 AIChatBox 不再需要）

---

## 实施步骤

| 步骤 | 文件 | 改动类型 |
|------|------|----------|
| 1 | AIChatBox.tsx | 移除 import 逻辑，纯对话 |
| 2 | HomeScreen.tsx | 移除 AddMenu，"+" 直开 import |
| 3 | ImportScreen.tsx | 完全重写（4 按钮 + 动态输入） |
| 4 | App.tsx | 适配 ImportScreen onSubmit 签名 |
