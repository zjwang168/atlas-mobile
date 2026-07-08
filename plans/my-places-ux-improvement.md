# My Places / Map / Chat History UX 综合改进方案

## 需求概述

共涉及 **8 个相互关联的改进点**，涵盖 4 个屏幕/组件：My Places、HomeScreen Map、Chat History、SaveScreen。

---

## 改进点 1: 默认地图聚焦到用户定位

**当前问题:** HomeScreen 中 `mapCenter` 默认值为 `[-122.3321, 47.6062]`（硬编码西雅图坐标）。

**目标:** 打开 App 时地图默认聚焦到用户当前 GPS 位置。

**方案:** 在 [`HomeContext.tsx`](src/features/home/HomeContext.tsx:119) 中添加 `userLocation` 状态，使用 `expo-location` 获取 GPS 位置。在 [`HomeScreen.tsx:116-120`](src/features/home/HomeScreen.tsx:116) 的 `mapCenter` 计算中，当没有任何选中地点或 parsedPlaces 时，回退到 `userLocation` 而非硬编码坐标。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`HomeContext.tsx`](src/features/home/HomeContext.tsx:119) | 添加 `userLocation: [number, number] \| null` 状态；在 `HomeProvider` 中用 `expo-location` 获取 GPS |
| [`HomeScreen.tsx:116-120`](src/features/home/HomeScreen.tsx:116) | `mapCenter` 回退链改为：`selectedPlaceCoordinate` > `parsedPlaces` 中位数 > `userLocation` > 默认值 |

---

## 改进点 2: My Places 所有地点在地图上显示定点

**当前问题:** 地图只显示 parsedPlaces（解析结果）或 mockPlaces，不显示已保存的地点。

**目标:** 所有已保存的地点（`savedPlaces`）都作为标记点显示在地图上，但不自动聚焦。

**方案:** 在 [`HomeScreen.tsx:101-123`](src/features/home/HomeScreen.tsx:101) 中，添加 `savedMarkers` 计算，将 `savedPlaces` 转换为 `MapMarker[]`。合并 `parsedMarkers` 和 `savedMarkers` 作为最终的 `mapMarkers`。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`HomeScreen.tsx`](src/features/home/HomeScreen.tsx:101-123) | 新增 `toMapMarkersFromSaved()` 辅助函数；合并 savedMarkers + parsedMarkers 作为 mapMarkers；添加 `savedPlaces` 到 useHome 解构 |

---

## 改进点 3: Chat History 中 Save places 按钮改进

**当前问题:** HistoryPlacesPanel 有一个整体 "Save places" 按钮保存所有地点。

**目标:** 每个条目右侧显示是否已保存的状态标记（浅绿色，不可操作）。未保存的条目可选中，然后通过 "Save places" 按钮批量保存已选中的地点。

**方案:** 在 [`HistoryPlacesPanel.tsx`](src/features/home/HistoryPlacesPanel.tsx:61-84) 中：
1. 获取 `savedPlaces` 列表，判断每个地点是否已存在（通过 name+lat+lng 匹配）
2. 已保存的条目显示浅绿色标记 + 不可选
3. 未保存的条目保留现有 check/toggle 逻辑
4. 只保存 selected 的条目（通过 `onSavePlaces` 传入选中的 IDs）

需要修改 `HomePanel.tsx` 中的 `handleSaveHistoryPlaces` 和 `HistoryPlacesPanel` 的 props 来支持选中特定地点保存。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`HistoryPlacesPanel.tsx`](src/features/home/HistoryPlacesPanel.tsx:24) | 添加 `savedPlaceIds: Set<string>` prop；添加选中状态；修改 UI 显示保存状态 |
| [`HomePanel.tsx:56-66`](src/features/home/HomePanel.tsx:56) | `handleSaveHistoryPlaces` 改为只保存选中的 places |

---

## 改进点 4: SaveScreen 已存在地点不可选

**当前问题:** SaveScreen 中所有地点都可以选中保存，包括已存在于 my places 的。

**目标:** 已存在于 my places 的地点显示为灰色/不可选状态，且不计入选中计数。

**方案:** 在 [`SaveScreen.tsx:61-63`](src/features/import-places/save-screen/SaveScreen.tsx:61) 初始化 `selected` 状态时，排除已保存的地点。或者在 `toggleOne` 中，如果地点已保存则不做任何操作。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`SaveScreen.tsx`](src/features/import-places/save-screen/SaveScreen.tsx:57) | 获取 `savedPlaces` 上下文；初始化时排除已保存的；UI 上显示已保存标记 |

---

## 改进点 5: Save 后地图聚焦回定位

**当前问题:** 已在 [Bug 4] 中修复，`onSave` 回调清除 `selectedPlaceCoordinate` 和 `selectedPlaceId`，但还需确保 `parsedPlaces` 也被清除。

**目标:** Save 后回到主界面，地图聚焦回用户定位。

**方案:** 在 [`App.tsx:151`](App.tsx:151) 的 `onSave` 回调中，在 `setOverlay('none')` 之前确保 `setParsedPlaces([])`、`setSelectedPlaceCoordinate(null)`、`setSelectedPlaceId(null)`。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`App.tsx:158-160`](App.tsx:158) | 确保 `onSave` 中清除 `setParsedPlaces([])` |

---

## 改进点 6: 地图图钉 ↔ 列表双向高亮 + 自动滚动

**当前问题:** 在 My Places、Chat History、SaveScreen 三个场景中，点击地图标记或列表条目时，另一端应高亮对应项，并且高亮项应自动滚动到可见区域。

**目标:**
| 场景 | 点击列表条目 | 点击地图标记 |
|------|-------------|-------------|
| My Places | 地图聚焦 + 绿色标记 + 高亮条目 | 高亮列表对应条目 + 自动滚动 |
| Chat History | 地图聚焦 + 绿色标记 + 高亮条目 | 高亮列表对应条目 + 自动滚动 |
| SaveScreen | 地图聚焦 + 绿色标记 + 高亮条目 | 高亮列表对应条目 + 自动滚动 |

**方案:**
1. **My Places (`AllPlaces.tsx`):** 添加 `selectedPlaceId` prop；使用 `FlatList.scrollToIndex()` 在选中时自动滚动
2. **Chat History (`HistoryPlacesPanel.tsx`):** 添加 `scrollToIndex` 逻辑
3. **SaveScreen (`SaveScreen.tsx`):** 使用 `ScrollView.scrollTo()` 在 `selectedPlaceId` 变化时滚动

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`AllPlaces.tsx`](src/features/my-places/all-places/AllPlaces.tsx:57) | 添加 `selectedPlaceId` prop；用 `useRef` + `scrollToIndex` 自动滚动 |
| [`MyPlaces.tsx`](src/features/my-places/MyPlaces.tsx:163) | 传递 `selectedPlaceId` 给 AllPlaces |
| [`HomePanel.tsx:100`](src/features/home/HomePanel.tsx:100) | 传递 `selectedPlaceId` 给 MyPlaces |
| [`HistoryPlacesPanel.tsx:52`](src/features/home/HistoryPlacesPanel.tsx:52) | 添加 `FlatList` ref；在 `selectedPlaceId` 变化时 `scrollToIndex` |
| [`SaveScreen.tsx:200`](src/features/import-places/save-screen/SaveScreen.tsx:200) | 添加 `ScrollView` ref；在 `selectedPlaceId` 变化时 `scrollTo` |

---

## 改进点 7: 点击条目时智能缩放

**当前问题:** 点击 location 条目时，地图的 `zoomLevel` 固定为 12，可能不足以清晰显示选中的绿色标记点。

**目标:** 点击条目时，地图放大到能清晰显示该地点的标记的级别；周围有其他标记时智能调整缩放。

**方案:** 在 [`HomeScreen.tsx:124`](src/features/home/HomeScreen.tsx:124) 中，当 `selectedPlaceCoordinate` 存在时，使用更高的缩放级别（如 14-16）。考虑使用 `useMemo` 根据 `hasParsedPlaces` 和 `selectedPlaceCoordinate` 动态计算 `mapZoom`。

对于 SaveScreen 和 HistoryPlacesPanel 中的地图，同样调整 zoom level。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`HomeScreen.tsx:124`](src/features/home/HomeScreen.tsx:124) | `mapZoom` 改为动态计算：选中地点时 15，否则 10-12 |
| [`SaveScreen.tsx:135`](src/features/import-places/save-screen/SaveScreen.tsx:135) | `zoomLevel` 改为动态：选中时 15，否则 12 |

---

## 改进点 8: Chat History 切换时地图聚焦更新

**当前问题:** 切换 Chat History 条目时，地图聚焦到新 Chat 的地点（已在 `handleItemPress` 中通过 `setParsedPlaces(item.places)` 实现）。但 `selectedPlaceCoordinate` 可能未清除，导致地图仍聚焦到旧 Chat 中被选中的地点。

**目标:** 切换 Chat 时，地图应聚焦到新 Chat 的地点集合的中心位置。

**方案:** 在 [`ChatHistoryPanel.tsx:52-61`](src/features/home/ChatHistoryPanel.tsx:52) 的 `handleItemPress` 中，添加 `setSelectedPlaceCoordinate(null)` 和 `setSelectedPlaceId(null)`，让 `mapCenter` 回退到 `parsedPlaces` 的中位数中心。

**修改文件:**
| 文件 | 改动 |
|------|------|
| [`ChatHistoryPanel.tsx:55-56`](src/features/home/ChatHistoryPanel.tsx:55) | `handleItemPress` 中添加 `setSelectedPlaceCoordinate(null)`、`setSelectedPlaceId(null)` |

---

## 完整修改文件清单

| # | 文件 | 涉及改进点 | 改动复杂度 |
|---|------|-----------|-----------|
| 1 | [`HomeContext.tsx`](src/features/home/HomeContext.tsx) | 1 | 中 - 添加 userLocation 状态和 GPS 获取 |
| 2 | [`HomeScreen.tsx`](src/features/home/HomeScreen.tsx) | 1, 2, 6, 7 | 高 - 合并 markers、动态 zoom、默认定位 |
| 3 | [`AllPlaces.tsx`](src/features/my-places/all-places/AllPlaces.tsx) | 6 | 中 - 添加滚动到选中项 |
| 4 | [`MyPlaces.tsx`](src/features/my-places/MyPlaces.tsx) | 6 | 低 - 传递 selectedPlaceId |
| 5 | [`HomePanel.tsx`](src/features/home/HomePanel.tsx) | 3, 6 | 中 - 传递 selectedPlaceId、修改保存逻辑 |
| 6 | [`HistoryPlacesPanel.tsx`](src/features/home/HistoryPlacesPanel.tsx) | 3, 6 | 高 - 保存状态显示、滚动到选中项 |
| 7 | [`SaveScreen.tsx`](src/features/import-places/save-screen/SaveScreen.tsx) | 4, 6, 7 | 中 - 已保存不可选、滚动、动态 zoom |
| 8 | [`App.tsx`](App.tsx) | 5 | 低 - 确保 onSave 清除所有地图状态 |
| 9 | [`ChatHistoryPanel.tsx`](src/features/home/ChatHistoryPanel.tsx) | 8 | 低 - 切换时清除选中状态 |

---

## 实施建议

由于这些改进点高度关联（特别是 6、7 涉及三个不同场景的相同逻辑），建议按以下顺序实施：

1. **基础设施层:** [HomeContext] userLocation 状态 (改进点 1)
2. **地图层:** [HomeScreen] 合并 savedPlaces 标记 + 动态 zoom (改进点 2, 7)
3. **列表同步:** [AllPlaces, MyPlaces, HistoryPlacesPanel, SaveScreen] 双向高亮 + 滚动 (改进点 6)
4. **保存逻辑:** [HistoryPlacesPanel, HomePanel, SaveScreen] 保存状态显示和去重 (改进点 3, 4)
5. **状态清理:** [App.tsx, ChatHistoryPanel] 切换/返回时清除地图状态 (改进点 5, 8)
