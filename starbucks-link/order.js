(() => {
  const params = new URLSearchParams(window.location.search);
  const table = (params.get("table") || params.get("desk") || "").trim();
  const fromQr = params.has("qr") || params.get("from") === "qr" || Boolean(table);

  let lang = localStorage.getItem("sb_order_lang");
  if (lang !== "zh" && lang !== "en") {
    lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  let menu = null;
  let activeCat = null;
  let cart = loadCart();
  let draft = null; // current spec sheet item

  const $ = (id) => document.getElementById(id);

  function tName(obj) {
    if (!obj) return "";
    return lang === "zh" ? obj.nameZh || obj.name : obj.name || obj.nameZh;
  }

  function tDesc(obj) {
    if (!obj) return "";
    return lang === "zh" ? obj.descZh || obj.desc || "" : obj.desc || obj.descZh || "";
  }

  function tTag(obj) {
    if (!obj) return "";
    return lang === "zh" ? obj.tagZh || obj.tag || "" : obj.tag || obj.tagZh || "";
  }

  function money(n) {
    const cur = menu?.currency || "¥";
    return `${cur}${Number(n).toFixed(Number.isInteger(n) ? 0 : 2)}`;
  }

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 1800);
  }

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("sb_cart_v1") || "[]");
    } catch {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem("sb_cart_v1", JSON.stringify(cart));
    renderCartBar();
  }

  function cartCount() {
    return cart.reduce((s, x) => s + x.qty, 0);
  }

  function cartTotal() {
    return Math.round(cart.reduce((s, x) => s + x.unitPrice * x.qty, 0) * 100) / 100;
  }

  function findItem(itemId) {
    for (const cat of menu.categories || []) {
      const hit = (cat.items || []).find((i) => i.id === itemId);
      if (hit) return { item: hit, category: cat };
    }
    return null;
  }

  function optionGroupsFor(categoryId) {
    return (menu.optionGroups || []).filter((g) => (g.appliesTo || []).includes(categoryId));
  }

  async function loadMenu() {
    const res = await fetch("/api/menu");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "菜单加载失败");
    menu = data.menu;
    activeCat = menu.categories?.[0]?.id || null;
    renderStore();
    renderCats();
    renderMenu();
    renderCartBar();
  }

  function renderStore() {
    const store = menu.store || {};
    $("storeName").textContent = tName(store) || "Starbucks";
    $("storeKicker").textContent = fromQr
      ? lang === "zh"
        ? "扫码点单"
        : "Scan to order"
      : lang === "zh"
        ? store.taglineZh || "在线点单"
        : store.tagline || "Order online";

    const bits = [];
    if (table) bits.push(lang === "zh" ? `桌号 ${table}` : `Table ${table}`);
    bits.push(lang === "zh" ? store.hoursZh || store.hours : store.hours || store.hoursZh);
    $("storeSub").textContent = bits.filter(Boolean).join(" · ");
    $("langBtn").textContent = lang === "zh" ? "EN" : "中文";
    document.title = lang === "zh" ? "扫码点单 · Starbucks" : "Order · Starbucks";
  }

  function renderCats() {
    const wrap = $("catList");
    wrap.innerHTML = "";
    (menu.categories || []).forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cat-btn${cat.id === activeCat ? " active" : ""}`;
      btn.textContent = tName(cat);
      btn.addEventListener("click", () => {
        activeCat = cat.id;
        renderCats();
        const section = document.getElementById(`sec-${cat.id}`);
        section?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      wrap.appendChild(btn);
    });
  }

  function renderMenu() {
    const root = $("menuSections");
    root.innerHTML = "";
    (menu.categories || []).forEach((cat) => {
      const sec = document.createElement("section");
      sec.className = "menu-section";
      sec.id = `sec-${cat.id}`;
      sec.innerHTML = `<h2>${tName(cat)}</h2>`;
      (cat.items || []).forEach((item) => {
        const row = document.createElement("article");
        row.className = "item";
        const tag = tTag(item);
        row.innerHTML = `
          <div class="item-art" style="background:${item.color || "#1E3932"}">${item.emoji || "★"}</div>
          <div class="item-body">
            <h3>${tName(item)}${tag ? `<span class="tag">${tag}</span>` : ""}</h3>
            <p>${tDesc(item)}</p>
            <p class="item-price">${money(item.price)}</p>
          </div>
          <button type="button" class="add-btn" aria-label="添加">+</button>
        `;
        row.querySelector(".add-btn").addEventListener("click", () => openSpec(item, cat));
        sec.appendChild(row);
      });
      root.appendChild(sec);
    });
  }

  function openSpec(item, category) {
    const groups = optionGroupsFor(category.id);
    const selected = {};
    groups.forEach((g) => {
      selected[g.id] = g.choices?.[0]?.id || null;
    });
    draft = { item, category, selected, qty: 1, note: "" };
    $("specHero").style.background = item.color || "#1E3932";
    $("specHero").textContent = item.emoji || "★";
    $("specTitle").textContent = tName(item);
    $("specDesc").textContent = tDesc(item);
    $("itemNote").value = "";
    $("qtyValue").textContent = "1";
    renderSpecOptions();
    updateAddBtn();
    $("specSheet").hidden = false;
  }

  function renderSpecOptions() {
    const wrap = $("specOptions");
    wrap.innerHTML = "";
    const groups = optionGroupsFor(draft.category.id);
    groups.forEach((g) => {
      const box = document.createElement("div");
      box.className = "opt-group";
      box.innerHTML = `<h3>${tName(g)}</h3>`;
      const row = document.createElement("div");
      row.className = "opt-row";
      (g.choices || []).forEach((c) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `chip${draft.selected[g.id] === c.id ? " active" : ""}`;
        const extra = c.price ? ` +${money(c.price)}` : "";
        chip.textContent = `${tName(c)}${extra}`;
        chip.addEventListener("click", () => {
          draft.selected[g.id] = c.id;
          renderSpecOptions();
          updateAddBtn();
        });
        row.appendChild(chip);
      });
      box.appendChild(row);
      wrap.appendChild(box);
    });
  }

  function calcUnitPrice() {
    if (!draft) return 0;
    let price = Number(draft.item.price) || 0;
    const groups = optionGroupsFor(draft.category.id);
    groups.forEach((g) => {
      const choice = (g.choices || []).find((c) => c.id === draft.selected[g.id]);
      if (choice) price += Number(choice.price) || 0;
    });
    return price;
  }

  function selectedOptionLabels() {
    const labels = {};
    const groups = optionGroupsFor(draft.category.id);
    groups.forEach((g) => {
      const choice = (g.choices || []).find((c) => c.id === draft.selected[g.id]);
      if (choice) labels[g.id] = tName(choice);
    });
    return labels;
  }

  function updateAddBtn() {
    const unit = calcUnitPrice();
    const qty = draft?.qty || 1;
    $("addCartBtn").textContent =
      lang === "zh"
        ? `加入购物车 · ${money(unit * qty)}`
        : `Add · ${money(unit * qty)}`;
  }

  function addToCart() {
    if (!draft) return;
    const unitPrice = calcUnitPrice();
    const options = selectedOptionLabels();
    const note = ($("itemNote").value || "").trim();
    const key = JSON.stringify({
      id: draft.item.id,
      selected: draft.selected,
      note,
    });
    const existing = cart.find((x) => x.key === key);
    if (existing) {
      existing.qty += draft.qty;
    } else {
      cart.push({
        key,
        id: draft.item.id,
        name: tName(draft.item),
        qty: draft.qty,
        unitPrice,
        options,
        note,
      });
    }
    saveCart();
    $("specSheet").hidden = true;
    toast(lang === "zh" ? "已加入购物车" : "Added to cart");
  }

  function renderCartBar() {
    const count = cartCount();
    const bar = $("cartBar");
    if (!count) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    $("cartCount").textContent = String(count);
    $("cartTotalLabel").textContent = money(cartTotal());
    $("checkoutBtn").textContent = lang === "zh" ? "去结算" : "Checkout";
  }

  function renderCartSheet() {
    const wrap = $("cartItems");
    if (!cart.length) {
      wrap.innerHTML = `<p class="empty">${lang === "zh" ? "购物车是空的" : "Cart is empty"}</p>`;
      return;
    }
    wrap.innerHTML = "";
    cart.forEach((line, idx) => {
      const opts = Object.values(line.options || {}).join(" / ");
      const el = document.createElement("div");
      el.className = "cart-line";
      el.innerHTML = `
        <div>
          <h3>${line.name} × ${line.qty}</h3>
          <p>${[opts, line.note].filter(Boolean).join(" · ")}</p>
        </div>
        <div class="cart-line-price">${money(line.unitPrice * line.qty)}</div>
      `;
      el.addEventListener("dblclick", () => {
        cart.splice(idx, 1);
        saveCart();
        renderCartSheet();
      });
      wrap.appendChild(el);
    });
  }

  async function submitOrder() {
    if (!cart.length) {
      toast(lang === "zh" ? "请先加点东西" : "Cart is empty");
      return;
    }
    const btn = $("submitOrderBtn");
    btn.disabled = true;
    btn.textContent = lang === "zh" ? "提交中…" : "Submitting…";
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table,
          remark: ($("orderRemark").value || "").trim(),
          items: cart.map((x) => ({
            id: x.id,
            name: x.name,
            qty: x.qty,
            unitPrice: x.unitPrice,
            options: x.options,
            note: x.note,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "下单失败");

      cart = [];
      saveCart();
      $("cartSheet").hidden = true;
      $("successCode").textContent =
        lang === "zh" ? `取餐号 ${data.order.code}` : `Pickup #${data.order.code}`;
      $("successMsg").textContent =
        data.message || (lang === "zh" ? "门店已收到订单" : "Order received");
      if (data.next?.reviewUrl) {
        $("reviewAfterOrder").href = data.next.reviewUrl;
      }
      $("successSheet").hidden = false;
      loadOrders();
    } catch (err) {
      toast(err.message || "下单失败");
    } finally {
      btn.disabled = false;
      btn.textContent = lang === "zh" ? "提交订单" : "Place order";
    }
  }

  async function loadOrders() {
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      const list = data.orders || [];
      const wrap = $("ordersList");
      if (!list.length) {
        wrap.innerHTML = `<p class="empty">${lang === "zh" ? "还没有订单，先去点一杯吧" : "No orders yet"}</p>`;
        return;
      }
      wrap.innerHTML = "";
      list.slice(0, 20).forEach((o) => {
        const card = document.createElement("article");
        card.className = "order-card";
        const when = new Date(o.createdAt).toLocaleString();
        const lines = (o.items || [])
          .map((i) => `<li>${i.name} × ${i.qty}</li>`)
          .join("");
        card.innerHTML = `
          <h3>${lang === "zh" ? "取餐号" : "#"} ${o.code}</h3>
          <p class="meta">${when}${o.table ? ` · ${lang === "zh" ? "桌号" : "Table"} ${o.table}` : ""} · ${o.currency || "¥"}${o.total}</p>
          <ul>${lines}</ul>
        `;
        wrap.appendChild(card);
      });
    } catch {
      /* ignore */
    }
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    $("panelMenu").classList.toggle("active", name === "menu");
    $("panelOrders").classList.toggle("active", name === "orders");
    $("panelReview").classList.toggle("active", name === "review");
    if (name === "orders") loadOrders();
  }

  function bind() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });

    $("langBtn").addEventListener("click", () => {
      lang = lang === "zh" ? "en" : "zh";
      localStorage.setItem("sb_order_lang", lang);
      renderStore();
      renderCats();
      renderMenu();
      renderCartBar();
      if (!$("cartSheet").hidden) renderCartSheet();
    });

    $("closeSpec").addEventListener("click", () => {
      $("specSheet").hidden = true;
    });
    $("closeCart").addEventListener("click", () => {
      $("cartSheet").hidden = true;
    });
    $("closeSuccess").addEventListener("click", () => {
      $("successSheet").hidden = true;
    });
    $("keepOrdering").addEventListener("click", () => {
      $("successSheet").hidden = true;
      switchTab("menu");
    });

    $("qtyMinus").addEventListener("click", () => {
      if (!draft) return;
      draft.qty = Math.max(1, draft.qty - 1);
      $("qtyValue").textContent = String(draft.qty);
      updateAddBtn();
    });
    $("qtyPlus").addEventListener("click", () => {
      if (!draft) return;
      draft.qty = Math.min(99, draft.qty + 1);
      $("qtyValue").textContent = String(draft.qty);
      updateAddBtn();
    });
    $("addCartBtn").addEventListener("click", addToCart);

    $("openCartBtn").addEventListener("click", () => {
      renderCartSheet();
      $("cartSheet").hidden = false;
    });
    $("checkoutBtn").addEventListener("click", () => {
      renderCartSheet();
      $("cartSheet").hidden = false;
    });
    $("clearCart").addEventListener("click", () => {
      cart = [];
      saveCart();
      renderCartSheet();
      $("cartSheet").hidden = true;
    });
    $("submitOrderBtn").addEventListener("click", submitOrder);

    // 菜单滚动时高亮分类
    const scroller = $("menuScroll");
    scroller?.addEventListener(
      "scroll",
      () => {
        const sections = [...document.querySelectorAll(".menu-section")];
        let current = activeCat;
        for (const sec of sections) {
          const top = sec.getBoundingClientRect().top;
          if (top < 140) current = sec.id.replace(/^sec-/, "");
        }
        if (current && current !== activeCat) {
          activeCat = current;
          renderCats();
        }
      },
      { passive: true }
    );
  }

  bind();
  loadMenu().catch((err) => {
    toast(err.message || "菜单加载失败");
    $("menuSections").innerHTML = `<p class="empty">${err.message || "菜单加载失败"}</p>`;
  });
})();
