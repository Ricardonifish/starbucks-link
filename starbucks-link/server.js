const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT) || 5173;
// 默认：硅基流动免费 DeepSeek 开源模型（OpenAI 兼容）
const LLM_BASE_URL = (
  process.env.LLM_BASE_URL ||
  process.env.SILICONFLOW_BASE_URL ||
  "https://api.siliconflow.cn/v1"
).replace(/\/$/, "");
const LLM_MODEL =
  process.env.LLM_MODEL ||
  process.env.SILICONFLOW_MODEL ||
  "Qwen/Qwen3-8B";
const DATA_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join("/tmp", "starbucks-link-data")
    : path.join(__dirname, "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

const PLATFORMS = {
  xiaohongshu: {
    name: "小红书",
    style:
      "写成一篇可直接发的小红书笔记：先给吸引人的标题，再写口语化正文，适当用emoji，结尾给3-6个话题标签（#标签）。语气真诚、像真实顾客，不要硬广。",
    publishUrl: "https://www.xiaohongshu.com/explore",
  },
  google: {
    name: "Google Reviews",
    style:
      "写成一条可直接提交的 Google 商家评价：英文为主，1-3 段，真实具体，提到饮品/服务/氛围中的细节，结尾可给总体感受。不要标签，不要emoji堆砌。",
    publishUrl: "https://www.google.com/maps/search/?api=1&query=Starbucks",
  },
  instagram: {
    name: "Instagram",
    style:
      "写成一条可直接发的 Instagram 帖文 caption：先写有画面感的短文，再空一行，最后给 5-10 个相关 hashtag。语气轻松、有品牌感但不假。",
    publishUrl: "https://www.instagram.com/",
  },
  yelp: {
    name: "Yelp",
    style:
      "写成一条可直接发的 Yelp 评价：英文，包含评分感受、到店体验、推荐菜品/饮品、是否愿意再来。结构清晰，像真实食评。",
    publishUrl: "https://www.yelp.com/biz/starbucks-seattle-88",
  },
};

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, "[]", "utf8");
}

function readPosts() {
  ensureDataStore();
  try {
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writePosts(posts) {
  ensureDataStore();
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), "utf8");
}

function resolveApiKey() {
  const key =
    process.env.SILICONFLOW_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    "";
  if (!key || key.startsWith("your_")) return "";
  return key;
}

function buildSystemPrompt(platformKey, lang = "zh") {
  const platform = PLATFORMS[platformKey] || PLATFORMS.xiaohongshu;
  const langRule =
    lang === "en"
      ? "Output language: English (except Xiaohongshu may mix light Chinese hashtags if natural)."
      : "输出语言：中文为主（Google/Yelp/Instagram 可按平台习惯用英文）。";
  return [
    "你是星巴克顾客评价润色助手，不是广告文案机器人。",
    `目标平台：${platform.name}。`,
    platform.style,
    langRule,
    "硬性要求：",
    "1. 必须以用户草稿为核心改写，严格保留情感极性：用户说不好喝/不喜欢/失望，就写成真实差评或吐槽，禁止改成推荐、回购、安利、还会再来。",
    "2. 禁止套固定标题（尤其禁止“咖啡香里的小确幸”“复购向”这类正向模板）。",
    "3. 标题/开头要从用户提到的饮品、场景、感受里长出来；用户没写的细节不要编造。",
    "4. 把短句扩成自然可读成稿，但不要美化负面体验。",
    "5. 若用户给了修改意见，必须按意见重写，并与上一版明显不同。",
    "6. 只输出最终成稿，不要解释，不要加“优化后”前缀，不要输出思考过程、分析步骤、最终选择等元信息。",
  ].join("\n");
}

async function callLLM(messages) {
  const errors = [];
  const siliconKey = resolveApiKey();
  const zhipuKey =
    process.env.ZHIPU_API_KEY ||
    process.env.BIGMODEL_API_KEY ||
    process.env.ZAI_API_KEY ||
    "";
  const groqKey = process.env.GROQ_API_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const POLLINATIONS_URL =
    process.env.POLLINATIONS_URL || "https://text.pollinations.ai/openai";
  const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || "openai";

  async function callOpenAICompatible({ url, key, model, label, extra = {} }) {
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;

    const endpoint = /\/chat\/completions$|\/openai$/.test(url)
      ? url
      : `${url.replace(/\/$/, "")}/chat/completions`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.95,
        max_tokens: 1200,
        ...extra,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        data?.details?.error?.message ||
        `LLM API error (${response.status})`;
      throw new Error(`${label}: ${message}`);
    }

    const message = data?.choices?.[0]?.message || {};
    let content = String(message.content || "").trim();
    if (!content) {
      const reasoning = String(message.reasoning_content || message.reasoning || "").trim();
      if (reasoning) {
        const parts = reasoning.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        content = parts[parts.length - 1] || reasoning;
      }
    }
    content = sanitizeModelOutput(content);
    if (!content) throw new Error(`${label}: 模型返回为空`);
    return content;
  }

  function sanitizeModelOutput(text) {
    let out = String(text || "").trim();
    // 去掉常见思考/元评论残留
    out = out
      .replace(/^[\s\S]*?(?:最终成稿|最终输出|最终选择|可发布文案)\s*[:：]\s*/u, "")
      .replace(/^\d+\.\s*\*\*[^*]+\*\*[:：]?\s*/gm, "")
      .replace(/^(?:这个看起来不错|它忠于情感|以下是|优化后的内容)[^\n]*\n+/u, "")
      .trim();
    // 若仍像分析过程，尽量取最后一个空行后的段落
    if (/最终选择|思考过程|分析步骤|这个看起来/.test(out) && out.includes("\n\n")) {
      const parts = out.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      out = parts[parts.length - 1];
    }
    return out.trim();
  }

  async function callGemini(key) {
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const system = messages.find((m) => m.role === "system")?.content || "";
    const userText = messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.95, maxOutputTokens: 1200 },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`gemini: ${data?.error?.message || response.status}`);
    }
    const content = (data?.candidates || [])
      .map((c) => (c?.content?.parts || []).map((p) => p.text || "").join(""))
      .join("")
      .trim();
    if (!content) throw new Error("gemini: 模型返回为空");
    return content;
  }

  // 1) 智谱 GLM-Flash（国内免费，推荐）
  if (zhipuKey && !zhipuKey.startsWith("your_")) {
    const models = [
      process.env.ZHIPU_MODEL || "glm-4-flash",
      "glm-4-flash-250414",
      "glm-4.7-flash",
    ];
    for (const model of models) {
      try {
        const content = await callOpenAICompatible({
          url: "https://open.bigmodel.cn/api/paas/v4",
          key: zhipuKey,
          model,
          label: "zhipu",
          extra: { thinking: { type: "disabled" } },
        });
        return { content, provider: "zhipu", model };
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  // 2) Groq（国外免费，国内常不可用）
  if (groqKey && !groqKey.startsWith("your_")) {
    try {
      const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
      const content = await callOpenAICompatible({
        url: "https://api.groq.com/openai/v1",
        key: groqKey,
        model,
        label: "groq",
      });
      return { content, provider: "groq", model };
    } catch (error) {
      errors.push(error.message);
    }
  }

  // 3) Gemini
  if (geminiKey && !geminiKey.startsWith("your_")) {
    try {
      const content = await callGemini(geminiKey);
      return {
        content,
        provider: "gemini",
        model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  // 4) 硅基流动
  if (siliconKey) {
    try {
      const content = await callOpenAICompatible({
        url: LLM_BASE_URL,
        key: siliconKey,
        model: LLM_MODEL,
        label: "siliconflow",
      });
      return { content, provider: "siliconflow", model: LLM_MODEL };
    } catch (error) {
      errors.push(error.message);
    }
  }

  // 5) Pollinations 匿名（不稳定）
  for (let i = 0; i < 2; i += 1) {
    try {
      const content = await callOpenAICompatible({
        url: POLLINATIONS_URL,
        key: "",
        model: POLLINATIONS_MODEL,
        label: "pollinations",
      });
      return { content, provider: "pollinations", model: POLLINATIONS_MODEL };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.join(" | ") || "所有 LLM 通道均失败");
}

function detectTopics(text) {
  const drinks = [];
  const pairs = [
    [/冰美式|美式|americano/i, "冰美式"],
    [/拿铁|latte/i, "拿铁"],
    [/澳白|flat white/i, "澳白"],
    [/摩卡|mocha/i, "摩卡"],
    [/卡布|cappuccino/i, "卡布奇诺"],
    [/冷萃|cold brew/i, "冷萃"],
    [/星冰乐|frappuccino/i, "星冰乐"],
    [/抹茶/i, "抹茶"],
    [/红茶|茶底|茶拿铁/i, "茶饮"],
  ];
  for (const [re, name] of pairs) {
    if (re.test(text)) drinks.push(name);
  }

  const negative =
    /不喜欢|不好喝|难吃|难喝|踩雷|劝退|失望|糟糕|无语|别去|太甜|太苦|一般|差评|后悔|难喝|难以下咽|店面.*不|环境.*差|装修.*差|贵|慢|差/.test(
      text
    );
  const positive =
    !negative && /好喝|不错|推荐|喜欢|满意|很香|很稳|真棒|好吃|回购|安利/.test(text);

  return {
    drinks,
    mentionsSeat: /位置|座位|坐下|办公|学习|充电/.test(text),
    mentionsService: /服务|店员|态度|热情|礼貌/.test(text),
    mentionsVibe: /环境|氛围|舒服|安静|嘈杂|装修|店面|门店/.test(text),
    positive,
    negative,
    wantsShort: /短|精简|简洁|少一点|少用/.test(text),
    wantsFewerEmoji: /少.*emoji|不要emoji|少表情/.test(text),
    wantsMoreOral: /口语|随便|更自然|人话/.test(text),
  };
}

function pickTitle(topics, draft) {
  const drink = topics.drinks[0];
  const pool = [];

  if (topics.negative) {
    if (drink) pool.push(`这杯${drink}有点踩雷`, `${drink}这次不太行`);
    if (topics.mentionsVibe) pool.push("店面氛围差点意思");
    pool.push("这次体验一言难尽", "说实话有点失望", "先吐槽为敬");
  } else {
    if (drink && topics.positive) pool.push(`${drink}真的可以｜星巴克小记`, `今日份${drink}｜Starbucks`);
    if (drink) pool.push(`点了杯${drink}来续命`, `${drink}打卡 · Starbucks`);
    if (topics.mentionsSeat) pool.push("找到一个适合久坐的角落");
    if (topics.mentionsVibe) pool.push("这家星巴克气氛刚刚好");
    pool.push("来杯咖啡，慢半拍", "Starbucks 随手记");
  }

  const seed = `${draft}|${topics.negative ? "neg" : "pos"}|${Date.now() % 7}`;
  const idx = Math.abs([...seed].reduce((s, c) => s + c.charCodeAt(0), 0)) % pool.length;
  return pool[idx];
}

function expandBody(draft, topics, feedback) {
  const combined = `${draft}\n${feedback || ""}`;
  const liveTopics = detectTopics(combined);
  const sentences = draft
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const parts = [];
  const drink = liveTopics.drinks[0];

  if (liveTopics.negative) {
    const s = (sentences[0] || draft).replace(/[。！？]$/, "");
    if (drink) {
      parts.push(`今天在星巴克点了${drink}。${s}。`);
    } else {
      parts.push(`今天去了趟星巴克。${s}。`);
    }
    if (/店面|环境|装修|门店/.test(combined)) {
      parts.push("店面也没给我加分，待着不舒服。");
    }
    parts.push("整体不太符合预期，个人不太推荐这次的体验。");
  } else if (sentences.length === 1 && sentences[0].length < 24) {
    const s = sentences[0].replace(/[。！？]$/, "");
    if (drink) {
      parts.push(`路过星巴克，点了一杯${drink}。${s}，一口下去很对味。`);
    } else {
      parts.push(`今天去了趟星巴克。${s}，整体感觉值得记一笔。`);
    }
    if (liveTopics.mentionsSeat) {
      parts.push("有位置能坐下慢慢喝，对我这种想歇脚的人刚刚好。");
    } else if (liveTopics.mentionsVibe) {
      parts.push("环境这一块也加分，待着不累。");
    } else if (liveTopics.positive) {
      parts.push("店里节奏不紧不慢，坐一会儿也不会觉得赶。");
    }
    if (liveTopics.positive) {
      parts.push(drink ? `下次说不定会换别的试试，不过这杯${drink}已经够我想回购了。` : "下次路过大概率还会再进来坐坐。");
    }
  } else {
    parts.push(sentences.map((s) => (/[。！？]$/.test(s) ? s : `${s}。`)).join(""));
    if (liveTopics.positive && !liveTopics.negative) {
      parts.push(drink ? `这杯${drink}我会考虑再点。` : "整体还行，愿意再来试试。");
    }
  }

  let body = parts.join("");

  if (feedback) {
    const fb = detectTopics(feedback);
    if (fb.wantsShort) {
      body = parts.slice(0, Math.min(2, parts.length)).join("");
    }
    if (fb.wantsMoreOral && !liveTopics.negative) {
      body = `${body}说白了就是挺适合日常来一杯。`;
    }
  }

  return body.replace(/\s+/g, " ").replace(/\s+([，。！？])/g, "$1").trim();
}

function buildTags(topics, platform) {
  if (platform === "instagram") {
    const tags = ["#Starbucks", "#CoffeeTime"];
    if (topics.drinks[0]) tags.push(`#${topics.drinks[0].replace(/\s/g, "")}`);
    if (topics.negative) tags.push("#HonestReview");
    else tags.push("#CafeVibes", "#DailyCup");
    return tags.slice(0, 8).join(" ");
  }
  const tags = ["#星巴克", "#Starbucks"];
  if (topics.drinks[0]) tags.push(`#${topics.drinks[0]}`);
  tags.push("#咖啡");
  if (topics.negative) tags.push("#真实评价", "#踩雷避雷");
  else {
    tags.push("#探店");
    if (topics.positive) tags.push("#今日饮品");
  }
  return tags.slice(0, 6).join(" ");
}

function localPolish({ platform, draft, feedback, previous, revision = 0 }) {
  const source = (draft || "").trim() || (previous || "").trim() || "今天在星巴克点了一杯咖啡";
  const topics = detectTopics(`${source}\n${feedback || ""}\n${previous || ""}`);
  const reviseSeed = `${previous || ""}|${feedback || ""}|${revision}|${Date.now()}`;

  if (platform === "xiaohongshu") {
    const title = pickTitle(topics, reviseSeed);
    let body = expandBody(source, topics, feedback);
    const tags = buildTags(topics, platform);

    if (previous || revision > 0) {
      const round = Number(revision) || 1;
      const prefixes = topics.negative
        ? ["吐槽向", "真实差评", "避雷记录", "不太满意"]
        : ["换个说法", "再写一版", "补充感受", "重新整理"];
      const prefix = prefixes[(round - 1) % prefixes.length];
      // 再改时追加一句，确保肉眼可见变化
      if (topics.negative) {
        body += round % 2 === 0 ? "这次不会安利给朋友。" : "个人体验，仅供参考。";
      } else {
        body += round % 2 === 0 ? "先记在这里，回头对比看看。" : "写给和我口味接近的人。";
      }
      return [`${prefix}｜${title}`, "", body, "", tags].join("\n");
    }
    return [title, "", body, "", tags].join("\n");
  }

  if (platform === "instagram") {
    const body = expandBody(source, topics, feedback);
    return [`${body}`, "", buildTags(topics, "instagram")].join("\n");
  }

  if (platform === "yelp") {
    const drink = topics.drinks[0] || "coffee";
    const tone = topics.negative ? "Disappointing" : topics.positive ? "Enjoyable" : "Mixed";
    return [
      `${tone} Starbucks stop — ${drink}`,
      "",
      expandBody(source, topics, feedback),
      "",
      topics.negative
        ? "Would not reorder this one."
        : topics.positive
          ? "I'd come back for the same order."
          : "Might try a different drink next time.",
    ].join("\n");
  }

  return [
    expandBody(source, topics, feedback),
    "",
    topics.negative
      ? "Not my favorite visit — sharing an honest take."
      : topics.positive
        ? "Friendly enough experience overall — would visit again."
        : "Okay for a quick stop; room to improve.",
  ].join("\n");
}

app.get("/api/health", (_req, res) => {
  const zhipuKey = process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || "";
  res.json({
    ok: true,
    providers: ["zhipu", "groq", "gemini", "siliconflow", "pollinations", "local-fallback"],
    zhipu: {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: process.env.ZHIPU_MODEL || "glm-4.7-flash",
      hasServerKey: Boolean(zhipuKey && !zhipuKey.startsWith("your_")),
      free: true,
    },
    siliconflow: {
      baseUrl: LLM_BASE_URL,
      model: LLM_MODEL,
      hasServerKey: Boolean(resolveApiKey()),
    },
  });
});

app.get("/api/platforms", (_req, res) => {
  res.json(PLATFORMS);
});

app.post("/api/polish", async (req, res) => {
  try {
    const { platform = "xiaohongshu", draft = "", feedback = "", previous = "", lang = "zh", revision = 0 } = req.body || {};
    if (!String(draft).trim() && !String(previous).trim()) {
      return res.status(400).json({ error: "请先写一点你的体验/评论" });
    }

    const system = buildSystemPrompt(platform, lang === "en" ? "en" : "zh");
    const userParts = [];

    if (previous) {
      userParts.push(`上一版文案：\n${previous}`);
      userParts.push(
        `请重新生成第 ${Number(revision) || 1} 版，必须与上一版明显不同（换标题、换结构、换措辞）。${
          feedback
            ? `修改要求：${feedback}`
            : "在保留原意和情感极性的前提下换一种写法。"
        }`
      );
      userParts.push(`原始体验素材：\n${draft || "（沿用上一版信息）"}`);
      userParts.push("再次强调：若素材是负面评价，不要写成推荐或回购。");
    } else {
      userParts.push(`请把下面的顾客草稿润色成可发布内容：\n${draft}`);
      userParts.push("若草稿是负面评价，请写成真实吐槽/差评，不要美化成安利。");
      userParts.push("直接输出成稿正文，不要输出任何分析、思考或“最终选择”。");
    }

    const messages = [
      { role: "system", content: system },
      { role: "user", content: userParts.join("\n\n") },
    ];

    try {
      const result = await callLLM(messages);
      return res.json({
        content: result.content,
        provider: result.provider,
        model: result.model,
      });
    } catch (apiError) {
      const content = localPolish({ platform, draft, feedback, previous, revision });
      return res.json({
        content,
        provider: "local-fallback",
        notice: `当前无法调用 LLM（${apiError.message}）。请配置国内免费智谱 Key：https://bigmodel.cn/usercenter/proj-mgmt/apikeys （写入 .env 的 ZHIPU_API_KEY）；已临时使用本地润色。`,
      });
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "润色失败" });
  }
});

app.post("/api/publish", (req, res) => {
  try {
    const { platform = "xiaohongshu", draft = "", content = "", title = "" } = req.body || {};
    if (!String(content).trim()) {
      return res.status(400).json({ error: "没有可发布的内容" });
    }

    const platformMeta = PLATFORMS[platform] || PLATFORMS.xiaohongshu;
    const post = {
      id: `post_${Date.now()}`,
      platform,
      platformName: platformMeta.name,
      title: title || `${platformMeta.name} · Starbucks`,
      draft,
      content: String(content).trim(),
      publishUrl: platformMeta.publishUrl,
      createdAt: new Date().toISOString(),
      status: "published",
    };

    const posts = readPosts();
    posts.unshift(post);
    writePosts(posts.slice(0, 100));

    res.json({
      ok: true,
      post,
      message: `已确认发表到「${platformMeta.name}」流程：文案已保存，并会打开对应平台。`,
      // 各平台无统一开放发帖 API，这里完成：保存成稿 + 打开平台发布入口 + 前端自动复制
      autoActions: {
        copyToClipboard: true,
        openPublishUrl: platformMeta.publishUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "发布失败" });
  }
});

app.get("/api/posts", (_req, res) => {
  res.json({ posts: readPosts() });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Starbucks Link running at http://localhost:${PORT}`);
    console.log(`Compose page: http://localhost:${PORT}/compose.html`);
    console.log(`LLM: ${LLM_MODEL} @ ${LLM_BASE_URL}`);
  });
}

module.exports = app;
