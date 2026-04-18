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

- Pending runtime checks

## Next Steps

1. Check deployed `/api/health` and `/api/config`.
2. Verify current frontend ASR flow conditions.
3. Decide whether instrumentation is needed.
