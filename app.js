/* ===== 备忘录 PWA · 核心逻辑 ===== */
(function () {
  "use strict";

  const STORE_KEY = "memo.items.v1";
  const CATS = {
    life: { label: "生活", emoji: "🏠" },
    work: { label: "工作", emoji: "💼" },
  };

  // ===== 锁屏推送配置 =====
  // 部署好后端后，把下面填成你的后端地址（必须以 https:// 开头，且不要带结尾斜杠）。
  // 例如：https://memo-push.onrender.com
  // 留空 "" 则退化为「仅 App 打开时提醒」，无锁屏推送。
  const BACKEND_URL = "https://memo-push-backend.onrender.com";
  // VAPID 公钥（与后端 vapid.json 的 publicKey 对应，用于浏览器订阅推送）
  const VAPID_PUBLIC = "BAR5tRP6jug58I-Ix_Vg-zMd9JnDeScsISIL1UWVlzdrbFUVXbwdiw7cPsNpt6k9ppX_MwiSYTMLlKya9ymNPGY";

  let state = {
    items: [],
    current: "life",
    editingId: null,
    timers: {},
  };

  /* ---------- 存储 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      state.items = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.items = [];
    }
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.items));
    updateBadge();
  }

  /* ---------- 工具 ---------- */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fmtDeadline(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const now = new Date();
    const diff = d - now;
    const abs = Math.abs(diff);
    const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
    const pad = (n) => String(n).padStart(2, "0");
    const clock = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    let rel;
    if (abs < min) rel = "此刻";
    else if (abs < hr) rel = `约 ${Math.round(abs / min)} 分钟${diff < 0 ? "前" : "后"}`;
    else if (abs < day) rel = `约 ${Math.round(abs / hr)} 小时${diff < 0 ? "前" : "后"}`;
    else rel = `约 ${Math.round(abs / day)} 天${diff < 0 ? "前" : "后"}`;
    return { clock, rel, overdue: diff < 0, soon: diff >= 0 && diff < 24 * hr };
  }
  function statusOf(item) {
    if (item.done) return "done";
    if (!item.deadline) return "none";
    return fmtDeadline(item.deadline).overdue ? "overdue" : "upcoming";
  }

  /* ---------- 渲染 ---------- */
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const dueBanner = document.getElementById("dueBanner");

  function render() {
    const items = state.items
      .filter((i) => i.cat === state.current)
      .sort(sortItems);
    listEl.innerHTML = "";
    if (items.length === 0) {
      emptyEl.classList.remove("hidden");
    } else {
      emptyEl.classList.add("hidden");
      items.forEach((it) => listEl.appendChild(renderItem(it)));
    }
    renderDueBanner();
    updateDataStat();
  }

  function sortItems(a, b) {
    // 未完成优先，再按截止时间升序（无时间排最后）
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ta = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    const tb = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    return ta - tb;
  }

  function renderItem(it) {
    const li = document.createElement("li");
    li.className = "item" + (it.done ? " done" : "");
    const st = statusOf(it);
    const dl = it.deadline ? fmtDeadline(it.deadline) : null;

    let meta = "";
    if (dl) {
      const cls = dl.overdue ? "chip-overdue" : dl.soon ? "chip-soon" : "chip-time";
      meta += `<span class="chip ${cls}">⏰ ${escapeHtml(dl.clock)} · ${escapeHtml(dl.rel)}</span>`;
    }
    if (it.remind && it.deadline) {
      meta += `<span class="chip chip-remind">🔔 已设提醒</span>`;
    }

    li.innerHTML = `
      <button class="check" data-act="toggle" data-id="${it.id}" aria-label="完成">${it.done ? "✓" : ""}</button>
      <div class="item-main">
        <div class="item-title">${escapeHtml(it.title)}</div>
        ${it.note ? `<div class="item-note">${escapeHtml(it.note)}</div>` : ""}
        ${meta ? `<div class="item-meta">${meta}</div>` : ""}
      </div>
      <button class="item-del" data-act="del" data-id="${it.id}" aria-label="删除">🗑</button>
    `;
    return li;
  }

  function renderDueBanner() {
    const overdue = state.items.filter((i) => !i.done && i.deadline && fmtDeadline(i.deadline).overdue);
    if (overdue.length === 0) {
      dueBanner.classList.add("hidden");
      return;
    }
    dueBanner.classList.remove("hidden");
    dueBanner.innerHTML = `⚠️ 有 ${overdue.length} 项已超时，记得处理～`;
  }

  /* ---------- 增删改 ---------- */
  function openSheet(item) {
    state.editingId = item ? item.id : null;
    document.getElementById("sheetTitle").textContent = item ? "编辑备忘" : "新建备忘";
    document.getElementById("fTitle").value = item ? item.title : "";
    document.getElementById("fNote").value = item ? item.note || "" : "";
    document.getElementById("fDeadline").value = item && item.deadline
      ? toLocalInput(item.deadline) : "";
    document.getElementById("fRemind").checked = item ? !!item.remind : false;
    document.getElementById("fOffset").value = item && item.offset != null ? String(item.offset) : "0";
    toggleOffsetDisabled();
    document.getElementById("sheet").classList.add("open");
  }
  function closeSheet() {
    document.getElementById("sheet").classList.remove("open");
    state.editingId = null;
  }
  function toLocalInput(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function toggleOffsetDisabled() {
    const off = document.getElementById("remindOffsetWrap");
    off.classList.toggle("disabled", !document.getElementById("fRemind").checked);
  }

  function submitForm(e) {
    e.preventDefault();
    const title = document.getElementById("fTitle").value.trim();
    if (!title) return;
    const deadlineVal = document.getElementById("fDeadline").value;
    const remind = document.getElementById("fRemind").checked;
    const offset = parseInt(document.getElementById("fOffset").value, 10) || 0;

    const data = {
      title,
      note: document.getElementById("fNote").value.trim(),
      deadline: deadlineVal ? new Date(deadlineVal).toISOString() : null,
      remind: remind && !!deadlineVal,
      offset,
    };

    if (state.editingId) {
      const it = state.items.find((i) => i.id === state.editingId);
      Object.assign(it, data);
    } else {
      state.items.push(Object.assign({ id: uid(), cat: state.current, done: false, notified: false, createdAt: Date.now() }, data));
    }
    save();
    closeSheet();
    render();
    scheduleReminders();
    syncReminders();
  }

  function toggleDone(id) {
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    it.done = !it.done;
    if (it.done) it.notified = true; // 完成后不再提醒
    save();
    render();
    scheduleReminders();
    syncReminders();
  }
  function delItem(id) {
    state.items = state.items.filter((i) => i.id !== id);
    if (state.timers[id]) { clearTimeout(state.timers[id]); delete state.timers[id]; }
    save();
    render();
    syncReminders();
  }

  /* ---------- 提醒调度 ---------- */
  function reminderTime(it) {
    if (!it.remind || !it.deadline) return null;
    const base = new Date(it.deadline).getTime();
    const off = (it.offset || 0) * 60 * 1000;
    return base - off;
  }

  function scheduleReminders() {
    // 清理旧定时器
    Object.values(state.timers).forEach(clearTimeout);
    state.timers = {};

    const now = Date.now();
    state.items.forEach((it) => {
      if (it.done) return;
      const rt = reminderTime(it);
      if (rt == null) return;
      if (rt <= now) {
        // 已到提醒时间但未通知：打开时立即提示
        if (!it.notified) {
          // 延迟一点，避免堆积；真正的弹窗在 checkDueOnOpen 处理
        }
        return;
      }
      const delay = rt - now;
      state.timers[it.id] = setTimeout(() => fireReminder(it.id), Math.min(delay, 2147483647));
    });
    checkDueOnOpen();
  }

  function fireReminder(id) {
    const it = state.items.find((i) => i.id === id);
    if (!it || it.done || it.notified) return;
    it.notified = true;
    save();
    showAlert(it);
    pushNotification(it);
    render();
    updateBadge();
  }

  function checkDueOnOpen() {
    const now = Date.now();
    const pending = state.items.filter((i) => !i.done && !i.notified && reminderTime(i) != null && reminderTime(i) <= now);
    if (pending.length) {
      pending.forEach((it) => { it.notified = true; });
      save();
      pending.forEach((it) => showAlert(it));
      pushNotification(pending[0]);
      render();
      updateBadge();
    }
  }

  /* ---------- 提醒展示 ---------- */
  let alertQueue = [];
  let currentAlert = null;
  function showAlert(it) {
    alertQueue.push(it);
    if (document.getElementById("alertModal").classList.contains("hidden")) {
      drainAlert();
    }
  }
  function drainAlert() {
    if (alertQueue.length === 0) {
      currentAlert = null;
      document.getElementById("alertModal").classList.add("hidden");
      return;
    }
    currentAlert = alertQueue.shift();
    const dl = currentAlert.deadline ? fmtDeadline(currentAlert.deadline) : null;
    document.getElementById("alertTitle").textContent = `${CATS[currentAlert.cat].emoji} ${CATS[currentAlert.cat].label}提醒`;
    document.getElementById("alertBody").textContent =
      currentAlert.title + (dl ? `\n⏰ ${dl.clock}` : "") + (currentAlert.note ? `\n${currentAlert.note}` : "");
    const modal = document.getElementById("alertModal");
    modal.classList.remove("hidden");
  }

  function pushNotification(it) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(`🔔 ${CATS[it.cat].label}提醒`, {
        body: it.title + (it.note ? "\n" + it.note : ""),
        tag: it.id,
      });
    } catch (e) {}
  }

  function updateBadge() {
    const overdue = state.items.filter((i) => !i.done && i.deadline && fmtDeadline(i.deadline).overdue).length;
    if ("setAppBadge" in navigator) {
      try { overdue > 0 ? navigator.setAppBadge(overdue) : navigator.clearAppBadge(); } catch (e) {}
    }
  }

  /* ---------- 锁屏推送（Web Push） ---------- */
  let swReg = null;
  let pushSub = null;

  async function getSWReg() {
    if (swReg) return swReg;
    if (!("serviceWorker" in navigator)) return null;
    swReg = await navigator.serviceWorker.ready;
    return swReg;
  }
  async function getPushSub() {
    if (pushSub) return pushSub;
    const raw = localStorage.getItem("memo.pushsub");
    if (raw) { try { pushSub = JSON.parse(raw); return pushSub; } catch (e) {} }
    return null;
  }
  function savePushSub(sub) {
    pushSub = sub ? (sub.toJSON ? sub.toJSON() : sub) : null;
    try { localStorage.setItem("memo.pushsub", JSON.stringify(pushSub)); } catch (e) {}
  }

  async function subscribePush() {
    if (!BACKEND_URL) { alert("未配置推送后端地址（BACKEND_URL 为空）"); return false; }
    if (!("Notification" in window)) return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    const reg = await getSWReg();
    if (!reg || !reg.pushManager) return false;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC });
    savePushSub(sub);
    await fetch(BACKEND_URL + "/api/subscribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    }).catch(() => {});
    await syncReminders();
    return true;
  }

  async function syncReminders() {
    if (!BACKEND_URL) return;
    const sub = await getPushSub();
    if (!sub) return;
    const reminders = state.items
      .filter((i) => !i.done && i.remind && i.deadline)
      .map((i) => {
        const rt = new Date(i.deadline).getTime() - (i.offset || 0) * 60000;
        return {
          id: i.id,
          title: i.title,
          note: i.note || "",
          cat: i.cat,
          remindAt: new Date(rt).toISOString(),
          pushTitle: `${CATS[i.cat].emoji} ${CATS[i.cat].label}提醒`,
          pushBody: i.title + (i.note ? "\n" + i.note : ""),
        };
      });
    await fetch(BACKEND_URL + "/api/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub, reminders }),
    }).catch(() => {});
  }

  /* ---------- 通知权限 ---------- */
  async function enableNotif() {
    if (!("Notification" in window)) {
      document.getElementById("notifState").textContent = "此浏览器不支持";
      return;
    }
    if (BACKEND_URL) {
      const ok = await subscribePush();
      const perm = Notification.permission;
      document.getElementById("notifState").textContent =
        ok ? "已开启（锁屏推送）✅" : perm === "denied" ? "被拒绝，请到系统设置开启" : "未开启";
      return;
    }
    // 未配置后端：仅 App 内提醒
    try {
      const perm = await Notification.requestPermission();
      document.getElementById("notifState").textContent =
        perm === "granted" ? "已开启（仅 App 内）✅" : perm === "denied" ? "被拒绝" : "未开启";
    } catch (e) {
      document.getElementById("notifState").textContent = "请求失败";
    }
  }

  /* ---------- 设置 ---------- */
  function updateDataStat() {
    const total = state.items.length;
    const done = state.items.filter((i) => i.done).length;
    const el = document.getElementById("dataStat");
    if (el) el.textContent = `共 ${total} 条，已完成 ${done} 条`;
  }
  function clearDone() {
    state.items = state.items.filter((i) => !i.done);
    save();
    render();
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    document.getElementById("tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      state.current = btn.dataset.cat;
      render();
    });

    listEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === "toggle") toggleDone(id);
      if (btn.dataset.act === "del") delItem(id);
    });

    document.getElementById("addFab").addEventListener("click", () => openSheet(null));
    document.getElementById("cancelBtn").addEventListener("click", closeSheet);
    document.getElementById("itemForm").addEventListener("submit", submitForm);
    document.getElementById("fRemind").addEventListener("change", toggleOffsetDisabled);

    const sheet = document.getElementById("sheet");
    sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

    // 提醒弹窗
    document.getElementById("alertDone").addEventListener("click", drainAlert);
    document.getElementById("alertLater").addEventListener("click", () => {
      // 稍后：5 分钟后再提醒一次（本次会话内有效）
      if (currentAlert) {
        currentAlert.notified = false;
        save();
        setTimeout(() => {
          currentAlert.notified = true;
          showAlert(currentAlert);
          pushNotification(currentAlert);
        }, 5 * 60 * 1000);
      }
      drainAlert();
    });
    document.getElementById("alertModal").addEventListener("click", (e) => {
      if (e.target.id === "alertModal") drainAlert();
    });

    // 设置
    document.getElementById("settingsBtn").addEventListener("click", () => {
      const perm = "Notification" in window ? Notification.permission : "unsupported";
      document.getElementById("notifState").textContent =
        perm === "granted" ? "已开启 ✅" : perm === "denied" ? "被拒绝" : perm === "unsupported" ? "不支持" : "未开启";
      updateDataStat();
      document.getElementById("settingsSheet").classList.add("open");
    });
    document.getElementById("settingsClose").addEventListener("click", () =>
      document.getElementById("settingsSheet").classList.remove("open")
    );
    document.getElementById("settingsSheet").addEventListener("click", (e) => {
      if (e.target.id === "settingsSheet") e.target.classList.remove("open");
    });
    document.getElementById("enableNotif").addEventListener("click", enableNotif);
    document.getElementById("clearDone").addEventListener("click", clearDone);

    // 切回前台时检查到期
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { scheduleReminders(); }
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    load();
    bind();
    render();
    scheduleReminders();
    syncReminders();
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
