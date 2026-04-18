# 🐱 SoulPet 灵伴 - AI 效率桌宠

> **真正的桌面应用**——透明窗口悬浮在桌面上，不是浏览器里的网页。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/Electron-33-brightgreen)
![React](https://img.shields.io/badge/React-18-61dafb)

## 🚀 30秒启动

```bash
# 1. 解压项目
tar -xzf soulpet-v0.1.0.tar.gz -C soulpet
cd soulpet

# 2. 安装依赖
npm install

# 3. 启动桌面应用（不是浏览器！）
npm run electron:dev
```

启动后你会看到：
- 🐱 一只猫咪出现在桌面右下角（透明背景，无边框）
- 可以用鼠标拖拽它到桌面任意位置
- 单击：桌宠做出反应 + 爱心特效
- 双击：打开对话面板
- 右下角系统托盘有图标，右键可操作
- 快捷键 `Alt+P`：显示/隐藏桌宠

## ✨ 功能一览

| 功能 | 状态 | 说明 |
|------|------|------|
| 🖥️ 桌面透明窗口 | ✅ 完成 | Electron 透明无边框，全局置顶，鼠标穿透 |
| 🐱 桌宠动画 | ✅ 完成 | 16 种行为动画 + 粒子特效（CSS版，后续替换Live2D） |
| 💬 AI 对话 | ✅ 完成 | GPT-5.4 / Gemini 双引擎，角色扮演 + Function Calling |
| 💧 智能提醒 | ✅ 完成 | 喝水/站立/护眼提醒，带进度条，可延迟/关闭 |
| ❤️ 情绪系统 | ✅ 完成 | 3维连续情绪模型，影响对话风格和动画 |
| 📈 成长体系 | ✅ 完成 | 20级 + 8成就 + 经验值 |
| 🧬 性格养成 | ✅ 完成 | 5维性格，30天养成后固化 |
| 👗 换肤系统 | ✅ 完成 | 6皮肤 + 5饰品，条件解锁 |
| 📅 飞书联动 | 🔨 框架 | Function Tools 已定义，待接真实 API |
| 📊 数据分析 | 🔨 框架 | 分析工具已定义，待接 Code Interpreter |
| 🎤 语音交互 | 📋 计划 | 下一阶段 |
| 🌐 Live2D | 📋 计划 | 当前用 emoji+CSS，后续替换为 Live2D |

## 🏗️ 项目结构

```
soulpet/
├── electron/
│   ├── main.js              # 🖥️ Electron 主进程（透明窗口核心）
│   └── preload.js           # 🔌 IPC 桥接（拖拽、穿透、屏幕信息）
├── scripts/
│   └── wait-and-launch.js   # 开发模式启动脚本
├── src/
│   ├── engine/              # 🧠 四大核心引擎
│   │   ├── PetEngine.ts     #   情绪 + 性格 + 成长 + 行为状态机
│   │   ├── ChatEngine.ts    #   AI 对话 + Function Calling
│   │   ├── ReminderEngine.ts#   智能提醒调度
│   │   └── SkinManager.ts   #   皮肤换装管理
│   ├── components/          # 🎨 UI 组件
│   │   ├── PetCharacter.tsx  #   桌宠主体（拖拽=移动窗口）
│   │   ├── ChatPanel.tsx     #   对话面板
│   │   ├── ReminderPopup.tsx #   提醒弹窗
│   │   ├── StatusPanel.tsx   #   状态面板
│   │   ├── SettingsPanel.tsx #   设置面板
│   │   └── BubbleMessage.tsx #   气泡消息
│   ├── services/
│   │   └── store.ts          # 🏪 Zustand 全局状态
│   ├── styles/
│   │   └── animations.css    # 🎬 16种桌宠动画
│   ├── App.tsx               # 📱 主应用（穿透控制+托盘联动）
│   └── main.tsx              # 🚀 入口
├── electron-builder.yml      # 📦 打包配置
├── package.json
└── README.md
```

## 🖥️ 桌面体验的关键技术

### 透明窗口
```javascript
// electron/main.js
mainWindow = new BrowserWindow({
  transparent: true,          // 窗口透明
  frame: false,               // 无边框
  hasShadow: false,           // 无阴影
  backgroundColor: '#00000000', 
  alwaysOnTop: true,          // 全局置顶
  skipTaskbar: true,          // 不在任务栏显示
});
mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
```

### 鼠标穿透
```javascript
// 空白区域穿透，桌宠本体可点击
// forward: true 允许穿透状态下仍能检测 mouseenter 事件
mainWindow.setIgnoreMouseEvents(true, { forward: true });

// 鼠标进入桌宠区域时恢复
mainWindow.setIgnoreMouseEvents(false);
```

### 拖拽 = 移动窗口
```javascript
// 渲染进程计算鼠标位移
const deltaX = e.screenX - lastPos.x;
const deltaY = e.screenY - lastPos.y;
// 通过 IPC 让主进程移动窗口
electronAPI.moveWindowBy(deltaX, deltaY);
```

## ⚙️ 配置 AI 引擎

启动后点底部 ⚙️ → AI引擎 → 填入 API Key：

| 引擎 | 获取 Key | 推荐模型 |
|------|----------|----------|
| OpenAI | [platform.openai.com](https://platform.openai.com) | gpt-5.4 / gpt-4o |
| Gemini | [aistudio.google.com](https://aistudio.google.com) | gemini-1.5-pro |
| 豆包 | 火山引擎控制台 | doubao-pro-32k |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) | deepseek-chat |

> 支持任何 OpenAI 兼容 API，填写 Base URL 即可。

## 📦 打包发布

```bash
# Windows 安装包（.exe）
npm run electron:build:win

# macOS 安装包（.dmg）
npm run electron:build:mac

# 输出在 release/ 目录
```

## 🎯 用 Trae 继续开发

在 Trae 中打开项目后，按优先级给 AI 以下指令：

| 优先级 | 指令 | 效果 |
|--------|------|------|
| **P0** | "帮我用 pixi-live2d-display 替换 PetCharacter 中的 emoji，使用 hiyori 开源模型" | 真正的 Live2D 角色 |
| **P0** | "实现飞书 OAuth 2.0 登录流程，在设置面板添加飞书授权按钮" | 飞书联动基础 |
| **P1** | "实现 ChatEngine 中 feishu_calendar_today 工具的真实 API 调用" | 日程查询 |
| **P1** | "实现拖拽文件到桌宠窗口触发数据分析" | 数据分析 |
| **P2** | "集成 Web Speech API 实现语音对话" | 语音交互 |
| **P2** | "添加桌宠在桌面边缘行走的路径规划" | 更真实的行为 |

## 🔑 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + P` | 显示/隐藏桌宠 |
| `Alt + Shift + P` | 打开对话 |
| 系统托盘右键 | 完整菜单 |

---

Built with ❤️ using Electron + React + TypeScript + AI
