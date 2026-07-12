# Image Scan 功能开发方案

## 架构设计

```
用户选择图片 (max 3) → 上传到后端
  ↓
GLM-OCR 识别每张图片的文字
  ↓
LLM 分析识别结果:
  ├─ 有清晰的 POI/地标名称 → 走 extraction_pipeline（Reddit 链路）
  └─ 仅精确地址（如 "123 Main St"）→ 走 atlas_discovery 链路
  ↓
返回解析结果 → SaveScreen 显示
```

## 后端改动

### 1. 新建: backend/services/image_scanner.py
- `scan_images(images: list[bytes]) → dict`
- 调用 GLM-OCR API 识别文字
- 调用 LLM 判断走哪条链路
- 调用对应 pipeline 处理

### 2. 新建: backend/services/glm_ocr.py
- GLM-OCR API 封装
- 支持 base64 图片输入

### 3. main.py 新增端点
- `POST /scan_images` — 接收图片文件列表

## 前端改动

### ImportScreen.tsx — Image Scan 模式
- 选择图片 (expo-image-picker)
- 最多 3 张
- 上传到后端
- 显示识别进度

## GLM 注册步骤
1. 访问 https://open.bigmodel.cn/
2. 注册账号
3. 创建 API Key
4. 添加到 .env: `GLM_API_KEY=xxx`
