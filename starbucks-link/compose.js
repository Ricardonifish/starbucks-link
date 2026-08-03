const params = new URLSearchParams(window.location.search);
const platform = params.get("platform") || "xiaohongshu";

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

  setBusy(true);
  setStatus(t("compose.publishing"));

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

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // ignore
    }

    const publishUrl = data?.post?.publishUrl || data?.autoActions?.openPublishUrl;
    const openPlatformBtn = $("openPlatformBtn");
    if (publishUrl && openPlatformBtn) {
      openPlatformBtn.href = publishUrl;
      window.open(publishUrl, "_blank", "noopener");
    }

    const successMsg = $("successMsg");
    const successSection = $("successSection");
    if (successMsg) successMsg.textContent = data.message || t("compose.published");
    if (successSection) {
      successSection.hidden = false;
      successSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setStatus(t("compose.published"), "ok");
  } catch (error) {
    setStatus(error.message || t("compose.fail"), "error");
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
