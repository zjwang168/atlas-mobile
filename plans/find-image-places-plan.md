# Find Image Places — 实施计划

## 概述

新增 **"Find Image Places"** 功能块：用户上传一张图片 → 后端用 Google Cloud Vision API 识别地标 → 根据置信度分数决定是否用 DeepSeek-V3.2 视觉模式兜底 → 返回地标名称 + 坐标给前端 save screen 展示。

同时将现有 **"Image Scan"** 更名为 **"Find Text Places"**。

---

## 1. 架构流程图

```mermaid
graph TD
    subgraph "Frontend (React Native)"
        UI[ImportScreen] -->|Select 1 Image| IMG[Image Picker]
        IMG -->|base64| API[POST /find_image_places]
        API -->|ParseResult| SS[SaveScreen]
    end

    subgraph "Backend (FastAPI)"
        EP[/find_image_places endpoint]
        EP --> GCV[Google Cloud Vision API]
        GCV -->|landmark_annotations| DECIDE{Confidence > 0.67?}
        DECIDE -->|Yes| RESULT1[Return landmark + coordinates]
        DECIDE -->|No| DSV[DeepSeek-V3.2 Vision Mode]
        DSV -->|recognized| RESULT2[Return DeepSeek result]
        DSV -->|not recognized| RESULT3[Fallback to GCV result]
    end
```

---

## 2. 后端实现

### 2.1 新增服务：`backend/services/find_image_places_service.py`

```python
"""
Find Image Places service — Google Cloud Vision API → confidence check → optional DeepSeek vision fallback.

Flow:
1. Call Google Cloud Vision API landmark detection
2. If confidence > 0.67 → return result directly
3. If confidence <= 0.67 → call DeepSeek-V3.2 vision mode
   - If DeepSeek recognizes → return DeepSeek result
   - If not → fallback to Google Cloud Vision result
"""

import base64
import json
import logging
import os
from typing import Optional

logger = logging.getLogger("atlas.find_image_places")

# Google Cloud Vision API 配置
GOOGLE_VISION_API_KEY = os.environ.get("GOOGLE_VISION_API_KEY", "")

# DeepSeek-V3.2 视觉模型
DEEPSEEK_VISION_MODEL = "deepseek-v3.2"  # DeepSeek-V3.2 视觉模型

# 置信度阈值
CONFIDENCE_THRESHOLD = 0.67


class LandmarkResult:
    """地标识别结果"""
    name: str
    latitude: float
    longitude: float
    confidence: float
    source: str  # "google_vision" | "deepseek_vision" | "fallback"


async def find_image_place(image_base64: str) -> dict:
    """
    Main entry point for Find Image Places.
    
    1. Call Google Cloud Vision API landmark detection
    2. Check confidence score
    3. If low confidence → DeepSeek-V3.2 vision fallback
    4. Return result
    """
    # Step 1: Google Cloud Vision API
    vision_result = await _call_google_vision_landmark(image_base64)
    
    if not vision_result or not vision_result.get("landmark_annotations"):
        # No landmark found at all → try DeepSeek vision directly
        deepseek_result = await _call_deepseek_vision(image_base64)
        return _build_response(deepseek_result, source="deepseek_vision")
    
    # Take the top landmark
    top_landmark = vision_result["landmark_annotations"][0]
    confidence = top_landmark.get("score", 0)
    landmark_name = top_landmark.get("description", "")
    coordinates = _extract_coordinates(top_landmark)
    
    if confidence >= CONFIDENCE_THRESHOLD:
        # High confidence → return directly
        subtitle = f"There is a {confidence:.1%} probability that this image is located at..."
        return _build_response({
            "name": landmark_name,
            "latitude": coordinates["lat"],
            "longitude": coordinates["lng"],
            "confidence": confidence,
            "subtitle": subtitle,
        }, source="google_vision", subtitle=subtitle)
    
    # Low confidence → DeepSeek-V3.2 vision fallback
    deepseek_result = await _call_deepseek_vision(image_base64)
    
    if deepseek_result and deepseek_result.get("recognized"):
        subtitle = "There is a high probability that the place in this image is... Happy exploring!"
        return _build_response({
            "name": deepseek_result["name"],
            "latitude": deepseek_result["latitude"],
            "longitude": deepseek_result["longitude"],
            "confidence": deepseek_result.get("confidence", 0),
            "subtitle": subtitle,
        }, source="deepseek_vision", subtitle=subtitle)
    
    # DeepSeek also failed → fallback to Google Vision result
    subtitle = f"After multiple rounds of searching, we are only {confidence:.1%} confident that the place in the image is at..."
    return _build_response({
        "name": landmark_name,
        "latitude": coordinates["lat"],
        "longitude": coordinates["lng"],
        "confidence": confidence,
        "subtitle": subtitle,
    }, source="fallback", subtitle=subtitle)


async def _call_google_vision_landmark(image_base64: str) -> Optional[dict]:
    """
    Call Google Cloud Vision API landmark detection.
    Returns landmark annotations with description, score, and latlng.
    """
    # 需要配置 GOOGLE_VISION_API_KEY
    # API: https://vision.googleapis.com/v1/images:annotate
    # Request body:
    # {
    #   "requests": [{
    #     "image": {"content": image_base64},
    #     "features": [{"type": "LANDMARK_DETECTION", "maxResults": 3}]
    #   }]
    # }


async def _call_deepseek_vision(image_base64: str) -> Optional[dict]:
    """
    Call DeepSeek-V3.2 vision mode to identify place from image.
    Uses LangChain's ChatOpenAI with the DeepSeek vision model.
    
    Returns:
        dict with keys: recognized (bool), name (str), latitude (float), longitude (float), confidence (float)
    """
    # 使用 langchain_runtime.py 的 get_chat_model()
    # 构建 vision prompt 让 DeepSeek 分析图片
    # 
    # LangChain 方式:
    #   from backend.services.langchain_runtime import get_chat_model
    #   model = get_chat_model("deepseek", DEEPSEEK_VISION_MODEL, temperature=0.1)
    #   from langchain_core.messages import HumanMessage
    #   msg = HumanMessage(
    #       content=[
    #           {"type": "text", "text": "Identify the geographic location or landmark in this image. Return JSON: {\"name\": \"...\", \"latitude\": ..., \"longitude\": ...}"},
    #           {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
    #       ]
    #   )
    #   response = model.invoke([msg])


def _extract_coordinates(landmark: dict) -> dict:
    """Extract lat/lng from Google Vision landmark annotation."""
    lat_lng = landmark.get("locations", [{}])[0].get("latLng", {})
    return {"lat": lat_lng.get("latitude", 0), "lng": lat_lng.get("longitude", 0)}


def _build_response(data: dict, source: str, subtitle: str = "") -> dict:
    """Build standardized response for the frontend."""
    return {
        "title": data.get("name", "Unknown Place"),
        "locations": [
            {
                "name": data.get("name", "Unknown Place"),
                "latitude": data.get("latitude", 0),
                "longitude": data.get("longitude", 0),
                "description": subtitle or data.get("subtitle", ""),
                "source": source,
                "confidence": data.get("confidence", 0),
            }
        ],
        # 兼容现有的 ParseResponse 格式
        "route": {"ordered_locations": [], "total_distance_km": 0.0, "segments": []},
        "source_type": "find_image_places",
    }
```

### 2.2 新增端点：`POST /find_image_places`

在 [`backend/main.py`](backend/main.py) 中新增：

```python
class FindImagePlaceRequest(BaseModel):
    image: str  # base64-encoded image data

@app.post("/find_image_places", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def find_image_place(req: FindImagePlaceRequest):
    """Identify a geographic place from an image using Google Cloud Vision + DeepSeek vision fallback."""
    if not req.image:
        raise HTTPException(status_code=400, detail="No image provided.")
    
    from backend.services.find_image_places_service import find_image_place
    try:
        result = await find_image_place(req.image)
        return ParseResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Find image place failed: {e}")
```

### 2.3 新增依赖

在 [`backend/requirements.txt`](backend/requirements.txt) 中添加：
```
google-cloud-vision==3.*
```

**注意**：也可以使用 REST API 直接调用 Google Cloud Vision，不需要安装 SDK，只需 API Key。

---

## 3. 前端实现

### 3.1 更改 ImportScreen 的 mode 列表

在 [`src/features/import-places/import-screen/ImportScreen.tsx`](src/features/import-places/import-screen/ImportScreen.tsx) 中：

**a. 将 `imageScan` 重命名为 `findTextPlaces`：**

```typescript
export type ImportMode = 'smartText' | 'findTextPlaces' | 'redditLinks' | 'anyLinks' | 'findImagePlaces';
```

**b. 更新 modes 数组：**

```typescript
const modes: { key: ImportMode; icon: string; title: string; subtitle: string }[] = [
  { key: 'smartText', icon: 'document-text-outline', title: 'Smart Text', subtitle: 'Paste a prompt, note, or itinerary' },
  { key: 'findTextPlaces', icon: 'image-outline', title: 'Find Text Places', subtitle: 'Scan image text for places' },
  { key: 'redditLinks', icon: 'logo-reddit', title: 'Reddit Links', subtitle: 'Save places from Reddit threads' },
  { key: 'anyLinks', icon: 'link-outline', title: 'Any Links', subtitle: 'Vision scan any web page' },
  { key: 'findImagePlaces', icon: 'camera-outline', title: 'Find Image Places', subtitle: 'Identify landmarks from photos' },
];
```

**c. 修改 `handleSubmit`：**

```typescript
const handleSubmit = useCallback(async () => {
    if (!selectedMode) return;
    if (selectedMode === 'findImagePlaces') {
      if (images.length === 0) return;
      const imageDataList = images
        .map((img) => img.base64)
        .filter((b64): b64 is string => Boolean(b64));
      if (imageDataList.length === 0) {
        Alert.alert('Error', 'No image data available.');
        return;
      }
      onSubmitImageScan?.(imageDataList, 'findImagePlaces');  // ← 新增 mode 参数
      return;
    }
    if (selectedMode === 'findTextPlaces') {
      // 原来的 imageScan 逻辑
      if (images.length === 0) return;
      // ... 保持不变
    }
    // ...
}, [...]); 
```

**d. 修改图片选择器的文字：**

```typescript
{selectedMode === 'findImagePlaces' ? (
  /* 单图选择 */
  <View style={styles.imagePickerArea}>
    {images.length > 0 ? (
      // ... 显示已选图片
    ) : (
      <TouchableOpacity style={styles.imagePickerButton} onPress={pickImages} activeOpacity={0.7}>
        <Ionicons name="images-outline" size={32} color={COLOR.primary} />
        <Text style={styles.imagePickerText}>Select 1 Image</Text>
      </TouchableOpacity>
    )}
  </View>
) : selectedMode === 'findTextPlaces' ? (
  /* 多图选择（原有逻辑） */
  // ...
) : (
  /* 文字输入模式 */
  // ...
)}
```

**e. 修改 `pickImages` 限制：**

```typescript
const pickImages = useCallback(async () => {
    const selectionLimit = selectedMode === 'findImagePlaces' ? 1 : 3;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: selectionLimit > 1,
      selectionLimit,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets.length > 0) {
      setImages(result.assets.slice(0, selectionLimit));
    }
}, [selectedMode]);
```

### 3.2 更新 apiService.ts

在 [`src/services/api/apiService.ts`](src/services/api/apiService.ts) 中新增：

```typescript
/**
 * Find image places — identify geographic location from an image.
 * Uses Google Cloud Vision + optional DeepSeek vision fallback.
 */
export async function findImagePlace(
  imageBase64: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  return postParseWithProgress('/find_image_places', { image: imageBase64 }, onProgress);
}
```

### 3.3 更新 importService.ts

在 [`src/services/import/importService.ts`](src/services/import/importService.ts) 中新增：

```typescript
/**
 * Identify a geographic place from an image.
 */
export async function findImagePlace(
  imageBase64: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiFindImagePlace(imageBase64, onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}
```

### 3.4 更新 HomePanel / 路由逻辑

在 [`src/features/home/HomePanel.tsx`](src/features/home/HomePanel.tsx)（或 HomeContext 涉及的 import 触发逻辑）中：

- 当前 `onSubmitImageScan` 接受 `(imagesBase64: string[])` 
- 需要改为 `(imagesBase64: string[], mode?: ImportMode)` 以区分 `findTextPlaces` 和 `findImagePlaces`
- 根据 mode 调用对应的 API

---

## 4. API 响应格式兼容

返回的 `ParseResponse` 已经是项目标准格式，前端 `SaveScreen` 无需改动即可展示。

**subtitle 字段**会按场景显示不同的置信度描述：

| 场景 | subtitle 示例 |
|------|--------------|
| 置信度 > 0.67 | `There is a 77.2% probability that this image is located at...` |
| DeepSeek 兜底成功 | `There is a high probability that the place in this image is... Happy exploring!` |
| 全部失败（fallback） | `After multiple rounds of searching, we are only 35.4% confident that the place in the image is at...` |

---

## 5. 实施步骤

| # | 步骤 | 文件 | 说明 |
|---|------|------|------|
| 1 | 新增后端服务 | `backend/services/find_image_places_service.py` | Google Cloud Vision + DeepSeek vision 逻辑 |
| 2 | 新增端点 | `backend/main.py` | `POST /find_image_places` |
| 3 | 更新 API 服务 | `src/services/api/apiService.ts` | 新增 `findImagePlace()` |
| 4 | 更新 import 服务 | `src/services/import/importService.ts` | 新增导出函数 |
| 5 | 重命名 Image Scan → Find Text Places | `src/features/import-places/import-screen/ImportScreen.tsx` | `ImportMode` + `modes` 数组 |
| 6 | 新增 Find Image Places UI | 同上 | 新的 mode 按钮 + 单图选择器 |
| 7 | 更新 HomePanel 路由 | `src/features/home/HomePanel.tsx` | 区分两种图片模式 |
| 8 | 更新 README Data Flow | `README.md` | 添加 Find Image Places 场景 |

---

## 6. 环境变量

新增到 `.env`：
```
GOOGLE_VISION_API_KEY=your_google_cloud_vision_api_key
```

在 [`backend/main.py`](backend/main.py) 中添加检查（可选）。
