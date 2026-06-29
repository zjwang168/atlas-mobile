# 底部导航改为原生 iOS 26 Tab Bar + 一系列 UI 优化

## 概述
把首页底部导航从自定义 BottomBar 换成了 **原生 iOS 26 Liquid Glass tab bar**(`react-native-screens` 的 `Tabs.Host` / `Tabs.Screen`,底层是 `UITabBarController`),并顺带优化了 ContentPanel 的手势/动画、把 segmented control 换成原生样式、NavBar 图标换成 Phosphor。

> ⚠️ 需要重新 build 原生(用到了 `react-native-screens` 的原生 Tabs 和新依赖)。首次拉取后请 `npx expo run:ios`。如果图标显示模糊,`npx expo start -c` 清一次 Metro 缓存。

## 主要改动

### 1. 原生底部 Tab Bar(核心)
- `src/features/home/HomeScreen.tsx`(大改):用原生 `Tabs.Host` / `Tabs.Screen` 替换自定义 BottomBar
- 左侧 pill:My Places / My Plan;右侧独立圆圈:"+"(`systemItem: 'search'`,`preventNativeSelection` 拦截后不导航)
- 内容全屏铺在 tab bar 下层,tab bar 浮在上面;TopNav / PlaceDetail 作为 RN 浮层叠在最上层
- 高亮色 = 品牌绿 `#12C170`(`tabBarTintColor`)

### 2. NavBar 图标改用 Phosphor
- 新增 `assets/tabs/`:`map-pin-area` / `notebook` 的模板 PNG(24/48/72,描边 + 实心两版)
- 通过 `templateSource` 接入:未选中=灰色描边,选中=绿色实心
- "+"用 Phosphor `plus`(`imageSource`,常黑单一状态)

### 3. "+" 弹出菜单(新组件)
- 新增 `src/components/add-menu/AddMenu.tsx`:点"+"从右下角 spring 展开,GlassView 背景
- 两项:Import places、Chat with AI

### 4. ContentPanel 优化
- `src/components/content-panel/ContentPanel.tsx`
- 仅顶部 drag handle 可拖动整个面板(内容区滑动不再误收起)
- 释放时永远吸附到最近 snap 点 + 弹簧动画
- 背景从 BlurView 改为纯白 `#FFFFFF`

### 5. All places / Atlas 改为原生 Segmented Control
- `src/features/my-places/MyPlaces.tsx`:用 `@expo/ui` 原生 `SegmentedControl`(纯文字,标准 iOS 样式)

### 6. 依赖
- `package.json` 新增:`@expo/ui`、`expo-glass-effect`

## 已废弃 / 不再使用(暂留,后续可删)
- `src/components/bottom-nav/BottomBar.tsx` —— 旧自定义底栏,已被原生 tab bar 取代
- `src/features/home/HomePanel.tsx` —— 逻辑已并入 `HomeScreen`,目前未被引用

## 已知限制(原生层面无法定制)
- tab bar 选中项的**背景高亮色**:iOS 上 `react-native-screens` 未暴露,无法改成浅绿(只有 Android 有)
- 原生 segmented control 的**未选中文字颜色**:系统控制,无法单独改成灰色
- 如需以上定制,只能放弃原生、改回自定义组件
