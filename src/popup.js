/* ==========================================================================
 * BiliPlay · popup.js —— 工具栏弹窗
 * ========================================================================== */
(() => {
  'use strict';

  const B = globalThis.BiliPlay;
  const api = B.api;
  const state = B.state;
  const $ = (id) => document.getElementById(id);

  async function activeTab() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  }

  async function sendToTab(command, payload) {
    try {
      const tab = await activeTab();
      if (!tab || !tab.id) throw new Error('no tab');
      await api.tabs.sendMessage(tab.id, { source: 'biliplay', command, ...payload });
      $('tip').textContent = '';
      return true;
    } catch (err) {
      // 最常见原因：当前标签页不是 B 站视频页
      $('tip').textContent = '当前标签页不是哔哩哔哩视频页，无法生效';
      return false;
    }
  }

  function renderKeys() {
    const ul = $('keys');
    ul.textContent = '';
    for (const action of B.ACTIONS) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = action.label;
      const key = document.createElement('kbd');
      key.textContent = B.prettyKey(state.settings.keys[action.id]);
      li.append(name, key);
      ul.appendChild(li);
    }
  }

  function bind() {
    $('enabled').addEventListener('change', async (e) => {
      await B.save({ enabled: e.target.checked });
    });

    $('speeds').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-speed]');
      if (!btn) return;
      sendToTab('setSpeed', { value: Number(btn.dataset.speed) });
    });

    $('openOptions').addEventListener('click', () => {
      if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
    });
  }

  (async () => {
    await B.load();
    $('enabled').checked = !!state.settings.enabled;
    renderKeys();
    bind();
  })();
})();
