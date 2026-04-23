# [OPEN] AI No Return

## Session

- Session ID: `ai-no-return`
- Started: 2026-04-18
- Symptom: Render 线上站点显示“AI未返回，请重试”

## Hypotheses

1. `ARK_API_KEY` 已加载，但视觉模型鉴权无效或额度异常，导致 `/api/ai/frames` 失败。
2. 服务端成功请求了视觉模型，但返回体里没有 `choices[0].message.content`，前端只能回退成 “AI未返回”。
3. 前端向 `/api/ai/frames` 发送的 `frames` 为空、过大或格式异常，导致后端拒绝或上游失败。
4. 视觉模型返回内容存在，但 `parseAIResponse()` 解析 JSON/整体描述失败，所以每个分镜都降级成“AI未返回，请重试”。
5. Render 部署版本不是本地最新代码，线上仍跑着旧逻辑。

## Evidence Log

- Pending runtime checks

## Next Steps

1. Check deployed `/api/health`.
2. Inspect current `/api/ai/frames` handling in deployed codebase.
3. Add minimal instrumentation for AI request/response path if needed.
