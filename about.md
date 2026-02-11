插件名称：Vocab Highlighter
技术栈

Chrome Extension Manifest V3
翻译：OpenRouter API（用户自行配置 API Key）
存储：chrome.storage.local


功能一：划词翻译 + 添加生词
交互流程：

用户在网页中选中一个英文单词
选中后弹出一个小浮窗，上面有"翻译并添加"按钮
点击后，插件提取该单词所在的整个段落作为上下文
调用 OpenRouter API，prompt 大致是：

请翻译以下英文单词在该语境中的含义，只返回中文翻译，简洁准确。

段落：{paragraph_text}
单词：{selected_word}

翻译结果返回后，浮窗中显示翻译
自动存入生词本

数据结构：
json{
  "word": "ephemeral",
  "translation": "短暂的、转瞬即逝的",
  "context": "The ephemeral nature of cherry blossoms makes them...",
  "sourceUrl": "https://example.com/article",
  "addedAt": "2026-02-11T10:30:00Z"
}
```

保留原始上下文和来源 URL，后续复习时能回忆起语境。

---

### 功能二：文章生词扫描与标记

**交互流程：**

1. 用户打开新文章，点击插件图标（或 popup 中的"扫描当前页面"按钮）
2. 插件从 storage 读取全部生词列表
3. 遍历页面文本节点，精确匹配生词（使用 `\b` 词边界，大小写不敏感）
4. 匹配到的单词：
   - 加黄色背景高亮
   - 鼠标悬停（hover）时显示 tooltip，内容为中文翻译
5. 页面右上角显示一个小 badge："本页发现 X 个生词"

---

### 功能三：生词本管理（Popup 页面）

- 查看所有已添加的生词列表，显示单词、翻译、添加时间
- 支持删除单词
- 支持手动编辑翻译
- 显示 OpenRouter API Key 配置入口

---

### 项目结构
```
vocab-highlighter/
├── manifest.json
├── background.js            # Service Worker，处理 API 调用
├── content.js               # 内容脚本：划词检测 + 页面扫描标记
├── content.css              # 浮窗样式、高亮样式、tooltip 样式
├── popup.html               # 生词本界面
├── popup.js
├── popup.css
├── options.html             # 设置页（API Key 配置）
├── options.js
└── utils/
    └── api.js               # OpenRouter API 封装

manifest.json 权限要点
json{
  "manifest_version": 3,
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://openrouter.ai/*"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"]
  }]
}

开发优先级
阶段内容P0划词弹出浮窗 → 调用 OpenRouter 翻译 → 存入 storageP1点击插件扫描页面 → 高亮生词 → hover 显示翻译P2Popup 生词本管理界面 + API Key 设置P3后续优化：词形变化匹配、自动扫描、导出生词本