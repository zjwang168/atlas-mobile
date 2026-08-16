# Atlas 三条核心业务时序

本文提供三个可以直接在 Mermaid 编辑器中渲染的 `sequenceDiagram`，分别描述：

1. **Add Places**：从导入内容得到候选地点，用户审核后保存到 My Places。
2. **Create an Atlas**：用户从导航栏进入 `AtlasBuilder`，搜索/选择地点、排序并保存普通 Atlas。
3. **AI Chat**：Atlas AI 的流式聊天、后端工具调用、待确认 proposal，以及用户确认后实际创建 Atlas 的路径。

前两张图强调传统前后端和数据服务；第三张图只在需要的地方显示 AI 模块，完整工具目录放在文档末尾。图中的 `Supabase` 表示 Supabase Auth + PostgreSQL/RLS，`Mapbox` 表示 Search Box/Geocoding/Directions 以及移动端 Mapbox SDK，`FastAPI` 表示 `backend/main.py`。

---

## 1. Add Places：Import → Review → Save

这是 review-first 流程：解析成功不会自动写入 My Places。用户必须在 `SaveScreen` 勾选地点并点击 Save；已存在的地点会被 `isSamePlace()` 识别为 duplicate，而不是再插入一行。输入可以是普通文本、URL、社交视频、网页截图或照片；下图用“URL/文本/图片”表示共同的客户端入口，具体 source-specific endpoint 在 FastAPI 内部分支。

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App as Expo App / App.tsx
    participant Import as importService.ts
    participant APIClient as apiService.ts
    participant API as FastAPI / backend.main
    participant Graph as AtlasApp LangGraph
    participant Pipeline as AgentOrchestrator + parsers
    participant Providers as Web / Social / OCR / Vision / LLM
    participant Geo as Geocoder + Route planner
    participant Progress as Progress registry
    participant Save as SaveScreen
    participant Place as placeService.ts
    participant Cache as AsyncStorage + LocalStore
    participant Queue as syncQueue.ts
    participant DB as Supabase places + place_sources
    participant Map as Shared Mapbox workspace

    User->>App: Select import mode and submit URL, text, video, screenshot, or photo
    App->>App: Open AnalyzingScreen and create request_id
    App->>Import: parseInput() / parseLink() / parseText()
    Import->>APIClient: POST parse request with request_id
    APIClient->>API: Authorization: Bearer Supabase access token
    API->>Progress: start(request_id)
    API->>Graph: ainvoke({task_type, input, request_id})
    Graph->>Graph: dispatch to parse_link, parse_text, scan_url, social parser, or image parser
    Graph->>Pipeline: Run source-specific extraction path

    alt URL or social source
        Pipeline->>Providers: Fetch page/video/metadata/transcript
        Providers-->>Pipeline: Source text, title, captions, or media metadata
    else Screenshot or photo
        Pipeline->>Providers: Capture page / OCR image / identify visible places
        Providers-->>Pipeline: OCR text or candidate place references
    else Plain text
        Pipeline->>Pipeline: Classify address_first vs named_poi
    end

    Pipeline->>Providers: Extract candidate place names and inferred region
    Providers-->>Pipeline: Candidate locations, removed noise, hierarchy hints
    Pipeline->>Pipeline: Deduplicate names and decide whether entity linking is needed
    Pipeline->>Geo: Batch geocode unique place/context queries
    Geo-->>Pipeline: Coordinates, full addresses, confidence, provider metadata
    Pipeline->>Pipeline: Reject wrong-region results and preserve removed_noise
    Pipeline->>Geo: Plan route for resolved locations
    Geo-->>Pipeline: Ordered locations and route segments
    Pipeline->>Providers: Enrich missing photos (cached where possible)
    Providers-->>Pipeline: photo_url or fallback thumbnail
    Pipeline-->>Graph: ParseResponse {title, locations, route, source_type}
    Graph-->>API: Return result and session fields
    API->>Progress: mark extraction/geocode stages and finish(request_id)
    API-->>APIClient: JSON ParseResponse
    APIClient-->>Import: Adapt backend locations to ParseResult / stable keys
    Import-->>App: Resolve parse promise
    App->>Save: Show SaveScreen with candidate pins and selection state
    Save->>Map: Render temporary candidate markers and map center

    alt User cancels while parsing
        User->>App: Tap Cancel
        App->>APIClient: cancelParseRequest(request_id)
        APIClient->>API: POST /parse_progress/{request_id}/cancel
        API->>Progress: mark cancelled and task.cancel() when registered
        Progress-->>Pipeline: Cooperative cancellation signal
        API-->>APIClient: {cancelled: true/false}
        App->>App: Return to ImportScreen, do not save candidates
    else User closes analysis UI but keeps task running
        User->>App: Dismiss analysis overlay
        App->>App: Keep request alive in background
        API-->>App: Completion is surfaced by Expo notification when enabled
    else User reviews and saves
        User->>Save: Toggle places and tap Save places
        Save->>App: onSave(selectedIds)
        App->>App: Filter selected ParseResult places
        App->>Place: savePlaces(selected, {source, sourceUrl})
        Place->>Cache: Read current user cache and stable-place index
        Cache-->>Place: Existing optimistic/read-model places
        Place->>Place: isSamePlace() using provider id or name + coordinate threshold
        alt All selected places are duplicates
            Place-->>App: {inserted: [], duplicates: [...]}
        else Some places are new
            Place->>Cache: Optimistically add local rows and notify listeners
            Cache-->>Map: Shared map/My Places update immediately
            Place->>DB: Insert new places and place_sources with authenticated user context
            alt Remote write succeeds
                DB-->>Place: Inserted rows / authoritative ids
                Place->>Cache: Replace local ids with remote rows
            else Retryable network/database failure
                Place->>Queue: enqueueWrite(savePlaces, localRows, source)
                Queue-->>Place: Queued for later flush
                Place-->>App: Local success with pending sync
            else Non-retryable failure
                Place->>Cache: Keep or roll back according to write path
                Place-->>App: Save error / warning
            end
            Place-->>App: {inserted: [...], duplicates: [...]}
        end
        App->>Map: Update shared pins and saved state
        App->>App: Optionally create import chat welcome / history record
        App-->>User: Show saved/duplicate/deselected outcome
    end
```

### Add Places 图中必须保留的语义

- **解析和保存是两个阶段**：`ParseResponse` 只是临时结果；真正的 `places` 持久化从 `savePlaces()` 开始。
- **用户选择是授权点**：未勾选的候选不会进入 My Places；duplicate 不应被画成新的数据库 insert。
- **缓存不是数据库**：`AsyncStorage`/`LocalStore` 的乐观状态可以先更新地图，但同步队列或远端写入才决定最终服务器状态。
- **取消有两种结果**：明确 Cancel 调用后端 progress cancel；关闭分析界面则可能让后台导入继续。

---

## 2. Create an Atlas：导航栏普通编辑器

这张图描述的是 `MyPlan → AtlasBuilder` 的普通创建，不是 Chat proposal。AI Discover 只作为可选的候选推荐来源；它不会替用户提交 Atlas，也不拥有 Supabase 写权限。编辑器同时支持已保存 My Places、Mapbox Search、附近 landmark seeds 和手动添加的 Atlas-owned place。

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Nav as Top navigation / MyPlan
    participant Builder as AtlasBuilder.tsx
    participant Home as HomeContext + shared Mapbox map
    participant PlaceSvc as placeSearchService / placeService
    participant APIClient as apiService.ts
    participant API as FastAPI
    participant Discover as Optional /atlas_ai/discover
    participant Mapbox as Mapbox Search / Geocoding / Directions
    participant AtlasSvc as atlasService.ts
    participant AtlasPlaces as atlasPlacesService.ts
    participant Local as LocalStore + optimistic cache
    participant Queue as syncQueue.ts
    participant DB as Supabase atlases + atlas_places

    User->>Nav: Tap Create Atlas in navigation bar
    Nav->>Builder: Mount blank AtlasBuilder
    Builder->>Home: Set create mode, camera target, panel state
    Home->>Home: Keep shared Mapbox map alive beneath editor
    Builder->>Mapbox: Geocode selected country/region or current focus area
    Mapbox-->>Builder: Center, bounds, label
    Builder->>Home: Move camera after Mapbox idle / preserve map state

    opt Add an existing saved place
        User->>Builder: Select place from My Places
        Builder->>PlaceSvc: Read saved places / stable identity
        PlaceSvc-->>Builder: SavedPlace candidate
        Builder->>Builder: Add DraftPlace to local ordered items
        Builder->>Home: Render selected Atlas marker and order number
    end

    opt Search for a place
        User->>Builder: Type a place query
        Builder->>Builder: Debounce query and abort previous request
        Builder->>PlaceSvc: Search Box suggest(query, proximity/bbox)
        PlaceSvc->>Mapbox: Search Box suggest
        Mapbox-->>PlaceSvc: Suggestions without final coordinates
        PlaceSvc-->>Builder: SearchResult list
        User->>Builder: Choose a suggestion
        Builder->>PlaceSvc: Retrieve selected external_id
        PlaceSvc->>Mapbox: Search Box retrieve(external_id)
        Mapbox-->>PlaceSvc: Resolved place and coordinates
        PlaceSvc-->>Builder: DraftPlace / provider identity
        Builder->>Builder: Reject stale, out-of-focus, or duplicate result
        Builder->>Home: Render candidate or selected marker
    end

    opt Ask for recommendations
        User->>Builder: Request nearby or focus-area recommendations
        Builder->>Mapbox: Get landmark seeds or geocode focus area
        Mapbox-->>Builder: Fast local seeds / focus bounds
        Builder->>APIClient: discoverAtlasPlaces(query, sessionId, excludedNames)
        APIClient->>API: POST /atlas_ai/discover
        API->>Discover: Translate query and add bounded session context
        Discover->>Discover: Research candidate real places
        Discover->>Mapbox: Resolve candidate names to coordinates
        Mapbox-->>Discover: Geocoded candidates
        Discover-->>API: ParseResponse with locations and provisional metadata
        API-->>APIClient: Recommendations
        APIClient-->>Builder: Candidate DraftPlace list
        Builder->>Builder: Up to three fill attempts, local name/radius/bounds filtering
        Builder->>Home: Render green recommendation markers
        User->>Builder: Accept or dismiss individual recommendations
        Builder->>Builder: Move accepted candidates into ordered items
    end

    loop Edit the local Atlas draft
        User->>Builder: Reorder, remove, insert, edit title, note, time, or transport
        Builder->>Builder: Update local items and sort_order
        Builder->>Home: Keep markers and order synchronized
        opt Request route for current ordered items
            Builder->>APIClient: requestAtlasRoute(coordinates)
            APIClient->>API: POST /atlas/route
            API->>Mapbox: Directions walking route (2..25 coordinates)
            Mapbox-->>API: GeoJSON geometry, distance, duration
            API-->>APIClient: AtlasRouteResponse
            APIClient-->>Builder: route
            Builder->>Home: Render route without changing user camera
        end
    end

    User->>Builder: Tap finish/save Atlas
    Builder->>Builder: Snapshot title, ordered items, camera, route, schedule metadata
    alt Creating a new Atlas
        Builder->>AtlasSvc: createAtlas(title)
        AtlasSvc->>Local: Optimistically add Atlas row
        AtlasSvc->>DB: Insert atlas with authenticated owner
        alt Insert succeeds
            DB-->>AtlasSvc: Atlas id
        else Retryable failure
            AtlasSvc->>Queue: enqueueWrite(createAtlas, local row)
            Queue-->>AtlasSvc: Keep local Atlas pending sync
        else Failure
            AtlasSvc-->>Builder: Cannot create Atlas
        end
    else Editing an existing Atlas
        Builder->>AtlasSvc: Reuse existing atlas id
    end

    Builder->>Home: onSaved(atlasId, savedMapView) before waiting for all remote rows
    alt Existing Atlas rows can be patched in place
        Builder->>AtlasPlaces: updateAtlasPlaces(order, note, time, transport)
        AtlasPlaces->>Local: Optimistic row/order update
        AtlasPlaces->>DB: Update atlas_places rows
    else New saved and Atlas-owned items exist
        par Add rows originating in My Places
            Builder->>AtlasPlaces: addPlacesToAtlas(atlasId, placeIds, snapshots)
            AtlasPlaces->>DB: Insert atlas_places references
        and Add searched/recommended owned items
            Builder->>AtlasPlaces: addAtlasOwnedPlaces(atlasId, ownedPlaceInputs)
            AtlasPlaces->>DB: Insert atlas-owned place fields
        end
        AtlasPlaces-->>Builder: Join row ids
        Builder->>AtlasPlaces: updateAtlasPlaces(final order and metadata)
        AtlasPlaces->>DB: Patch sort_order/timeline/note
    end
    Builder->>AtlasSvc: updateAtlas(title, route_geojson, route_visible)
    AtlasSvc->>DB: Persist Atlas metadata and route
    AtlasSvc-->>Builder: Save result
    Builder->>Home: Preserve exact saved map view and orange Atlas pins
    Builder-->>User: Close editor or open Atlas detail

    alt Save/network error
        Builder->>Builder: Show “Atlas was not saved” warning
        Builder->>Local: Preserve/inspect optimistic draft according to service result
        User->>Builder: Retry later or continue editing
    end
```

### Create Atlas 图中必须保留的语义

- `AtlasBuilder` 是状态拥有者；模型不是创建者。`/atlas_ai/discover` 只返回建议地点。
- 创建和保存可先更新本地地图/缓存，之后写 `atlases` 和 `atlas_places`；地图不应等待所有远端订阅重新 hydrate 才显示完成状态。
- `AtlasPlace` 可以引用一个 My Places row，也可以携带 Atlas-owned 的地点字段，因此“加入 Atlas”不一定等于“先保存到 My Places”。
- route 是 Atlas 的派生展示数据；Mapbox Directions 失败不会凭空生成路线。

---

## 3. AI Chat：流式对话、工具调用和确认写入

这张图只展示 Chat 作为产品流程的外部行为。后端 `chat_agent.py` 内部最多 6 个模型步骤、20 条消息上下文和 90 秒总 deadline 的细节，可参考前一份 LLM 架构文档；本图重点是跨越移动端、FastAPI、外部检索和用户确认的数据边界。

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant ChatUI as AIChatBox.tsx
    participant APIClient as apiService.ts
    participant API as FastAPI /chat/stream
    participant Graph as AtlasApp LangGraph chat node
    participant Agent as chat_agent._run_agent
    participant Model as Atlas AI model + web_search
    participant Tools as Atlas tools / Mapbox / web research
    participant Session as ConversationManager + Session
    participant DB as Supabase conversations
    participant Domain as Mobile Atlas/Place domain services
    participant Map as Shared Mapbox workspace

    User->>ChatUI: Open Atlas AI and type text or attach image
    ChatUI->>ChatUI: Build message row, status state, AbortController
    ChatUI->>ChatUI: ensureSession() or restore conversation/session
    ChatUI->>APIClient: chatWithAtlasStream(sessionId, message, location, specialPlaces, image)
    APIClient->>API: POST /chat/stream with Bearer JWT
    API->>Session: Recover in-memory session or load conversation
    API->>Session: Attach current user location and saved special places for this request
    API->>Graph: ainvoke(task_type=chat, thread_id=sessionId)
    Graph->>Agent: run stream_chat() / _run_agent()
    Agent->>Session: Read bounded recent context and current map/pending state
    Agent-->>API: status “Understanding your request”
    API-->>APIClient: NDJSON status event
    APIClient-->>ChatUI: Render safe agent status

    alt Image message
        Agent->>Agent: Run image recognition branch
        Agent->>Tools: Inspect visible text/scene and resolve map places
        Tools-->>Agent: Verified locations or structured error
    else Explicit place save shortcut
        Agent->>Tools: Resolve explicit place names in parallel
        Tools-->>Agent: Resolved places and unresolved names
        Agent->>Session: Create save_places or create_atlas pending_action
    else Normal model/tool loop
        loop Up to MAX_AGENT_STEPS or until proposal/final answer
            Agent->>Model: ainvoke(system prompt + recent history + tool messages)
            Model-->>Agent: Final text or one/multiple tool calls
            alt No tool calls
                Agent->>Agent: Accept model text as response
            else Tool calls returned
                Agent->>Agent: Check tool name against _agent_tools whitelist
                alt Unsupported tool name
                    Agent->>Agent: Create {error: Unsupported tool}
                else Supported tool
                    Agent->>Tools: Execute tool with validated arguments
                    alt Tool succeeds
                        Tools-->>Agent: JSON result with locations/route/proposal/presentation
                    else Tool fails or upstream unavailable
                        Tools-->>Agent: Structured {error: tool failed}
                    end
                end
                Agent->>Agent: Append ToolMessage and result to next prompt
                Agent-->>API: Safe status label for tool activity
                API-->>APIClient: NDJSON status event
                APIClient-->>ChatUI: Update status without exposing arguments/reasoning
            end
            alt propose_create_atlas or research_screen_locations returns proposal
                Agent->>Agent: Stop loop, proposal is user-visible completion state
            else Six steps exhausted without safe result
                Agent->>Agent: Return partial/max-steps response or narrow-request message
            end
        end
    end

    alt Timeout at 90 seconds
        Agent-->>API: {status: timeout, partial: true}
        API-->>APIClient: complete/error-compatible response
        APIClient-->>ChatUI: Show retry message, do not attach stale card
    else Agent exception
        Agent-->>API: {status: error, partial: true}
        API-->>APIClient: NDJSON error event
        APIClient-->>ChatUI: Show local retry text
    else Successful text/presentation/proposal
        Agent->>Session: Add assistant message, tool_calls, tool_results, presentation
        Agent->>Session: Save conversation/history asynchronously or at turn end
        Session->>DB: Persist conversations/messages/locations using request JWT
        DB-->>Session: Conversation id / persistence result
        Agent-->>API: Final response, locations, route, pending_actions, metrics
        API-->>APIClient: token chunks (36 chars) then complete payload
        APIClient-->>ChatUI: Render text, map presentation and pending action card
        ChatUI->>Map: Render nearby/places/Atlas draft presentation
    end

    alt User taps Stop while stream is pending
        User->>ChatUI: Cancel current response
        ChatUI->>APIClient: AbortController.abort()
        APIClient-->>ChatUI: Stop local token queue and mark request inactive
        ChatUI->>ChatUI: Ignore any late complete payload from old request
        Note over API,Agent: Server/provider work may still finish, Chat Stop is not a guaranteed provider kill switch
    else No pending action
        ChatUI-->>User: Continue normal conversation
    else User rejects proposal
        User->>ChatUI: Tap Cancel on action card
        ChatUI->>APIClient: confirmAtlasChatAction(accepted=false)
        APIClient->>API: POST /chat/actions/confirm
        API->>Session: Record rejection audit event and clear action
        Session->>DB: Persist confirmation event
        API-->>ChatUI: {status: recorded}
        ChatUI->>ChatUI: Remove action card, no domain write
    else User accepts save places proposal
        User->>ChatUI: Tap Save
        ChatUI->>Domain: savePlaces(action.places)
        Domain->>Domain: Deduplicate and optimistically update cache
        Domain->>DB: Insert My Places / source rows or enqueue retry
        DB-->>Domain: Saved rows or failure
        ChatUI->>APIClient: confirmAtlasChatAction(accepted=true, outcome)
        APIClient->>API: POST /chat/actions/confirm
        API->>Session: Record acceptance and clear pending action
        Session->>DB: Persist audit event
    else User accepts special-place proposal
        User->>ChatUI: Tap Save Home/Office/School
        ChatUI->>Domain: Save or delete special place in My Places
        Domain->>DB: Authenticated place write
        ChatUI->>APIClient: confirmAtlasChatAction(accepted=true)
        API->>Session: Mirror accepted special place in active session
    else User accepts create_atlas proposal
        User->>ChatUI: Tap Create on Atlas draft card
        ChatUI->>Domain: createAtlas(action.title)
        Domain->>DB: Insert atlas row
        DB-->>Domain: atlas.id
        ChatUI->>Domain: addAtlasOwnedPlaces(atlas.id, action.places)
        Domain->>DB: Insert ordered atlas_places and schedule metadata
        DB-->>Domain: Atlas place rows
        opt Photo backfill
            ChatUI->>Domain: queueAtlasPlacePhotoBackfill(rows)
        end
        ChatUI->>APIClient: confirmAtlasChatAction(accepted=true, created_atlas_id)
        APIClient->>API: POST /chat/actions/confirm
        API->>Session: Record accepted action and clear pending proposal
        Session->>DB: Persist audit event
        ChatUI->>Map: Open Atlas detail and close Chat overlay
    end

    alt Domain write fails after user acceptance
        Domain-->>ChatUI: Error
        ChatUI-->>User: “We could not apply this change”, do not record successful confirmation
        ChatUI->>ChatUI: Keep proposal actionable for retry
    end
```

### AI Chat 图中必须保留的语义

- `/chat/stream` 的输出是安全 status、完成后的 token chunks 和 complete payload；原始 tool arguments、web query 和隐藏 reasoning 不发给 UI。
- Chat 的模型循环可以返回地图 presentation 和 pending action，但**不能直接写 Atlas 或 My Places**。
- `POST /chat/actions/confirm` 是审计/状态同步接口；实际 Atlas/places 写入由移动端领域服务完成。
- 客户端 Stop 防止旧结果污染当前 UI，但不能保证已经发出的 provider 请求在服务器端立即停止。
- 超时、异常、工具错误和没有安全结果都应保留 `partial/error/timeout` 语义，不应显示成“已创建”。

---

## 4. Atlas AI Chat 的全部 Tool Calling 清单

下面列出当前 `backend/langgraph/chat_agent.py:_agent_tools()` 注册的全部 LangChain tools。托管的 `web_search` 是模型 provider 的额外工具，不是本地 `@tool` 函数，也一并列出。模型可以请求工具，但所有写入型操作只生成 proposal；真正写入必须经移动端用户确认。

| Tool | 类型 | 作用与主要下游 | 成功结果 / 写入边界 |
|---|---|---|---|
| `resolve_special_place` | 地点解析 | 用 Mapbox Search Box `suggest` + 并发 `retrieve`，失败时 fallback 到 address-first geocoder；解析 Home、Office 或 School | 返回精确、可验证地点；不写数据库 |
| `propose_special_place_change` | 确认提案 | 校验地点必须来自同一轮 `resolve_special_place`，处理 special place create/update/delete | 返回 `save_special_place` 或 `delete_special_place` pending action；不写数据库 |
| `find_places_between_special_places` | 空间搜索 | 取两个已保存 special places 的中点，用 Mapbox 搜索类别地点，并生成锚点路线 | 返回 places、anchors、route 和地图 presentation；不写数据库 |
| `find_nearby_places` | 附近搜索 | 以设备 GPS、命名 anchor 或 Home/Office/School 为中心；多类别并发 suggest/retrieve，按半径过滤、去重、排序 | 返回 nearby places、route、presentation；不写数据库 |
| `find_verified_places` | 实时研究 | 针对评分、价格、菜单、饮食、营业状态、通勤等约束做有限 web research，再用 Mapbox 解析候选 | 返回已研究候选和可选路线；不把未经验证的属性写成事实 |
| `find_similar_places` | 相似地点研究 | 区分 local venue 与 destination，按区域/全球范围研究相似场所，再 geocode 候选 | 返回最多受限数量的相似地点；不写数据库 |
| `present_response_places` | 地图呈现 | 把回答中明确的真实 POI 名称解析为可地图化地点；禁止用于城市、国家或泛类别 | 返回普通可选地图 cards/presentation；不写数据库 |
| `extract_pasted_places` | 文本抽取 | 调用 paste-text 的抽取、实体链接和 geocode 路径，处理用户粘贴的行程/笔记 | 返回标准化地点候选；通常需后续 proposal 才能保存 |
| `research_screen_locations` | 影视取景研究 | 对电影、电视或音乐视频的取景地做 Paste Text live research + geocoding | 自己生成一个 Atlas confirmation proposal；不应再次调用 `propose_create_atlas` |
| `propose_add_places` | 保存地点提案 | 标准化、去重用户要求加入 My Places 的地点 | 返回 `save_places` pending action；需客户端确认后由 `savePlaces()` 写入 |
| `propose_create_atlas` | Atlas 提案 | 接收完整、有序、已 geocode 的 itinerary，包含 title、timeline day/time、transport、duration metadata | 返回 `create_atlas` pending action 和 `atlas_draft` presentation；不直接创建 Atlas |
| `web_search` | Provider-hosted tool | OpenAI Responses API 的实时网页搜索，供当前事实和精确地点研究使用 | 搜索结果作为模型工具消息；UI 只看到安全状态，不看到 query；不直接写数据库 |

### 工具调用的共同错误语义

1. 工具名先经过 `_agent_tools()` 白名单；不支持的名称会被转换成 `Unsupported tool` error，不会执行任意函数。
2. 已注册工具抛出的异常会转换成结构化 tool error，再回送给模型；模型可以换工具、缩小请求或结束回答。
3. 工具结果为空、候选无法 geocode、区域不匹配或外部 provider 超时，都不能自动变成已保存地点。
4. 模型循环最多 6 个步骤、总计 90 秒；proposal 形成后立即结束循环。耗尽步骤、超时或异常时返回 partial/error/timeout，而不是无限调用。
5. `pending_action` 不是持久化成功标志。只有 `AIChatBox` 在用户点击确认后调用 `savePlaces()`、`createAtlas()`、`addAtlasOwnedPlaces()` 或 special-place domain service，才会产生真实数据写入；`/chat/actions/confirm` 随后记录审计事实。
