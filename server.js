const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const INDEX_FILE = path.join(ROOT_DIR, "index.html");

const ARK_API_KEY = process.env.ARK_API_KEY || "";
const ARK_API_ENDPOINT =
  process.env.ARK_API_ENDPOINT ||
  "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const ARK_MODEL = process.env.ARK_MODEL || "doubao-1-5-vision-pro-32k-250115";

const ASR_API_KEY = process.env.ASR_API_KEY || "";
const ASR_API_URL =
  process.env.ASR_API_URL ||
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const ASR_RESOURCE_ID =
  process.env.ASR_RESOURCE_ID || "volc.bigasr.auc_turbo";

const MAX_JSON_BODY = process.env.MAX_JSON_BODY || "200mb";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120000);
const ASR_DEBUG_SESSION = "asr-lyrics-missing";
const asrDebugEvents = [];
const AI_DEBUG_SESSION = "ai-no-return";
const aiDebugEvents = [];

app.disable("x-powered-by");
app.use(express.json({ limit: MAX_JSON_BODY }));

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function jsonError(res, status, message, details) {
  res.status(status).json({
    error: message,
    details: details || null,
  });
}

function extractVideoId(url) {
  let m = url.match(/modal_id=(\d{15,25})/);
  if (m) return m[1];

  m = url.match(/\/video\/(\d{15,25})/);
  if (m) return m[1];

  m = url.match(/\/note\/(\d{15,25})/);
  if (m) return m[1];

  m = url.match(/^(\d{15,25})$/);
  if (m) return m[1];

  return null;
}

function isDirectVideo(url) {
  return /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url) || /mime_type=video/i.test(url);
}

function isDouyinUrl(url) {
  return /douyin\.com/i.test(url) || /v\.douyin\.com/i.test(url) || /iesdouyin\.com/i.test(url);
}

function deepFindKey(obj, key) {
  if (!obj || typeof obj !== "object") return null;
  if (obj[key]) return obj[key];
  for (const currentKey of Object.keys(obj)) {
    const found = deepFindKey(obj[currentKey], key);
    if (found) return found;
  }
  return null;
}

function getMediaProxyUrl(req, targetUrl) {
  return `${req.protocol}://${req.get("host")}/api/media/proxy?url=${encodeURIComponent(
    targetUrl
  )}`;
}

async function fetchText(url, extraOptions = {}) {
  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: timeout.signal,
      ...extraOptions,
    });
    return {
      response,
      text: await response.text(),
    };
  } finally {
    timeout.clear();
  }
}

async function resolveShortUrl(url) {
  const { response, text } = await fetchText(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const redirectMatch = text.match(/href="(https:\/\/www\.douyin\.com\/video\/\d+[^"]*)"/);
  if (redirectMatch) return redirectMatch[1];

  const finalUrl = response.url || url;
  const videoId = extractVideoId(finalUrl) || extractVideoId(text);
  return videoId ? `https://www.douyin.com/video/${videoId}` : finalUrl;
}

async function fetchDouyinVideoUrl(videoId) {
  const pageUrl = `https://www.douyin.com/video/${videoId}`;
  const { response, text: html } = await fetchText(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      Referer: "https://www.douyin.com/",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`抖音页面请求失败(${response.status})`);
  }

  const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (routerMatch) {
    try {
      const routerData = JSON.parse(routerMatch[1]);
      const pageKey = Object.keys(routerData.loaderData || {}).find(
        (key) => key.startsWith("video_") || key.includes("page")
      );
      if (pageKey) {
        const items = routerData.loaderData[pageKey]?.videoInfoRes?.item_list;
        if (items && items.length > 0) {
          const playAddr = items[0]?.video?.play_addr;
          if (playAddr?.url_list?.length) {
            return {
              url: playAddr.url_list[0].replace("playwm", "play"),
              desc: items[0].desc || "",
            };
          }
        }
      }
    } catch (error) {
      console.warn("Failed to parse router data:", error.message);
    }
  }

  let renderMatch = html.match(/window\._RENDER_DATA_\s*=\s*'([^']+)'/);
  if (!renderMatch) {
    renderMatch = html.match(/window\.__RENDER_DATA__\s*=\s*'([^']+)'/);
  }

  if (renderMatch) {
    try {
      const decoded = decodeURIComponent(renderMatch[1]);
      const renderData = JSON.parse(decoded);
      const found = deepFindKey(renderData, "play_addr");
      if (found?.url_list?.length) {
        return {
          url: found.url_list[0].replace("playwm", "play"),
          desc: "",
        };
      }
    } catch (error) {
      console.warn("Failed to parse render data:", error.message);
    }
  }

  let videoMatch = html.match(/"url_list":\["(https?:[^"]+\.mp4[^"]*)"/);
  if (!videoMatch) {
    videoMatch = html.match(/play_addr[^}]*url_list[^]]*\["(https?:[^"]+)"/);
  }

  if (videoMatch) {
    return {
      url: videoMatch[1]
        .replace(/\\u002F/g, "/")
        .replace(/\\\//g, "/")
        .replace("playwm", "play"),
      desc: "",
    };
  }

  return null;
}

function buildVisionPrompt(frames) {
  const systemPrompt =
    "你是专业的影视分镜师和即梦AI提示词专家。用户会发送一组视频关键帧截图，请你：\n\n" +
    "1. 【整体描述】用一段话描述这个视频的：画面风格、场景环境、核心角色（外貌/服装/特征）、整体氛围和色调\n" +
    "2. 【逐镜分镜脚本】对每一帧按以下JSON格式输出：\n" +
    "```json\n[\n  {\n    \"shot\": 1,\n    \"time\": \"0:00-0:03\",\n    \"景别\": \"极近景/近景/中景/中远景/远景/大远景\",\n" +
    "    \"运镜\": \"具体的镜头运动描述（推/拉/摇/移/跟/固定/环绕/升降等+方向+速度）\",\n" +
    "    \"画面内容\": \"这一帧画面中具体看到了什么（人物姿态、表情、物体、环境细节）\",\n" +
    "    \"人物动作\": \"角色在做什么动作\",\n" +
    "    \"情绪氛围\": \"这一帧的情绪感受\",\n" +
    "    \"旁白台词\": \"仅当画面中有可见的字幕文字、标题文字、字幕条时如实转录；没有可见文字则填空字符串（语音台词已由专用ASR模块处理，切勿根据画面猜测对话内容）\",\n" +
    "    \"即梦prompt\": \"可直接用于即梦AI的完整提示词（中文，包含主体+动作+场景+运镜+风格）\"\n  }\n]\n```\n\n" +
    "要求：\n- 画面内容必须精确描述你在每帧图片中看到的真实内容，不要编造\n- 运镜要从帧与帧之间的视角变化来推断\n- 旁白台词：仔细观察画面中是否有字幕文字或角色说话的迹象，有则如实写出，没有则留空字符串\n- 即梦prompt要具体、可执行，直接复制到即梦就能用\n- 先输出【整体描述】，用\"---SPLIT---\"分隔，再输出JSON数组";

  const content = [
    {
      type: "text",
      text: `这是一个视频的${frames.length}个关键帧截图（按时间顺序），请分析并生成分镜脚本。特别注意识别画面中的字幕文字、旁白和角色台词：`,
    },
  ];

  for (const frame of frames) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${frame.base64}`,
        detail: "low",
      },
    });
    content.push({
      type: "text",
      text: `[第${frame.index + 1}帧 ${frame.timeLabel}]`,
    });
  }

  return {
    model: ARK_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content },
    ],
    max_tokens: 8000,
    temperature: 0.3,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    visionConfigured: Boolean(ARK_API_KEY),
    asrConfigured: Boolean(ASR_API_KEY),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    asrEnabled: Boolean(ASR_API_KEY),
    visionEnabled: Boolean(ARK_API_KEY),
  });
});

app.post("/api/debug/ai/event", (req, res) => {
  const event = req.body || {};
  if (event.sessionId !== AI_DEBUG_SESSION) {
    return jsonError(res, 400, "无效的调试会话");
  }
  aiDebugEvents.push({
    ts: Date.now(),
    ...event,
  });
  if (aiDebugEvents.length > 200) {
    aiDebugEvents.shift();
  }
  res.json({ ok: true });
});

app.get("/api/debug/ai/logs", (_req, res) => {
  res.json({
    sessionId: AI_DEBUG_SESSION,
    count: aiDebugEvents.length,
    events: aiDebugEvents,
  });
});

app.post("/api/debug/asr/event", (req, res) => {
  const event = req.body || {};
  if (event.sessionId !== ASR_DEBUG_SESSION) {
    return jsonError(res, 400, "无效的调试会话");
  }
  asrDebugEvents.push({
    ts: Date.now(),
    ...event,
  });
  if (asrDebugEvents.length > 200) {
    asrDebugEvents.shift();
  }
  res.json({ ok: true });
});

app.get("/api/debug/asr/logs", (_req, res) => {
  res.json({
    sessionId: ASR_DEBUG_SESSION,
    count: asrDebugEvents.length,
    events: asrDebugEvents,
  });
});

app.post("/api/ai/frames", async (req, res) => {
  // #region debug-point V1:ai-request-received
  aiDebugEvents.push({
    ts: Date.now(),
    sessionId: AI_DEBUG_SESSION,
    runId: "pre-fix",
    hypothesisId: "V1",
    location: "server.js:/api/ai/frames",
    msg: "[DEBUG] AI frames request received",
    data: {
      hasArkKey: Boolean(ARK_API_KEY),
      frameCount: Array.isArray(req.body?.frames) ? req.body.frames.length : 0,
      firstFrameBase64Length: req.body?.frames?.[0]?.base64 ? req.body.frames[0].base64.length : 0,
    },
  });
  if (aiDebugEvents.length > 200) aiDebugEvents.shift();
  // #endregion
  if (!ARK_API_KEY) {
    return jsonError(res, 500, "服务端未配置视觉模型密钥");
  }

  const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
  if (!frames.length) {
    return jsonError(res, 400, "缺少 frames 参数");
  }

  const payload = buildVisionPrompt(frames);
  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ARK_API_ENDPOINT, {
      method: "POST",
      signal: timeout.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      // #region debug-point V1:ai-upstream-http-failure
      aiDebugEvents.push({
        ts: Date.now(),
        sessionId: AI_DEBUG_SESSION,
        runId: "pre-fix",
        hypothesisId: "V1",
        location: "server.js:/api/ai/frames",
        msg: "[DEBUG] AI upstream HTTP failure",
        data: {
          httpStatus: response.status,
          bodyPreview: text.slice(0, 500),
        },
      });
      if (aiDebugEvents.length > 200) aiDebugEvents.shift();
      // #endregion
      return jsonError(
        res,
        response.status,
        `视觉模型请求失败(${response.status})`,
        text.slice(0, 1000)
      );
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      // #region debug-point V2:ai-upstream-empty-content
      aiDebugEvents.push({
        ts: Date.now(),
        sessionId: AI_DEBUG_SESSION,
        runId: "pre-fix",
        hypothesisId: "V2",
        location: "server.js:/api/ai/frames",
        msg: "[DEBUG] AI upstream returned empty content",
        data: {
          hasChoices: Array.isArray(data?.choices),
          finishReason: data?.choices?.[0]?.finish_reason || null,
          bodyPreview: text.slice(0, 500),
        },
      });
      if (aiDebugEvents.length > 200) aiDebugEvents.shift();
      // #endregion
      return jsonError(res, 502, "视觉模型返回内容为空");
    }

    // #region debug-point V2:ai-upstream-success
    aiDebugEvents.push({
      ts: Date.now(),
      sessionId: AI_DEBUG_SESSION,
      runId: "pre-fix",
      hypothesisId: "V2",
      location: "server.js:/api/ai/frames",
      msg: "[DEBUG] AI upstream success",
      data: {
        contentLength: content.length,
        contentPreview: content.slice(0, 500),
      },
    });
    if (aiDebugEvents.length > 200) aiDebugEvents.shift();
    // #endregion
    res.json({ content, raw: data });
  } catch (error) {
    // #region debug-point V1:ai-request-exception
    aiDebugEvents.push({
      ts: Date.now(),
      sessionId: AI_DEBUG_SESSION,
      runId: "pre-fix",
      hypothesisId: "V1",
      location: "server.js:/api/ai/frames",
      msg: "[DEBUG] AI request exception",
      data: {
        name: error.name,
        error: error.message,
      },
    });
    if (aiDebugEvents.length > 200) aiDebugEvents.shift();
    // #endregion
    const message =
      error.name === "AbortError" ? "视觉模型请求超时" : error.message;
    jsonError(res, 502, message);
  } finally {
    timeout.clear();
  }
});

app.post("/api/asr", async (req, res) => {
  // #region debug-point B:asr-request-received
  asrDebugEvents.push({
    ts: Date.now(),
    sessionId: ASR_DEBUG_SESSION,
    runId: "pre-fix",
    hypothesisId: "B",
    location: "server.js:/api/asr",
    msg: "[DEBUG] ASR request received",
    data: { hasAudioBase64: Boolean(req.body?.audioBase64), audioSize: req.body?.audioBase64 ? req.body.audioBase64.length : 0 },
  });
  if (asrDebugEvents.length > 200) asrDebugEvents.shift();
  // #endregion
  if (!ASR_API_KEY) {
    return jsonError(res, 500, "服务端未配置 ASR 密钥");
  }

  const audioBase64 = req.body?.audioBase64;
  if (!audioBase64) {
    return jsonError(res, 400, "缺少 audioBase64 参数");
  }

  const requestId =
    "sb-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ASR_API_URL, {
      method: "POST",
      signal: timeout.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": ASR_API_KEY,
        "X-Api-Resource-Id": ASR_RESOURCE_ID,
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({
        user: { uid: "storyboard-ai" },
        audio: { data: audioBase64 },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: true,
        },
      }),
    });

    const statusCode = response.headers.get("X-Api-Status-Code");
    const statusMessage = response.headers.get("X-Api-Message");
    const text = await response.text();

    if (statusCode && statusCode !== "20000000") {
      // #region debug-point B:asr-header-failure
      asrDebugEvents.push({
        ts: Date.now(),
        sessionId: ASR_DEBUG_SESSION,
        runId: "pre-fix",
        hypothesisId: "B",
        location: "server.js:/api/asr",
        msg: "[DEBUG] ASR rejected by upstream headers",
        data: { statusCode, statusMessage, bodyPreview: text.slice(0, 300) },
      });
      if (asrDebugEvents.length > 200) asrDebugEvents.shift();
      // #endregion
      return jsonError(
        res,
        502,
        "语音识别失败",
        `${statusCode}${statusMessage ? `: ${statusMessage}` : ""}`
      );
    }

    if (!response.ok) {
      // #region debug-point B:asr-http-failure
      asrDebugEvents.push({
        ts: Date.now(),
        sessionId: ASR_DEBUG_SESSION,
        runId: "pre-fix",
        hypothesisId: "B",
        location: "server.js:/api/asr",
        msg: "[DEBUG] ASR upstream HTTP failure",
        data: { httpStatus: response.status, bodyPreview: text.slice(0, 300) },
      });
      if (asrDebugEvents.length > 200) asrDebugEvents.shift();
      // #endregion
      return jsonError(
        res,
        response.status,
        `语音识别请求失败(${response.status})`,
        text.slice(0, 1000)
      );
    }

    const parsed = JSON.parse(text);
    // #region debug-point D:asr-success-shape
    asrDebugEvents.push({
      ts: Date.now(),
      sessionId: ASR_DEBUG_SESSION,
      runId: "pre-fix",
      hypothesisId: "D",
      location: "server.js:/api/asr",
      msg: "[DEBUG] ASR upstream success",
      data: {
        hasResult: Boolean(parsed?.result),
        textLength: parsed?.result?.text ? parsed.result.text.length : 0,
        utteranceCount: Array.isArray(parsed?.result?.utterances) ? parsed.result.utterances.length : -1,
      },
    });
    if (asrDebugEvents.length > 200) asrDebugEvents.shift();
    // #endregion
    res.json(parsed);
  } catch (error) {
    // #region debug-point B:asr-exception
    asrDebugEvents.push({
      ts: Date.now(),
      sessionId: ASR_DEBUG_SESSION,
      runId: "pre-fix",
      hypothesisId: "B",
      location: "server.js:/api/asr",
      msg: "[DEBUG] ASR request exception",
      data: { error: error.message, name: error.name },
    });
    if (asrDebugEvents.length > 200) asrDebugEvents.shift();
    // #endregion
    const message =
      error.name === "AbortError" ? "语音识别请求超时" : error.message;
    jsonError(res, 502, message);
  } finally {
    timeout.clear();
  }
});

app.post("/api/video/resolve", async (req, res) => {
  const inputUrl = String(req.body?.url || "").trim();
  if (!inputUrl) {
    return jsonError(res, 400, "缺少 url 参数");
  }

  try {
    if (isDirectVideo(inputUrl)) {
      return res.json({
        ok: true,
        type: "direct",
        url: inputUrl,
        proxyUrl: getMediaProxyUrl(req, inputUrl),
        name: "视频直链",
      });
    }

    if (!isDouyinUrl(inputUrl)) {
      return res.json({
        ok: true,
        type: "generic",
        url: inputUrl,
        proxyUrl: getMediaProxyUrl(req, inputUrl),
        name: inputUrl.slice(0, 50),
      });
    }

    const resolvedUrl = /v\.douyin\.com/i.test(inputUrl)
      ? await resolveShortUrl(inputUrl)
      : inputUrl;
    const videoId = extractVideoId(resolvedUrl);

    if (!videoId) {
      return jsonError(res, 422, "无法从链接中提取视频 ID");
    }

    const result = await fetchDouyinVideoUrl(videoId);
    if (!result?.url) {
      return jsonError(
        res,
        502,
        "抖音视频解析失败，请改用本地上传或视频直链"
      );
    }

    res.json({
      ok: true,
      type: "douyin",
      videoId,
      url: result.url,
      proxyUrl: getMediaProxyUrl(req, result.url),
      name: `抖音: ${result.desc || videoId}`,
      desc: result.desc || "",
    });
  } catch (error) {
    jsonError(res, 502, "视频解析失败", error.message);
  }
});

app.get("/api/media/proxy", async (req, res) => {
  const targetUrl = String(req.query.url || "").trim();
  if (!targetUrl) {
    return jsonError(res, 400, "缺少 url 参数");
  }

  const headers = {};
  if (req.headers.range) {
    headers.Range = req.headers.range;
  }
  headers["User-Agent"] =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const timeout = createTimeoutSignal(REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      headers,
      redirect: "follow",
      signal: timeout.signal,
    });

    if (!response.ok && response.status !== 206) {
      return jsonError(
        res,
        response.status,
        `远程媒体获取失败(${response.status})`
      );
    }

    res.status(response.status);
    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
      "cache-control",
    ];

    for (const header of passthroughHeaders) {
      const value = response.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    }

    if (!res.getHeader("cache-control")) {
      res.setHeader("cache-control", "public, max-age=300");
    }

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    const message =
      error.name === "AbortError" ? "远程媒体请求超时" : error.message;
    jsonError(res, 502, message);
  } finally {
    timeout.clear();
  }
});

app.get("*", (_req, res) => {
  res.sendFile(INDEX_FILE);
});

app.listen(PORT, () => {
  console.log(`StoryBoard AI server running on http://localhost:${PORT}`);
});
