/* ==========================================================================
 * BiliPlay · options.js —— 设置页逻辑
 * ========================================================================== */
(() => {
  'use strict';

  const B = globalThis.BiliPlay;
  const state = B.state;
  const $ = (id) => document.getElementById(id);

  // 有些控件在「恢复被取消绑定的功能」前是隐藏的，所以统一做存在性判断
  const setChecked = (id, value) => {
    const el = $(id);
    if (el) el.checked = !!value;
  };
  const setValue = (id, value) => {
    const el = $(id);
    if (el) el.value = String(value);
  };
  const onChange = (id, handler) => {
    const el = $(id);
    if (el) el.addEventListener('change', handler);
  };

  let recording = null; // { actionId, button }

  /* ---------------- 渲染 ---------------- */

  function renderToggles() {
    setChecked('enabled', state.settings.enabled);
    setChecked('showToast', state.settings.showToast);
    setChecked('rememberSpeed', state.settings.rememberSpeed);
    setValue('mode', state.settings.mode);
    setValue('coinCount', state.settings.coinCount);
    setValue('speedStep', state.settings.speedStep);
    setValue('maxSpeed', state.settings.maxSpeed);
    setValue('seekStep', state.settings.seekStep);
    setValue('frameRate', state.settings.frameRate);
  }

  /**
   * 重复绑定的提示条。
   * content.js 匹配按键时是「按 ACTIONS 顺序找、命中即停」，所以重复时靠后的那个
   * 会悄无声息地失效 —— 必须让用户看见。
   */
  function renderConflicts() {
    const box = $('conflicts');
    if (!box) return;

    const byKey = new Map();
    for (const action of B.ACTIONS) {
      const key = state.settings.keys[action.id];
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(action.label);
    }
    const dupes = [...byKey.entries()].filter(([, labels]) => labels.length > 1);

    box.textContent = '';
    if (!dupes.length) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    const title = document.createElement('strong');
    title.textContent = '⚠️ 有重复的按键绑定';
    box.appendChild(title);

    const ul = document.createElement('ul');
    for (const [key, labels] of dupes) {
      const li = document.createElement('li');
      li.textContent = `${B.prettyKey(key)} → ${labels.join(' / ')}`;
      ul.appendChild(li);
    }
    box.appendChild(ul);

    const foot = document.createElement('span');
    foot.className = 'notice-foot';
    foot.textContent = '同一颗键只会触发列表里靠上的那个动作，另一个不会生效。';
    box.appendChild(foot);
  }

  function renderKeys() {
    const table = $('keys');
    table.textContent = '';

    const conflicts = B.findConflicts();

    let lastGroup = '';
    for (const action of B.ACTIONS) {
      // 分组标题行
      if (action.group && action.group !== lastGroup) {
        lastGroup = action.group;
        const groupRow = document.createElement('tr');
        const groupCell = document.createElement('td');
        groupCell.colSpan = 3;
        groupCell.className = 'group';
        groupCell.textContent = action.group;
        groupRow.appendChild(groupCell);
        table.appendChild(groupRow);
      }

      const tr = document.createElement('tr');
      if (conflicts[action.id]) tr.className = 'is-conflict';

      const tdName = document.createElement('td');
      tdName.className = 'name';
      tdName.textContent = `${action.icon} ${action.label}`;
      if (conflicts[action.id]) {
        const badge = document.createElement('span');
        badge.className = 'badge-warn';
        badge.textContent = '按键重复';
        tdName.appendChild(badge);
      }

      const tdKey = document.createElement('td');
      tdKey.className = 'key-cell';
      const keyBtn = document.createElement('button');
      keyBtn.type = 'button';
      keyBtn.className = 'key';
      keyBtn.textContent = B.prettyKey(state.settings.keys[action.id]);
      keyBtn.addEventListener('click', () => startRecording(action.id, keyBtn));
      tdKey.appendChild(keyBtn);

      const tdReset = document.createElement('td');
      tdReset.className = 'reset-cell';
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn-ghost small';
      resetBtn.textContent = '默认';
      resetBtn.addEventListener('click', () => setKey(action.id, B.DEFAULT_KEYS[action.id]));
      tdReset.appendChild(resetBtn);

      tr.append(tdName, tdKey, tdReset);
      table.appendChild(tr);
    }

    renderConflicts();
  }

  /* ---------------- 录制按键 ---------------- */

  function startRecording(actionId, button) {
    stopRecording();
    recording = { actionId, button };
    button.classList.add('recording');
    button.textContent = '请按按键…';
  }

  function stopRecording() {
    if (!recording) return;
    recording.button.classList.remove('recording');
    recording.button.textContent = B.prettyKey(state.settings.keys[recording.actionId]);
    recording = null;
  }

  async function setKey(actionId, key) {
    await B.save({ keys: { [actionId]: key } });
    renderKeys();
  }

  function onKeyDown(e) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      stopRecording();
      return;
    }
    // 只按了修饰键，继续等主键
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const key = B.normalizeKey(e);
    const { actionId } = recording;
    stopRecording();
    setKey(actionId, key);
  }

  /* ---------------- 绑定 ---------------- */

  function bind() {
    document.addEventListener('keydown', onKeyDown, true);

    onChange('enabled', (e) => B.save({ enabled: e.target.checked }));
    onChange('showToast', (e) => B.save({ showToast: e.target.checked }));
    onChange('rememberSpeed', (e) => B.save({ rememberSpeed: e.target.checked }));
    onChange('mode', (e) => B.save({ mode: e.target.value }));
    onChange('coinCount', (e) => B.save({ coinCount: Number(e.target.value) }));
    onChange('speedStep', (e) => B.save({ speedStep: Number(e.target.value) }));
    onChange('maxSpeed', (e) => B.save({ maxSpeed: Number(e.target.value) }));
    onChange('seekStep', (e) => B.save({ seekStep: Number(e.target.value) }));
    onChange('frameRate', (e) => B.save({ frameRate: Number(e.target.value) }));

    $('resetKeys').addEventListener('click', async () => {
      await B.save({ keys: { ...B.DEFAULT_KEYS } });
      renderKeys();
    });
  }

  /* ---------------- 启动 ---------------- */

  (async () => {
    await B.load();
    renderToggles();
    renderKeys();
    bind();
  })();
})();
