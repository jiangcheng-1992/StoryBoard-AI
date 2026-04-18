# [OPEN] ASR Lyrics Missing

## Session

- Session ID: `asr-lyrics-missing`
- Started: 2026-04-18
- Symptom: Render 线上站点生成分镜后没有识别出台词

## Hypotheses

1. Render 服务端未正确加载 `ASR_API_KEY`，前端因此自动跳过语音识别。
2. `ASR_API_KEY` 已加载，但调用豆包 ASR 接口时鉴权或资源 ID 配置不正确，导致接口失败。
3. 线上视频音频提取在浏览器端失败，`audioBase64` 为空，因此根本没有发起 ASR 请求。
4. ASR 接口返回成功，但返回结果为空或格式与 `parseASRResponse()` 预期不一致。
5. ASR 已有结果，但 `matchASRToFrames()` 没有把语音片段正确映射到抽帧时间段。

## Evidence Log

- `GET https://storyboard-ai-hrtp.onrender.com/api/health` => `{"ok":true,"visionConfigured":true,"asrConfigured":true}`
- `GET https://storyboard-ai-hrtp.onrender.com/api/config` => `{"asrEnabled":true,"visionEnabled":true}`
- Hypothesis 1 rejected: 线上服务端已加载 ASR 配置，前端不会因为配置缺失而自动跳过。
- Static evidence points to remaining likely causes:
  - Hypothesis 2: upstream ASR rejects request.
  - Hypothesis 3: browser-side audio extraction fails before `/api/asr`.
  - Hypothesis 4: ASR payload shape/text empty.
  - Hypothesis 5: frame matching drops valid ASR output.
- Added temporary instrumentation endpoints in `server.js` and frontend ASR instrumentation in `index.html` gated by `?debugAsr=1`.
- Runtime evidence from `/api/debug/asr/logs`:
  - `startAnalysis entered` => `asrEnabled: true`, `videoType: file`
  - `audio extraction succeeded` => `sampleRate: 16000`, `seconds: 15.1`, `base64Length: 643036`
  - `frontend is sending audio to /api/asr` => request was actually issued
  - `ASR request received` => backend received audio payload
  - `ASR rejected by upstream headers` => `45000010 Invalid X-Api-Key`
  - `ASR promise rejected` => frontend surfaced `语音识别失败: 45000010: Invalid X-Api-Key`
- Hypothesis 2 confirmed: current Render `ASR_API_KEY` is invalid for the upstream ASR service.
- Hypothesis 3 rejected: browser audio extraction succeeded.
- Hypothesis 4 rejected for this run: upstream rejected before a valid ASR payload was returned.
- Hypothesis 5 rejected for this run: mapping never ran because ASR failed earlier.

## Next Steps

1. Replace Render `ASR_API_KEY` with a valid Doubao/Volcengine speech API key.
2. Redeploy and reproduce again.
3. If needed, compare new logs against the current failure (`45000010 Invalid X-Api-Key`).
