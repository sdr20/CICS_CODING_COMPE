(() => {
  const loginWrap = document.getElementById('loginWrap');
  const adminShell = document.getElementById('adminShell');
  const toastStack = document.getElementById('toastStack');

  let token = sessionStorage.getItem('ccs_admin_token') || null;
  let selectedLevelId = null;
  let editingQuestionId = null;
  let levelsCache = [];

  /* ---------------------------------------------------------- Utility */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function formatTime(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined) return '—';
    const s = Math.max(0, Math.floor(totalSeconds));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  }

  function toast(title, message, type) {
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message || '')}`;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-admin-token': token } : {}),
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      showLogin('Session expired. Please log in again.');
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ---------------------------------------------------------- Login */

  function showLogin(errorMsg) {
    token = null;
    sessionStorage.removeItem('ccs_admin_token');
    loginWrap.style.display = 'flex';
    adminShell.style.display = 'none';
    document.getElementById('loginError').textContent = errorMsg || '';
  }

  function showShell() {
    loginWrap.style.display = 'none';
    adminShell.style.display = 'block';
    initAdmin();
  }

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('adminPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  async function doLogin() {
    const password = document.getElementById('adminPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) { errorEl.textContent = data.error || 'Login failed.'; return; }
      token = data.token;
      sessionStorage.setItem('ccs_admin_token', token);
      showShell();
    } catch (e) {
      errorEl.textContent = 'Could not reach the server.';
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', () => showLogin());

  if (token) {
    // Validate the stored token with a harmless request before showing the shell.
    api('/admin/state').then(showShell).catch(() => showLogin());
  } else {
    showLogin();
  }

  /* ---------------------------------------------------------- Tabs */

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  /* ---------------------------------------------------------- Init */

  function initAdmin() {
    loadOverview();
    loadStatistics();
    loadLevels();
    loadPlayers();
    connectLeaderboardStream();
    connectAdminStream();
    setInterval(() => { loadOverview(); loadStatistics(); loadPlayers(); }, 5000);
  }

  /* ---------------------------------------------------------- Overview */

  async function loadOverview() {
    try {
      const data = await api('/admin/state');
      const c = data.competition;
      document.getElementById('statGrid').innerHTML = `
        <div class="card stat-card accent-cyan"><div class="val">${data.players}</div><div class="lbl">Players</div></div>
        <div class="card stat-card accent-violet"><div class="val">${data.levels}</div><div class="lbl">Levels</div></div>
        <div class="card stat-card accent-green"><div class="val">${data.completed}</div><div class="lbl">Completed</div></div>
        <div class="card stat-card accent-amber"><div class="val">${data.active}</div><div class="lbl">Active Players</div></div>
      `;
      const pillClass = { NOT_STARTED: 'pill-dim', RUNNING: 'pill-green', PAUSED: 'pill-amber', ENDED: 'pill-red' }[c.status] || 'pill-dim';
      const pill = document.getElementById('statusPill');
      pill.className = `pill ${pillClass}`;
      pill.textContent = c.status.replace('_', ' ');

      document.getElementById('btnStart').disabled = c.status === 'RUNNING';
      document.getElementById('btnPause').disabled = c.status !== 'RUNNING';
      document.getElementById('btnResume').disabled = c.status !== 'PAUSED';
      document.getElementById('btnEnd').disabled = c.status === 'ENDED' || c.status === 'NOT_STARTED';
    } catch (e) { /* handled by api() for auth errors */ }
  }

  async function loadStatistics() {
    try {
      const s = await api('/admin/statistics');
      document.getElementById('statsGrid').innerHTML = `
        <div class="card stat-card"><div class="val">${s.total_players}</div><div class="lbl">Total Players</div></div>
        <div class="card stat-card"><div class="val">${s.active_players}</div><div class="lbl">Active Players</div></div>
        <div class="card stat-card"><div class="val">${s.completed_players}</div><div class="lbl">Completed Players</div></div>
        <div class="card stat-card"><div class="val">${formatTime(s.average_completion_seconds)}</div><div class="lbl">Avg. Completion Time</div></div>
        <div class="card stat-card"><div class="val">${s.fastest_player || '—'}</div><div class="lbl">Fastest Player</div></div>
        <div class="card stat-card"><div class="val">${formatTime(s.fastest_time_seconds)}</div><div class="lbl">Fastest Time</div></div>
      `;
    } catch (e) { /* ignore */ }
  }

  document.getElementById('btnStart').addEventListener('click', () => runControl('/admin/competition/start'));
  document.getElementById('btnPause').addEventListener('click', () => runControl('/admin/competition/pause'));
  document.getElementById('btnResume').addEventListener('click', () => runControl('/admin/competition/resume'));
  document.getElementById('btnEnd').addEventListener('click', () => runControl('/admin/competition/end'));

  async function runControl(path) {
    try {
      await api(path, { method: 'POST' });
      loadOverview();
      toast('Success', 'Competition state updated.', 'success');
    } catch (e) {
      toast('Error', e.message, 'error');
    }
  }

  const resetModal = document.getElementById('resetModal');
  document.getElementById('btnReset').addEventListener('click', () => resetModal.style.display = 'flex');
  document.getElementById('cancelResetBtn').addEventListener('click', () => resetModal.style.display = 'none');
  document.getElementById('confirmResetBtn').addEventListener('click', async () => {
    try {
      await api('/admin/competition/reset', { method: 'POST' });
      resetModal.style.display = 'none';
      toast('Reset complete', 'All player progress has been cleared.', 'success');
      loadOverview(); loadStatistics(); loadPlayers();
    } catch (e) {
      toast('Error', e.message, 'error');
    }
  });

  /* ---------------------------------------------------------- Levels & Questions */

  async function loadLevels() {
    try {
      const data = await api('/admin/levels');
      levelsCache = data.levels;
      const container = document.getElementById('levelRows');
      if (levelsCache.length === 0) {
        container.innerHTML = '<div class="empty-note">No levels yet. Add one below.</div>';
      } else {
        container.innerHTML = levelsCache.map((lvl) => `
          <div class="level-row ${lvl.id === selectedLevelId ? 'selected' : ''}" data-id="${lvl.id}">
            <div>
              <div class="lr-num">LEVEL ${lvl.level_number}${lvl.is_active ? '' : ' · inactive'}</div>
              <div class="lr-title">${escapeHtml(lvl.title)}</div>
            </div>
            <div class="lr-actions">
              <button class="btn btn-ghost edit-level-btn" data-id="${lvl.id}">Edit</button>
            </div>
          </div>
        `).join('');
      }

      container.querySelectorAll('.level-row').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.edit-level-btn')) return;
          selectLevel(Number(row.dataset.id));
        });
      });
      container.querySelectorAll('.edit-level-btn').forEach((btn) => {
        btn.addEventListener('click', () => openLevelForm(Number(btn.dataset.id)));
      });
    } catch (e) { /* ignore */ }
  }

  function selectLevel(levelId) {
    selectedLevelId = levelId;
    loadLevels();
    const level = levelsCache.find((l) => l.id === levelId);
    document.getElementById('questionsHeading').textContent = level ? `Questions — Level ${level.level_number}: ${level.title}` : 'Questions';
    document.getElementById('newQuestionBtn').style.display = 'block';
    loadQuestions(levelId);
  }

  async function loadQuestions(levelId) {
    try {
      const data = await api(`/admin/levels/${levelId}/questions`);
      const container = document.getElementById('questionRows');
      if (data.questions.length === 0) {
        container.innerHTML = '<div class="empty-note">No questions yet for this level.</div>';
        return;
      }
      container.innerHTML = data.questions.map((q) => `
        <div class="question-row">
          <div>
            <div class="q-title">${escapeHtml(q.title)} <span class="pill pill-cyan" style="margin-left:6px;">${escapeHtml(q.language)}</span></div>
            <div class="q-answer">Answer: ${escapeHtml(q.correct_answer)} ${q.case_sensitive ? '(case sensitive)' : ''}</div>
          </div>
          <div class="lr-actions">
            <button class="btn btn-ghost edit-q-btn" data-id="${q.id}">Edit</button>
          </div>
        </div>
      `).join('');
      container.querySelectorAll('.edit-q-btn').forEach((btn) => {
        btn.addEventListener('click', () => openQuestionForm(data.questions.find((q) => q.id === Number(btn.dataset.id))));
      });
    } catch (e) { /* ignore */ }
  }

  document.getElementById('newLevelBtn').addEventListener('click', () => openLevelForm(null));

  function openLevelForm(levelId) {
    const card = document.getElementById('levelFormCard');
    card.style.display = 'block';
    card.dataset.editingId = levelId || '';
    const level = levelId ? levelsCache.find((l) => l.id === levelId) : null;

    document.getElementById('levelFormTitle').textContent = level ? 'Edit Level' : 'Add Level';
    document.getElementById('levelNumberInput').value = level ? level.level_number : (levelsCache.length + 1);
    document.getElementById('levelTitleInput').value = level ? level.title : '';
    document.getElementById('levelDescInput').value = level ? (level.description || '') : '';
    document.getElementById('deleteLevelBtn').style.display = level ? 'inline-flex' : 'none';
  }

  document.getElementById('cancelLevelBtn').addEventListener('click', () => {
    document.getElementById('levelFormCard').style.display = 'none';
  });

  document.getElementById('saveLevelBtn').addEventListener('click', async () => {
    const editingId = document.getElementById('levelFormCard').dataset.editingId;
    const level_number = Number(document.getElementById('levelNumberInput').value);
    const title = document.getElementById('levelTitleInput').value.trim();
    const description = document.getElementById('levelDescInput').value.trim();

    if (!level_number || !title) { toast('Error', 'Level number and title are required.', 'error'); return; }

    try {
      if (editingId) {
        await api(`/admin/levels/${editingId}`, { method: 'PUT', body: JSON.stringify({ title, description }) });
      } else {
        await api('/admin/levels', { method: 'POST', body: JSON.stringify({ level_number, title, description }) });
      }
      document.getElementById('levelFormCard').style.display = 'none';
      toast('Saved', 'Level saved successfully.', 'success');
      loadLevels(); loadOverview();
    } catch (e) {
      toast('Error', e.message, 'error');
    }
  });

  const deleteLevelModal = document.getElementById('deleteLevelModal');
  document.getElementById('deleteLevelBtn').addEventListener('click', () => deleteLevelModal.style.display = 'flex');
  document.getElementById('cancelDeleteLevelBtn').addEventListener('click', () => deleteLevelModal.style.display = 'none');
  document.getElementById('confirmDeleteLevelBtn').addEventListener('click', async () => {
    const editingId = document.getElementById('levelFormCard').dataset.editingId;
    try {
      await api(`/admin/levels/${editingId}`, { method: 'DELETE' });
      deleteLevelModal.style.display = 'none';
      document.getElementById('levelFormCard').style.display = 'none';
      if (Number(editingId) === selectedLevelId) {
        selectedLevelId = null;
        document.getElementById('questionRows').innerHTML = '<div class="empty-note">Select a level to manage its questions.</div>';
        document.getElementById('newQuestionBtn').style.display = 'none';
        document.getElementById('questionsHeading').textContent = 'Questions';
      }
      toast('Deleted', 'Level removed.', 'success');
      loadLevels(); loadOverview();
    } catch (e) {
      toast('Error', e.message, 'error');
    }
  });

  document.getElementById('newQuestionBtn').addEventListener('click', () => openQuestionForm(null));

  function openQuestionForm(question) {
    if (!selectedLevelId) { toast('Notice', 'Select a level first.', 'error'); return; }
    editingQuestionId = question ? question.id : null;
    const card = document.getElementById('questionFormCard');
    card.style.display = 'block';
    document.getElementById('questionFormTitle').textContent = question ? 'Edit Question' : 'Add Question';
    document.getElementById('qTitleInput').value = question ? question.title : '';
    document.getElementById('qLangInput').value = question ? question.language : 'C++';
    document.getElementById('qDescInput').value = question ? (question.description || '') : '';
    document.getElementById('qCodeInput').value = question ? (question.code || '') : '';
    document.getElementById('qAnswerInput').value = question ? question.correct_answer : '';
    document.getElementById('qCaseSensitiveInput').checked = question ? !!question.case_sensitive : false;
    document.getElementById('deleteQuestionBtn').style.display = question ? 'inline-flex' : 'none';
  }

  document.getElementById('cancelQuestionBtn').addEventListener('click', () => {
    document.getElementById('questionFormCard').style.display = 'none';
  });

  document.getElementById('saveQuestionBtn').addEventListener('click', async () => {
    const payload = {
      level_id: selectedLevelId,
      title: document.getElementById('qTitleInput').value.trim(),
      language: document.getElementById('qLangInput').value.trim() || 'C++',
      description: document.getElementById('qDescInput').value.trim(),
      code: document.getElementById('qCodeInput').value,
      correct_answer: document.getElementById('qAnswerInput').value.trim(),
      case_sensitive: document.getElementById('qCaseSensitiveInput').checked
    };
    if (!payload.title || !payload.correct_answer) { toast('Error', 'Title and correct answer are required.', 'error'); return; }

    try {
      if (editingQuestionId) {
        await api(`/admin/questions/${editingQuestionId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/admin/questions', { method: 'POST', body: JSON.stringify(payload) });
      }
      document.getElementById('questionFormCard').style.display = 'none';
      toast('Saved', 'Question saved successfully.', 'success');
      loadQuestions(selectedLevelId);
    } catch (e) {
      toast('Error', e.message, 'error');
    }
  });

  document.getElementById('deleteQuestionBtn').addEventListener('click', async () => {
    if (!editingQuestionId) return;
    try {
      await api(`/admin/questions/${editingQuestionId}`, { method: 'DELETE' });
      document.getElementById('questionFormCard').style.display = 'none';
      toast('Deleted', 'Question removed.', 'success');
      loadQuestions(selectedLevelId);
    } catch (e) {
      toast('Error', e.message, 'error');
    }
  });

  /* ---------------------------------------------------------- Players */

  async function loadPlayers() {
    try {
      const data = await api('/admin/players');
      const body = document.getElementById('playersTableBody');
      if (data.players.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="empty-note">No players have joined yet.</td></tr>`;
        return;
      }
      body.innerHTML = data.players.map((p) => {
        const statusPill = { ACTIVE: 'pill-green', COMPLETED: 'pill-cyan', DISCONNECTED: 'pill-dim' }[p.status] || 'pill-dim';
        return `
          <tr>
            <td>${escapeHtml(p.username)}</td>
            <td>${p.current_level ? `Level ${p.current_level}` : '—'}</td>
            <td><span class="pill ${statusPill}">${p.status}</span></td>
            <td>${p.status === 'COMPLETED' ? formatTime(p.total_time_seconds) : `${p.completed_levels} completed${p.current_level_elapsed_seconds !== null ? ' · ' + formatTime(p.current_level_elapsed_seconds) : ''}`}</td>
          </tr>`;
      }).join('');
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------- Live leaderboard (SSE) */

  function renderLeaderboard(rows) {
    const container = document.getElementById('leaderboardList');
    if (!rows || rows.length === 0) {
      container.innerHTML = '<div class="empty-note">No players yet.</div>';
      return;
    }
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    container.innerHTML = rows.map((r) => `
      <div class="lb-row ${r.rank <= 3 ? 'rank-' + r.rank : ''}">
        <div class="lb-rank">${medals[r.rank] || r.rank}</div>
        <div class="lb-name">${escapeHtml(r.username)}${r.current_level ? `<span style="color:var(--text-2); font-family:var(--mono); font-size:11px; margin-left:8px;">on level ${r.current_level}</span>` : ''}</div>
        <div class="lb-levels">${r.completed_levels}/${levelsCache.length || '?'}</div>
        <div class="lb-time">${formatTime(r.total_time_seconds)}</div>
      </div>
    `).join('');
  }

  let leaderboardSource = null;
  function connectLeaderboardStream() {
    if (leaderboardSource) leaderboardSource.close();
    leaderboardSource = new EventSource('/api/leaderboard/stream');
    leaderboardSource.onmessage = (evt) => {
      try { renderLeaderboard(JSON.parse(evt.data)); } catch (e) { /* ignore heartbeat/comments */ }
    };
    leaderboardSource.onerror = () => {
      leaderboardSource.close();
      setTimeout(connectLeaderboardStream, 3000);
    };
  }

  let adminSource = null;
  function connectAdminStream() {
    if (adminSource) adminSource.close();
    adminSource = new EventSource(`/api/admin/stream?token=${encodeURIComponent(token)}`);
    adminSource.onmessage = (evt) => {
      loadOverview();
      loadPlayers();
    };
    adminSource.onerror = () => {
      adminSource.close();
      setTimeout(connectAdminStream, 3000);
    };
  }
})();
