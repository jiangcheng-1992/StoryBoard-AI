
var SERVER_CONFIG = { asrEnabled: false, visionEnabled: false };
var curVideo=null,results=null,mergedDataUrl=null;
var DEBUG_ASR_ENABLED = /(?:\?|&)debugAsr=1(?:&|$)/.test(location.search);
var DEBUG_ASR_SESSION = 'asr-lyrics-missing';

var $=function(id){return document.getElementById(id)};

function debugAsr(hypothesisId, msg, data) {
  if (!DEBUG_ASR_ENABLED) return;
  fetch('/api/debug/asr/event', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      sessionId: DEBUG_ASR_SESSION,
      runId: 'pre-fix',
      hypothesisId: hypothesisId,
      location: 'index.html',
      msg: '[DEBUG] ' + msg,
      data: data || {},
      ts: Date.now()
    })
  }).catch(function(){});
}

initServerConfig();

async function apiJson(url, options) {
  var resp = await fetch(url, options || {});
  var data = null;
  try { data = await resp.json(); } catch (e) {}
  if (!resp.ok) {
    var msg = data && data.error ? data.error : ('请求失败(' + resp.status + ')');
    if (data && data.details) msg += ': ' + data.details;
    throw new Error(msg);
  }
  return data || {};
}

async function initServerConfig() {
  try {
    SERVER_CONFIG = await apiJson('/api/config');
  } catch (e) {
    console.warn('配置读取失败:', e.message);
    SERVER_CONFIG = { asrEnabled: false, visionEnabled: false };
  }
  updateAsrStatus();
}

function updateAsrStatus() {
  var box = $('asrStatusBox');
  if (!box) return;
  if (SERVER_CONFIG.asrEnabled) {
    box.innerHTML = '已检测到服务端 ASR 配置，语音识别将由 Render 后端代为调用，浏览器不保存真实密钥。';
    box.style.borderColor = 'rgba(0,184,148,.25)';
    box.style.color = 'var(--ok)';
  } else {
    box.innerHTML = '服务端暂未配置 ASR 密钥，当前会跳过语音识别，仅保留画面分析。';
    box.style.borderColor = 'rgba(253,203,110,.3)';
    box.style.color = 'var(--warn)';
  }
}

$('fInput').addEventListener('change',function(){if(this.files&&this.files.length)loadFile(this.files[0])});
var upZone=$('upZone');
['dragenter','dragover'].forEach(function(ev){upZone.addEventListener(ev,function(e){e.preventDefault();e.stopPropagation();upZone.classList.add('drag')})});
['dragleave','drop'].forEach(function(ev){upZone.addEventListener(ev,function(e){e.preventDefault();e.stopPropagation();upZone.classList.remove('drag')})});
upZone.addEventListener('drop',function(e){var f=e.dataTransfer.files;if(f.length&&f[0].type.startsWith('video/'))loadFile(f[0])});
$('rmBtn').addEventListener('click',rmVideo);$('goBtn').addEventListener('click',startAnalysis);
$('expMdBtn').addEventListener('click',exportMd);$('expPmBtn').addEventListener('click',exportPrompts);$('dlGridBtn').addEventListener('click',dlMerged);
$('imgMdl').addEventListener('click',function(){this.classList.remove('on')});$('mdlClose').addEventListener('click',function(){$('imgMdl').classList.remove('on')});
$('mdlCopy').addEventListener('click',function(){cpTxt($('mdlPt').textContent)});
document.addEventListener('keydown',function(e){if(e.key==='Escape')$('imgMdl').classList.remove('on')});

function loadFile(f){curVideo={type:'file',file:f,name:f.name};showPre(URL.createObjectURL(f),'📁 '+f.name+' ('+(f.size/1048576).toFixed(1)+'MB)');$('goBtn').disabled=false;hideNotice()}
function showPre(src,name){if(src){$('vPlayer').src=src}else{$('vPlayer').removeAttribute('src')}$('vName').textContent=name;$('vPre').style.display='block'}
function rmVideo(){curVideo=null;$('vPre').style.display='none';$('vPlayer').src='';$('goBtn').disabled=true;hideNotice()}
function showNotice(msg,type){var n=$('urlNotice');n.innerHTML=msg;n.className='notice on';if(type==='ok')n.style.borderColor='rgba(0,184,148,.3)',n.style.background='rgba(0,184,148,.1)',n.style.color='var(--ok)';else if(type==='err')n.style.borderColor='rgba(225,112,85,.3)',n.style.background='rgba(225,112,85,.1)',n.style.color='var(--err)';else n.style.borderColor='rgba(253,203,110,.3)',n.style.background='rgba(253,203,110,.1)',n.style.color='var(--warn)'}
function hideNotice(){$('urlNotice').className='notice'}

/* ========== 提取帧 ========== */
function extractFrames(videoEl, n) {
  return new Promise(function(resolve) {
    var vw=videoEl.videoWidth,vh=videoEl.videoHeight,tw,th;
    if(vw>=vh){tw=Math.min(480,vw);th=Math.round(tw*vh/vw)}else{th=Math.min(640,vh);tw=Math.round(th*vw/vh)}
    var c=document.createElement('canvas');c.width=tw;c.height=th;var ctx=c.getContext('2d',{willReadFrequently:true});
    var dur=videoEl.duration,frames=[],cur=0;
    function next(){if(cur>=n){resolve(frames);return}videoEl.currentTime=(dur/(n+1))*(cur+1)}
    videoEl.onseeked=function(){
      ctx.drawImage(videoEl,0,0,tw,th);
      var dataUrl=c.toDataURL('image/jpeg',.82);
      var base64=dataUrl.split(',')[1];
      var timeStart=videoEl.currentTime;
      var timeEnd=cur<n-1?(dur/(n+1))*(cur+2):dur;
      frames.push({dataUrl:dataUrl,base64:base64,time:timeStart,timeEnd:timeEnd,w:tw,h:th,idx:cur});
      cur++;next();
    };
    next();
  });
}


/* ========== 真实语音识别（豆包语音ASR大模型） ========== */

async function extractAudioFromVideo(videoSource) {
  // 使用 Web Audio API 从视频中提取音频轨道，编码为 WAV base64
  return new Promise(async function(resolve) {
    try {
      var arrayBuffer;
      if (videoSource instanceof File) {
        if (videoSource.size > 100*1024*1024) {
          // #region debug-point C:file-too-large
          debugAsr('C', 'audio extraction skipped because file is too large', { size: videoSource.size, sourceType: 'file' });
          // #endregion
          console.warn('[音频提取] 文件过大:', Math.round(videoSource.size/1024/1024)+'MB');
          resolve(null); return;
        }
        arrayBuffer = await videoSource.arrayBuffer();
      } else if (typeof videoSource === 'string') {
        try {
          var resp = await fetch(videoSource);
          if (!resp.ok) throw new Error('fetch fail');
          arrayBuffer = await resp.arrayBuffer();
        } catch(e) {
          // #region debug-point C:remote-fetch-failed
          debugAsr('C', 'audio extraction failed while fetching remote video', { sourceType: 'url', error: e.message, videoSource: String(videoSource).slice(0, 180) });
          // #endregion
          console.warn('[音频提取] 无法获取视频URL:', e.message);
          resolve(null); return;
        }
      } else { resolve(null); return; }

      // 解码音频
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var audioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      } catch(e) {
        // #region debug-point C:decode-failed
        debugAsr('C', 'audio extraction decodeAudioData failed', { error: e.message, byteLength: arrayBuffer.byteLength || 0 });
        // #endregion
        console.warn('[音频提取] 解码音频失败:', e.message);
        audioCtx.close();
        resolve(null); return;
      }
      audioCtx.close();

      // 重采样到 16kHz 单声道
      var sampleRate = 16000;
      var numChannels = 1;
      var origRate = audioBuffer.sampleRate;
      var origData = audioBuffer.getChannelData(0); // 取第一声道

      // 简单线性插值重采样
      var ratio = origRate / sampleRate;
      var newLen = Math.round(origData.length / ratio);
      
      // 限制音频长度到 120 分钟
      var maxSamples = 7200 * sampleRate;
      if (newLen > maxSamples) newLen = maxSamples;
      
      var resampled = new Float32Array(newLen);
      for (var i = 0; i < newLen; i++) {
        var srcIdx = i * ratio;
        var idx0 = Math.floor(srcIdx);
        var idx1 = Math.min(idx0 + 1, origData.length - 1);
        var frac = srcIdx - idx0;
        resampled[i] = origData[idx0] * (1 - frac) + origData[idx1] * frac;
      }

      // 编码为 WAV (PCM 16-bit)
      var wavBuffer = encodeWAV(resampled, sampleRate, numChannels);
      
      // 转成 base64
      var bytes = new Uint8Array(wavBuffer);
      var binary = '';
      var chunkSize = 8192;
      for (var i = 0; i < bytes.length; i += chunkSize) {
        var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      var b64 = btoa(binary);
      // #region debug-point C:audio-extracted
      debugAsr('C', 'audio extraction succeeded', { sampleRate: sampleRate, seconds: Number((newLen/sampleRate).toFixed(1)), base64Length: b64.length });
      // #endregion
      
      console.log('[音频提取] 成功，采样率:', sampleRate, '时长:', (newLen/sampleRate).toFixed(1)+'s', '大小:', Math.round(wavBuffer.byteLength/1024)+'KB');
      resolve(b64);
    } catch(e) {
      // #region debug-point C:audio-exception
      debugAsr('C', 'audio extraction threw exception', { error: e.message, name: e.name });
      // #endregion
      console.error('[音频提取] 失败:', e);
      resolve(null);
    }
  });
}

function encodeWAV(samples, sampleRate, numChannels) {
  var bitsPerSample = 16;
  var byteRate = sampleRate * numChannels * bitsPerSample / 8;
  var blockAlign = numChannels * bitsPerSample / 8;
  var dataSize = samples.length * (bitsPerSample / 8);
  var buffer = new ArrayBuffer(44 + dataSize);
  var view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  
  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (PCM)
  view.setUint16(20, 1, true);  // AudioFormat (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Write PCM samples (clamp to -1..1, convert to int16)
  var offset = 44;
  for (var i = 0; i < samples.length; i++) {
    var s = Math.max(-1, Math.min(1, samples[i]));
    var val = s < 0 ? s * 32768 : s * 32767;
    view.setInt16(offset, val, true);
    offset += 2;
  }
  
  return buffer;
}

function writeString(view, offset, string) {
  for (var i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

async function realASR(audioBase64) {
  if (!SERVER_CONFIG.asrEnabled) {
    // #region debug-point A:asr-disabled
    debugAsr('A', 'frontend skipped ASR because config says disabled', {});
    // #endregion
    console.log('[ASR] 服务端未配置语音识别，跳过');
    return null;
  }
  // #region debug-point B:frontend-asr-send
  debugAsr('B', 'frontend is sending audio to /api/asr', { base64Length: audioBase64 ? audioBase64.length : 0 });
  // #endregion
  console.log('[ASR] 发送到服务端代理，音频大小:', Math.round(audioBase64.length * 3/4 / 1024)+'KB');
  var data = await apiJson('/api/asr', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({audioBase64: audioBase64})
  });
  console.log('[ASR] 成功:', JSON.stringify(data).substring(0, 500));
  return data;
}

function parseASRResponse(asrData) {
  // 解析豆包语音ASR返回的utterances，提取带时间戳的文本
  // #region debug-point D:parse-asr-shape
  debugAsr('D', 'parseASRResponse received payload', {
    hasResult: !!(asrData && asrData.result),
    hasText: !!(asrData && asrData.result && asrData.result.text),
    utteranceCount: asrData && asrData.result && Array.isArray(asrData.result.utterances) ? asrData.result.utterances.length : -1
  });
  // #endregion
  if (!asrData || !asrData.result) return [];
  
  var result = asrData.result;
  var utterances = result.utterances || [];
  
  if (utterances.length === 0 && result.text) {
    // 没有分句但有整体文本
    var dur = (asrData.audio_info && asrData.audio_info.duration) || 0;
    return [{start: 0, end: dur / 1000, text: result.text}];
  }
  
  return utterances.map(function(u) {
    return {
      start: (u.start_time || 0) / 1000,  // ms -> seconds
      end: (u.end_time || 0) / 1000,
      text: u.text || ''
    };
  }).filter(function(u) { return u.text.trim().length > 0; });
}

function matchASRToFrames(asrResults, frames) {
  if (!asrResults || asrResults.length === 0) return {};
  var map = {};
  frames.forEach(function(f, idx) {
    var ts = [];
    asrResults.forEach(function(seg) {
      var ss = seg.start || 0, se = seg.end || (ss+3);
      // 时间范围重叠检测
      if (ss < f.timeEnd && se > f.time) ts.push(seg.text);
    });
    if (ts.length > 0) map[idx] = ts.join(' ');
  });
  // #region debug-point E:match-asr-to-frames
  debugAsr('E', 'matchASRToFrames completed', { asrResultCount: asrResults.length, frameCount: frames.length, mappedFrameCount: Object.keys(map).length });
  // #endregion
  console.log('[ASR匹配]', Object.keys(map).length, '帧有台词，共', asrResults.length, '段语音');
  return map;
}

/* ========== AI视觉分析 ========== */
async function aiAnalyzeFrames(frames) {
  var payloadFrames = frames.map(function(f, i){
    return {
      base64: f.base64,
      index: i,
      timeLabel: fmtTime(f.time)+'-'+fmtTime(f.timeEnd)
    };
  });
  var data;
  try {
    data = await apiJson('/api/ai/frames', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({frames: payloadFrames})
    });
  } catch (e) {
    if (/402|403|insufficient|quota|balance|billing|欠费|余额不足|额度/i.test(e.message)) {
      document.getElementById('feeModal').classList.add('on');
      throw new Error('模型已欠费，请催促姜承去充值！');
    }
    throw e;
  }
  var text = data.content || '';
  return parseAIResponse(text);
}

function parseAIResponse(text) {
  console.log('[AI原始返回]', text);
  var overall = '';
  var shots = [];

  // 提取整体描述：优先取 ---SPLIT--- 之前，回退到 JSON 之前的文字
  var splitIdx = text.indexOf('---SPLIT---');
  if (splitIdx !== -1) {
    overall = text.substring(0, splitIdx).trim();
  }

  // 策略1: 匹配 ```json ... ``` 代码块（支持多种格式）
  var jsonStr = '';
  var codeBlocks = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (codeBlocks) {
    for (var i = 0; i < codeBlocks.length; i++) {
      var inner = codeBlocks[i].replace(/```(?:json)?\s*/,'').replace(/```\s*$/,'').trim();
      if (inner.charAt(0) === '[') { jsonStr = inner; break; }
    }
  }

  // 策略2: 直接找最长的 [...] 数组
  if (!jsonStr) {
    var allArrays = [];
    var depth = 0, start = -1;
    for (var i = 0; i < text.length; i++) {
      if (text[i] === '[' && depth === 0) { start = i; depth++; }
      else if (text[i] === '[') depth++;
      else if (text[i] === ']') { depth--; if (depth === 0 && start >= 0) { allArrays.push(text.substring(start, i+1)); start = -1; } }
    }
    // 取最长的（通常是主数组）
    if (allArrays.length > 0) {
      allArrays.sort(function(a,b){ return b.length - a.length; });
      jsonStr = allArrays[0];
    }
  }

  // 策略3: 如果JSON被截断（没有闭合的]），尝试补全
  if (!jsonStr) {
    var lastBracket = text.lastIndexOf('[');
    if (lastBracket >= 0) {
      var partial = text.substring(lastBracket);
      // 尝试补全截断的JSON
      partial = partial.replace(/,\s*$/, '');
      if (partial.indexOf(']') === -1) partial += '}]';
      jsonStr = partial;
    }
  }

  // 解析JSON（多层容错）
  if (jsonStr) {
    // 清理常见问题
    jsonStr = jsonStr.replace(/[\r\n]+/g, '\n');
    // 尝试直接解析
    try { shots = JSON.parse(jsonStr); } catch(e) {
      console.warn('[JSON解析失败，尝试修复]', e.message);
      try {
        // 修复尾逗号
        var fixed = jsonStr.replace(/,\s*}/g,'}').replace(/,\s*\]/g,']');
        shots = JSON.parse(fixed);
      } catch(e2) {
        try {
          // 修复未闭合的字符串和对象
          var fixed2 = jsonStr;
          if (fixed2.lastIndexOf('}') < fixed2.lastIndexOf('"')) fixed2 += '"}';
          if (fixed2.indexOf(']') === -1) fixed2 += ']';
          fixed2 = fixed2.replace(/,\s*}/g,'}').replace(/,\s*\]/g,']');
          shots = JSON.parse(fixed2);
        } catch(e3) {
          console.error('[JSON最终解析失败]', e3.message, '原始JSON:', jsonStr.substring(0,500));
        }
      }
    }
  }

  // 如果没提取到整体描述，用 JSON 之前的内容
  if (!overall) {
    var jsonStart = jsonStr ? text.indexOf(jsonStr.substring(0,20)) : -1;
    if (jsonStart > 0) {
      overall = text.substring(0, jsonStart).replace(/```json?/g,'').replace(/---SPLIT---/g,'').trim();
    } else {
      overall = text.split('\n\n')[0].trim();
    }
  }

  // 清理整体描述中的markdown标记
  overall = overall.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/【整体描述】/g, '').trim();

  console.log('[解析结果] overall长度:', overall.length, 'shots数量:', shots.length);
  return { overall: overall, shots: shots };
}

/* ========== 主分析流 ========== */
async function startAnalysis(){
  var n = +$('sCnt').value, ratio = $('sRatio').value;
  showProc();
  $('procTitle').textContent = 'AI 正在分析视频画面' + (SERVER_CONFIG.asrEnabled ? ' + 语音识别' : '');
  try{
    var frames = [];
    // #region debug-point A:start-analysis
    debugAsr('A', 'startAnalysis entered', {
      asrEnabled: SERVER_CONFIG.asrEnabled,
      videoType: curVideo && curVideo.type ? curVideo.type : 'unknown',
      shotCount: n,
      ratio: ratio
    });
    // #endregion

    upStep(0,'on'); setProg(3);
    $('procSub').textContent = '正在加载本地视频...';
    var vid = document.createElement('video');
    vid.src = URL.createObjectURL(curVideo.file);
    vid.muted = true;
    vid.playsInline = true;
    await new Promise(function(res, rej){
      vid.onloadedmetadata = res;
      vid.onerror = function(){ rej(new Error('视频加载失败')); };
      vid.load();
    });
    upStep(0,'ok'); setProg(8);

    upStep(1,'on'); setProg(10);
    $('procSub').textContent = vid.videoWidth + '×' + vid.videoHeight + ' · ' + Math.round(vid.duration) + 's · 抽' + n + '帧';
    frames = await extractFrames(vid, n);
    URL.revokeObjectURL(vid.src);
    upStep(1,'ok'); setProg(20);

    var asrPromise = null;
    if (SERVER_CONFIG.asrEnabled) {
      try {
        $('procSub').textContent = '正在从视频中提取音频轨道...';
        var audioBase64 = await extractAudioFromVideo(curVideo.file);
        if (audioBase64) {
          $('procSub').textContent = '音频提取成功，正在调用服务端 ASR 代理识别...';
          asrPromise = realASR(audioBase64).then(function(asrData){
            return parseASRResponse(asrData);
          });
        } else {
          // #region debug-point C:audio-empty
          debugAsr('C', 'audio extraction returned empty payload', { videoType: curVideo.type });
          // #endregion
          console.log('[流程] 音频提取失败（格式不支持或媒体不可读），跳过语音识别');
        }
      } catch(e) {
        console.warn('[流程] 语音识别准备异常:', e.message);
      }
    } else {
      console.log('[流程] 服务端未配置 ASR，跳过语音识别');
    }
    setProg(25);

    var aiResult = null;
    upStep(2,'on');
    $('procSub').textContent = '正在发送 ' + frames.length + ' 帧给豆包 AI 分析画面...';
    setProg(30);
    try {
      aiResult = await aiAnalyzeFrames(frames);
      upStep(2,'ok'); setProg(50);
    } catch(e) {
      upStep(2,'ok');
      console.error('AI 分析失败:', e);
      $('procSub').textContent = 'AI 分析失败: ' + e.message + '，降级为基础模式';
      await slp(2000);
      setProg(50);
    }

    upStep(3,'on'); setProg(60);
    var overall;
    if (aiResult && aiResult.overall) {
      overall = aiResult.overall;
      $('procSub').textContent = 'AI 识别完成，正在组装脚本...';
    } else {
      overall = '（AI 分析未成功，暂无整体描述。请检查网络后重试。）';
    }
    await slp(200);
    upStep(3,'ok'); setProg(70);

    var asrMapping = {};
    if (asrPromise) {
      $('procSub').textContent = '等待豆包语音 ASR 识别结果...';
      try {
        var asrResults = await asrPromise;
        // #region debug-point D:asr-results-ready
        debugAsr('D', 'ASR promise resolved', { asrResultCount: asrResults ? asrResults.length : -1 });
        // #endregion
        if (asrResults && asrResults.length > 0) {
          asrMapping = matchASRToFrames(asrResults, frames);
          $('procSub').textContent = '语音识别完成，识别到 ' + asrResults.length + ' 段真实台词';
          console.log('[流程] 豆包语音 ASR 成功, ' + Object.keys(asrMapping).length + ' 帧匹配到台词');
        } else if (asrResults && asrResults.length === 0) {
          console.log('[流程] 视频无语音内容（纯音乐或无声）');
          $('procSub').textContent = '视频无语音内容';
        } else {
          console.log('[流程] 语音识别未返回有效结果');
        }
      } catch(e) {
        // #region debug-point B:asr-promise-failed
        debugAsr('B', 'ASR promise rejected', { error: e.message });
        // #endregion
        console.warn('[流程] 语音识别失败:', e.message);
        $('procSub').textContent = '语音识别失败: ' + e.message;
        await slp(2000);
      }
    }
    setProg(73);

    upStep(4,'on'); setProg(75);
    var shotScripts = frames.map(function(f, i) {
      var aiShot = (aiResult && aiResult.shots && aiResult.shots[i]) ? aiResult.shots[i] : null;
      var narration = '';
      var narrSrc = '';
      if (asrMapping && asrMapping[i]) {
        narration = asrMapping[i];
        narrSrc = 'asr';
      } else if (aiShot) {
        narration = aiShot['旁白台词'] || aiShot['旁白'] || aiShot['台词'] || '';
        narrSrc = narration ? 'vision' : '';
      }
      return {
        number: i + 1,
        frame: f,
        time: fmtTime(f.time) + ' - ' + fmtTime(f.timeEnd),
        shotType: aiShot ? aiShot['景别'] : '—',
        camera: aiShot ? aiShot['运镜'] : '（AI未返回）',
        content: aiShot ? aiShot['画面内容'] : '（AI未返回，请重试）',
        action: aiShot ? aiShot['人物动作'] : '—',
        mood: aiShot ? aiShot['情绪氛围'] : '—',
        narration: narration,
        narrSrc: narrSrc,
        jimengPrompt: aiShot ? aiShot['即梦prompt'] : '（AI未返回，请重试）',
        hasAI: !!aiShot
      };
    });
    await slp(200);
    upStep(4,'ok'); setProg(85);

    upStep(5,'on'); setProg(90);
    results = {
      shots: shotScripts,
      overall: overall,
      overallPrompt: buildOverallPrompt(shotScripts),
      ratio: ratio,
      mode: '豆包AI',
      hasAI: !!(aiResult && aiResult.shots && aiResult.shots.length > 0)
    };
    await slp(200);
    upStep(5,'ok'); setProg(100);
    await slp(200);
    hideProc();
    renderResults(results);
  } catch(e) {
    hideProc();
    toast('错误: ' + e.message);
    console.error(e);
  }
}

/* ========== 渲染结果 ========== */
function renderResults(R){
  $('resSec').classList.add('on');
  $('s1').textContent = R.shots.length;
  $('s2').textContent = R.shots.length > 0 ? fmtTime(R.shots[R.shots.length - 1].frame.timeEnd) : '-';
  $('s3').textContent = R.mode;
  $('s4').textContent = R.ratio;

  var gv = $('gridView');
  gv.innerHTML = '';
  R.shots.forEach(function(s){
    var c2 = document.createElement('div');
    c2.className = 'gc';
    c2.addEventListener('click', function(){ openMdl(s); });
    c2.innerHTML = '<img src="' + s.frame.dataUrl + '"><div class="gc-n">' + s.number + '</div><div class="gc-t">' + s.time.split(' - ')[0] + '</div>';
    gv.appendChild(c2);
  });
  buildMerged(R.shots);

  var fs = $('fullScript');
  var html = '<div class="full-script-title">📝 视频整体描述 & 即梦总提示词</div>';
  html += '<div class="overall" id="overallText">' + escHtml(R.overall) + '</div>';
  html += '<div class="overall" id="overallPromptText" style="margin-top:12px"><b>结构化总提示词</b>\n' + escHtml(R.overallPrompt || '') + '</div>';
  html += '<div style="text-align:right;margin:-10px 0 16px"><button class="btn btn2" style="padding:8px 16px;font-size:13px" onclick="cpTxt(document.getElementById(\'overallText\').textContent)">📋 复制整体描述</button></div>';
  html += '<div style="text-align:right;margin:-10px 0 16px"><button class="btn btn2" style="padding:8px 16px;font-size:13px" onclick="cpTxt(document.getElementById(\'overallPromptText\').textContent)">📋 复制总提示词</button></div>';

  var seqs = groupSequences(R.shots);
  seqs.forEach(function(seq) {
    html += '<div class="seq-block"><div class="seq-label">' + seq.label + '</div>';
    seq.shots.forEach(function(s) {
      html += '<div class="shot-row"><div class="shot-time">' + s.time.split(' - ')[0] + '</div><div class="shot-content">';
      html += '<span class="cam-tag">' + s.shotType + '</span>';
      if (s.camera && s.camera !== '—' && s.camera !== '（AI未返回）') html += '<span class="cam-tag">🎥 ' + escHtml(s.camera) + '</span>';
      html += '<br><b>[分镜' + s.number + ']</b> ' + escHtml(s.content);
      if (s.action && s.action !== '—') html += '<br>👤 <b>动作:</b> ' + escHtml(s.action);
      if (s.mood && s.mood !== '—') html += '<br>💫 <b>情绪:</b> ' + escHtml(s.mood);
      html += '<br>🎙 <b>旁白/台词:</b> ';
      if (s.narration && s.narration.trim()) {
        html += '<span class="narr-tag">' + escHtml(s.narration) + '</span>';
        if (s.narrSrc === 'asr') html += ' <span style="font-size:11px;padding:1px 6px;background:rgba(0,184,148,.12);color:var(--ok);border-radius:4px">语音识别</span>';
      } else {
        html += '<span style="color:var(--text3);font-style:italic">无</span>';
      }
      html += '</div></div>';
    });
    html += '</div>';
  });
  html += '<div style="text-align:right;margin-top:12px"><button class="btn btn1" style="padding:10px 20px;font-size:13px" onclick="copyFullScript()">📋 复制完整分镜脚本</button></div>';
  fs.innerHTML = html;

  var sl = $('sbList');
  sl.innerHTML = '';
  R.shots.forEach(function(s){
    var card = document.createElement('div');
    card.className = 'sbc';
    var h = '<div class="sbc-h"><div class="sn">' + s.number + '</div><div class="sm">' +
      '<div class="sm-t">' + (s.hasAI ? s.shotType + ' · ' + s.content.substring(0, 30) : '镜头' + s.number) + '</div>' +
      '<div class="sm-tags"><span class="stag">' + s.time + '</span>' + (s.shotType !== '—' ? '<span class="stag">' + s.shotType + '</span>' : '') +
      (s.hasAI ? '<span class="stag" style="background:rgba(0,184,148,.1);color:var(--ok);border-color:rgba(0,184,148,.2)">AI分析</span>' : '') +
      '</div></div></div>';
    h += '<div class="sbc-b"><div class="sthumb"><img src="' + s.frame.dataUrl + '"></div><div class="sdets">';
    h += '<div class="sf"><div class="sf-l" style="color:var(--accent2)">🎬 即梦 Prompt</div>';
    h += '<div class="pblk"><button class="cpb" onclick="cpTxt(this.parentElement.querySelector(\'.ptxt\').textContent)">复制</button><div class="ptxt">' + escHtml(s.jimengPrompt) + '</div></div></div>';
    h += '<div class="sf"><div class="sf-l" style="color:var(--warn)">🎥 运镜</div><div class="sf-v">' + escHtml(s.camera) + '</div></div>';
    h += '<div class="sf"><div class="sf-l" style="color:var(--ok)">🖼 画面内容</div><div class="sf-v">' + escHtml(s.content) + '</div></div>';
    if (s.action && s.action !== '—') h += '<div class="sf"><div class="sf-l" style="color:var(--err)">👤 人物动作</div><div class="sf-v">' + escHtml(s.action) + '</div></div>';
    if (s.mood && s.mood !== '—') h += '<div class="sf"><div class="sf-l" style="color:var(--text2)">💫 情绪氛围</div><div class="sf-v">' + escHtml(s.mood) + '</div></div>';
    h += '<div class="sf"><div class="sf-l" style="color:#e056a0">🎙 旁白/台词</div>';
    if (s.narration && s.narration.trim()) {
      h += '<div class="sf-v">' + escHtml(s.narration) + (s.narrSrc === 'asr' ? ' <span style="font-size:11px;padding:2px 8px;background:rgba(0,184,148,.12);color:var(--ok);border-radius:4px;margin-left:6px">语音识别</span>' : '') + '</div>';
    } else {
      h += '<div class="sf-v empty">无</div>';
    }
    h += '</div></div></div>';
    card.innerHTML = h;
    sl.appendChild(card);
  });
  $('resSec').scrollIntoView({behavior:'smooth', block:'start'});
}

function groupSequences(shots) {
  var seqs = [], size = 3;
  var labels = ['Sequence 1: 开篇', 'Sequence 2: 发展', 'Sequence 3: 高潮', 'Sequence 4: 结局'];
  for (var i = 0; i < shots.length; i += size) {
    seqs.push({label: labels[Math.min(seqs.length, labels.length - 1)], shots: shots.slice(i, i + size)});
  }
  return seqs;
}

function cleanText(s){ return String(s || '').replace(/\s+/g, ' ').trim(); }
function extractMainCharacter(content){
  var text = cleanText(content);
  if (!text || text === '（AI未返回，请重试）') return '主体未明确';
  var patterns = [
    /(一位[^，。；]{2,24})/,
    /(一个[^，。；]{2,24})/,
    /(女生[^，。；]{0,24})/,
    /(女孩[^，。；]{0,24})/,
    /(女性[^，。；]{0,24})/,
    /(男人[^，。；]{0,24})/,
    /(男生[^，。；]{0,24})/,
    /(少年[^，。；]{0,24})/,
    /(老人[^，。；]{0,24})/,
    /(角色[^，。；]{0,24})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) return m[1];
  }
  return text.split(/[，。；]/)[0].slice(0, 30);
}
function extractSceneSummary(content){
  var text = cleanText(content);
  if (!text || text === '（AI未返回，请重试）') return '场景未明确';
  var parts = text.split(/[，。；]/).filter(Boolean);
  if (parts.length > 1) return parts.slice(1).join('，').slice(0, 60) || text.slice(0, 60);
  return text.slice(0, 60);
}
function buildOverallPrompt(shots){
  if (!shots || shots.length === 0) return '暂无结构化总提示词';
  return shots.map(function(s){
    var person = extractMainCharacter(s.content);
    var action = cleanText(s.action && s.action !== '—' ? s.action : s.content);
    var scene = extractSceneSummary(s.content);
    var narration = s.narration && s.narration.trim() ? s.narration.trim() : '无明确台词';
    return s.time + '：人物：' + person + '；动作：' + action + '；场景：' + scene + '；台词：' + narration;
  }).join('\n');
}
function escHtml(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function copyFullScript(){
  if (!results) return;
  var txt = '【视频整体描述】\n' + results.overall + '\n\n【结构化总提示词】\n' + (results.overallPrompt || '') + '\n\n【完整分镜脚本】\n\n';
  results.shots.forEach(function(s){
    txt += '[分镜' + s.number + ' ' + s.time + '] ' + s.shotType + '\n';
    txt += '运镜：' + s.camera + '\n画面：' + s.content + '\n';
    if (s.action && s.action !== '—') txt += '动作：' + s.action + '\n';
    if (s.mood && s.mood !== '—') txt += '情绪：' + s.mood + '\n';
    txt += '旁白/台词：' + (s.narration && s.narration.trim() ? s.narration : '无') + '\n';
    txt += '即梦Prompt：' + s.jimengPrompt + '\n\n';
  });
  cpTxt(txt);
}

function buildMerged(shots){
  var wrap = $('mergedWrap');
  wrap.innerHTML = '';
  mergedDataUrl = null;
  var cols = 3, rows = Math.ceil(shots.length / cols);
  var fw = shots[0].frame.w, fh = shots[0].frame.h;
  var gap = 6, pad = 14, cw = fw, ch = fh;
  var rawW = cols * cw + (cols - 1) * gap + pad * 2;
  if (rawW > 1100) {
    var sc = 1100 / rawW;
    cw = ~~(cw * sc);
    ch = ~~(ch * sc);
  }
  var cvW = cols * cw + (cols - 1) * gap + pad * 2;
  var cvH = rows * ch + (rows - 1) * gap + pad * 2;
  var cv = document.createElement('canvas');
  cv.width = cvW;
  cv.height = cvH;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, cvW, cvH);
  var loaded = 0;
  shots.forEach(function(s, i){
    var img = new Image();
    img.onload = function(){
      var col = i % cols, row = ~~(i / cols), x = pad + col * (cw + gap), y = pad + row * (ch + gap);
      ctx.save(); rr(ctx, x, y, cw, ch, 8); ctx.clip(); ctx.drawImage(img, x, y, cw, ch); ctx.restore();
      ctx.fillStyle = 'rgba(108,92,231,.9)'; rr(ctx, x + 4, y + 4, 24, 24, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.number, x + 16, y + 16);
      loaded++;
      if (loaded === shots.length) {
        mergedDataUrl = cv.toDataURL('image/jpeg', .92);
        var d = document.createElement('img');
        d.src = mergedDataUrl;
        wrap.appendChild(d);
      }
    };
    img.src = s.frame.dataUrl;
  });
}
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
function openMdl(s){
  $('mdlTtl').textContent = '镜头' + s.number;
  $('mdlImg').src = s.frame.dataUrl;
  $('mdlDesc').innerHTML = '<b>景别:</b> ' + escHtml(s.shotType) + '<br><b>运镜:</b> ' + escHtml(s.camera) + '<br><b>画面:</b> ' + escHtml(s.content) + '<br><b>动作:</b> ' + escHtml(s.action) + '<br><b>情绪:</b> ' + escHtml(s.mood) + '<br><b>旁白/台词:</b> ' + (s.narration && s.narration.trim() ? escHtml(s.narration) : '<i style="color:var(--text3)">无</i>');
  $('mdlPt').textContent = s.jimengPrompt;
  $('imgMdl').classList.add('on');
}

function exportMd(){
  if (!results) return;
  var md = '# 视频分镜脚本（即梦AI适配 v12）\n\n## 整体描述\n\n' + results.overall + '\n\n## 结构化总提示词\n\n' + (results.overallPrompt || '') + '\n\n---\n\n';
  results.shots.forEach(function(s){
    md += '## 分镜' + s.number + ' | ' + s.time + '\n\n| 要素 | 内容 |\n|---|---|\n';
    md += '| 景别 | ' + s.shotType + ' |\n| 运镜 | ' + s.camera + ' |\n| 画面 | ' + s.content + ' |\n';
    md += '| 动作 | ' + s.action + ' |\n| 情绪 | ' + s.mood + ' |\n';
    md += '| 旁白/台词 | ' + (s.narration && s.narration.trim() ? s.narration : '无') + ' |\n\n';
    md += '**即梦Prompt**\n```\n' + s.jimengPrompt + '\n```\n\n---\n\n';
  });
  dlBlob(new Blob([md], {type:'text/markdown'}), 'storyboard_v12.md');
  toast('已导出');
}
function exportPrompts(){ copyFullScript(); }
function dlMerged(){
  if (!mergedDataUrl) { toast('请先生成'); return; }
  var a = document.createElement('a');
  a.href = mergedDataUrl;
  a.download = 'storyboard_grid.jpg';
  a.click();
  toast('已下载');
}

function showProc(){
  $('procOv').classList.add('on');
  for (var i = 0; i <= 5; i++) {
    var e = $('ps' + i);
    if (e) {
      e.className = 'pstep';
      e.querySelector('.pstep-i').textContent = '⏳';
    }
  }
  setProg(0);
}
function hideProc(){ $('procOv').classList.remove('on'); }
function upStep(n, st){
  var e = $('ps' + n);
  if (!e) return;
  e.className = 'pstep ' + st;
  e.querySelector('.pstep-i').textContent = st === 'on' ? '🔄' : '✅';
}
function setProg(p){ $('progFill').style.width = p + '%'; }
function slp(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function fmtTime(s){ return ~~(s/60) + ':' + ('0' + ~~(s%60)).slice(-2); }
function cpTxt(t){
  navigator.clipboard.writeText(t).then(function(){
    toast('已复制');
  }).catch(function(){
    var a = document.createElement('textarea');
    a.value = t;
    document.body.appendChild(a);
    a.select();
    document.execCommand('copy');
    document.body.removeChild(a);
    toast('已复制');
  });
}
function toast(m){
  var t = $('toast');
  t.textContent = m;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);
}
function closeFeeModal(){ document.getElementById('feeModal').classList.remove('on'); }
function dlBlob(b,f){
  var u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u;
  a.download = f;
  a.click();
  URL.revokeObjectURL(u);
}

