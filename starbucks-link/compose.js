const params = new URLSearchParams(window.location.search);
const platform = params.get("platform") || "xiaohongshu";

/** 各平台「发帖/写评价」入口（前端同步打开，避免被弹窗拦截） */
const PUBLISH_URLS = {
  xiaohongshu: "https://creator.xiaohongshu.com/publish/imgNote",
  google: "https://www.google.com/maps/search/?api=1&query=Starbucks",
  instagram: "https://www.instagram.com/",
  yelp: "https://www.yelp.com/biz/starbucks-seattle-88",
};

let revision = 0;

function $(id) {
  return document.getElementById(id);
}

function t(key) {
  return window.SB_I18N ? window.SB_I18N.t(key) : key;
}

function syncPlatformLabel() {
  const el = $("platformName");
  if (el) el.textContent = t(`platform.${platform}`);
}

function setStatus(message, type = "") {
  const statusLine = $("statusLine");
  if (!statusLine) return;
  statusLine.textContent = message || "";
  statusLine.className = `status-line${type ? ` ${type}` : ""}`;
}

function setBusy(busy) {
  ["polishBtn", "reviseBtn", "publishBtn"].forEach((id) => {
    const btn = $(id);
    if (btn) btn.disabled = Boolean(busy);
  });
}

function flashResult() {
  const result = $("result");
  if (!result) return;
  result.classList.remove("result-flash");
  // restart animation
  void result.offsetWidth;
  result.classList.add("result-flash");
  result.focus();
  result.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** 优先同步复制，保证仍在用户点击手势内，手机/电脑都更稳 */
function copyTextNow(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function copyText(text) {
  if (copyTextNow(text)) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const result = $("result");
    if (result) {
      result.focus();
      result.select();
    }
    return false;
  }
}

function openPublishPage(url) {
  if (!url) return null;
  const openPlatformBtn = $("openPlatformBtn");
  if (openPlatformBtn) openPlatformBtn.href = url;
  // 在点击链路里尽快打开，降低弹窗拦截概率
  return window.open(url, "_blank", "noopener,noreferrer");
}

async function callPolish({ revise }) {
  const draft = ($("draft")?.value || "").trim();
  const previous = ($("result")?.value || "").trim();
  const feedback = ($("feedback")?.value || "").trim();

  if (!revise && !draft) {
    setStatus(t("compose.needDraft"), "error");
    $("draft")?.focus();
    return null;
  }
  if (revise && !previous) {
    setStatus(t("compose.needResult"), "error");
    return null;
  }

  const body = {
    platform,
    draft: draft || previous,
    previous: revise ? previous : "",
    feedback: revise
      ? feedback || "请换一种结构重新写，保留原意和情感极性，不要和上一版雷同"
      : "",
    lang: window.SB_I18N ? window.SB_I18N.getLang() : "zh",
    revise: Boolean(revise),
    revision: revise ? revision + 1 : 0,
  };

  const response = await fetch("/api/polish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || t("compose.fail"));

  let next = (data.content || "").trim();
  if (!next) throw new Error(t("compose.fail"));

  // 再改却几乎没变：强制再请求一次
  if (revise && previous && (next === previous || similarText(previous, next))) {
    const retry = await fetch("/api/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        revision: revision + 2,
        feedback: `${body.feedback}；必须换标题和正文，禁止复用上一版句子`,
      }),
    });
    const retryData = await retry.json();
    if (retry.ok && retryData.content) {
      next = String(retryData.content).trim();
      data.provider = retryData.provider || data.provider;
      data.notice = retryData.notice || data.notice;
    }
  }

  return { data, next, revise };
}

function similarText(a, b) {
  const na = a.replace(/\s+/g, "");
  const nb = b.replace(/\s+/g, "");
  if (na === nb) return true;
  // 只换了标题前缀时，也视为太像，需要再改
  const strip = (s) =>
    s
      .replace(/^【?复购向】?|^吐槽向｜|^换个说法｜/u, "")
      .replace(/\s+/g, "");
  return strip(na) === strip(nb);
}

async function requestPolish({ revise = false } = {}) {
  setBusy(true);
  setStatus(revise ? t("compose.revising") : t("compose.polishing"));

  try {
    const packed = await callPolish({ revise });
    if (!packed) return;

    const { data, next } = packed;
    const result = $("result");
    const resultSection = $("resultSection");
    const successSection = $("successSection");
    const providerTag = $("providerTag");

    if (result) result.value = next;
    if (resultSection) resultSection.hidden = false;
    if (successSection) successSection.hidden = true;

    if (revise) revision += 1;

    if (providerTag) {
      providerTag.textContent =
        data.provider === "local-fallback"
          ? `${t("compose.localTag")}${revision ? ` · v${revision + 1}` : ""}`
          : `AI · ${data.provider}${revision ? ` · v${revision + 1}` : ""}`;
    }

    if (data.provider === "local-fallback" && data.notice) {
      setStatus(
        revise ? `${t("compose.revised")}（本地润色）` : `${t("compose.done")}（本地润色）`,
        "ok"
      );
    } else {
      setStatus(revise ? t("compose.revised") : t("compose.done"), "ok");
    }

    flashResult();
  } catch (error) {
    setStatus(error.message || t("compose.fail"), "error");
  } finally {
    setBusy(false);
  }
}

async function requestPublish() {
  const content = ($("result")?.value || "").trim();
  if (!content) {
    setStatus(t("compose.noContent"), "error");
    return;
  }

  const publishUrl = PUBLISH_URLS[platform] || PUBLISH_URLS.xiaohongshu;

  // 1) 先复制（仍在点击手势里）
  const copied = await copyText(content);
  if (copied) {
    setStatus(t("compose.copiedOk"), "ok");
  } else {
    setStatus(t("compose.copyFail"), "error");
  }

  // 2) 立刻打开发布页（小红书 = 创作者中心图文发布）
  openPublishPage(publishUrl);

  setBusy(true);
  setStatus(copied ? t("compose.publishing") : t("compose.copyFail"), copied ? "" : "error");

  try {
    const response = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        draft: ($("draft")?.value || "").trim(),
        content,
        title: t(`platform.${platform}`),
        lang: window.SB_I18N ? window.SB_I18N.getLang() : "zh",
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("compose.fail"));

    // 服务端若返回更新后的发布链接，刷新按钮
    const serverUrl = data?.post?.publishUrl || data?.autoActions?.openPublishUrl;
    if (serverUrl && $("openPlatformBtn")) {
      $("openPlatformBtn").href = serverUrl;
    }

    const successMsg = $("successMsg");
    const successSection = $("successSection");
    if (successMsg) {
      successMsg.textContent = copied
        ? `${data.message || t("compose.published")} ${t("compose.pasteTip")}`
        : t("compose.copyFail");
    }
    if (successSection) {
      successSection.hidden = false;
      successSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setStatus(copied ? t("compose.published") : t("compose.copyFail"), copied ? "ok" : "error");
  } catch (error) {
    // 即使存档失败，复制+跳转已完成，仍提示可粘贴
    setStatus(
      copied
        ? `${t("compose.published")}（${error.message || t("compose.fail")}）`
        : error.message || t("compose.fail"),
      copied ? "ok" : "error"
    );
    const successSection = $("successSection");
    if (successSection) successSection.hidden = false;
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  // 事件委托：避免 hidden/重渲染导致按钮点不动
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, a.btn");
    if (!target) return;

    if (target.id === "polishBtn") {
      event.preventDefault();
      requestPolish({ revise: false });
      return;
    }
    if (target.id === "reviseBtn") {
      event.preventDefault();
      requestPolish({ revise: true });
      return;
    }
    if (target.id === "publishBtn") {
      event.preventDefault();
      requestPublish();
    }
  });

  window.addEventListener("sb:langchange", syncPlatformLabel);
  syncPlatformLabel();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindEvents);
} else {
  bindEvents();
}

// 方便控制台调试
window.__composeDebug = { requestPolish, requestPublish };
