(() => {
  const saved = JSON.parse(localStorage.getItem('ccs_player') || 'null');
  if (!saved || !saved.id) {
    window.location.href = '/';
    return;
  }

  const chipUsername = document.getElementById('chipUsername');
  const levelList = document.getElementById('levelList');
  const progressFill = document.getElementById('progressFill');
  const progressCount = document.getElementById('progressCount');
  const progressTotal = document.getElementById('progressTotal');
  const mainPanel = document.getElementById('mainPanel');
  const toastStack = document.getElementById('toastStack');

  chipUsername.textContent = saved.username;

  let timerInterval = null;
  let timerBaseSeconds = 0;
  let timerBaseTimestamp = 0;
  let pollInterval = null;
  let isAnswering = false;
  let lastKnownStatus = null;

  /* ---------------------------------------------------------- Utility */

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function toast(title, message, type) {
    const el = document.createElement('div');
    el.className = `toast ${type || ''}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message || '')}`;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function stopClientTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  // The server is authoritative: we seed the display with server elapsed_seconds
  // at fetch time, then tick locally so the number moves smoothly between polls.
  function startClientTimer(serverElapsedSeconds) {
    stopClientTimer();
    timerBaseSeconds = serverElapsedSeconds;
    timerBaseTimestamp = Date.now();
    const clockEl = document.getElementById('timerClock');
    if (!clockEl) return;
    const tick = () => {
      const el = document.getElementById('timerClock');
      if (!el) { stopClientTimer(); return; }
      const drift = (Date.now() - timerBaseTimestamp) / 1000;
      el.textContent = formatTime(timerBaseSeconds + drift);
    };
    tick();
    timerInterval = setInterval(tick, 500);
  }

  /* ---------------------------------------------------------- Rendering */

  function renderLevelList(levels) {
    levelList.innerHTML = levels.map((lvl) => {
      let cls = 'locked', icon = '🔒';
      if (lvl.status === 'COMPLETED') { cls = 'completed'; icon = '✓'; }
      else if (lvl.status === 'IN_PROGRESS' || lvl.status === 'AVAILABLE') { cls = 'current'; icon = lvl.status === 'IN_PROGRESS' ? '▶' : '🔓'; }

      return `
        <div class="level-item ${cls}">
          <div class="icon">${icon}</div>
          <div class="meta">
            <div class="num">LEVEL ${lvl.level_number}</div>
            <div class="title">${escapeHtml(lvl.title)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderProgress(completed, total) {
    progressCount.textContent = completed;
    progressTotal.textContent = total;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressFill.style.width = pct + '%';
  }

  function renderPaused() {
    stopClientTimer();
    mainPanel.innerHTML = `
      <div class="paused-state">
        <div class="big-icon">⏸</div>
        <h2 style="color:var(--text-0);">COMPETITION PAUSED</h2>
        <p>Please wait for the administrator to resume the competition.</p>
      </div>`;
  }

  function renderNotStarted() {
    stopClientTimer();
    mainPanel.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">&gt;_</div>
        <h2 style="color:var(--text-0);">Waiting for the competition to start</h2>
        <p>The administrator hasn't started the competition yet. This page will update automatically.</p>
      </div>`;
  }

  function renderEnded() {
    stopClientTimer();
    mainPanel.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">■</div>
        <h2 style="color:var(--text-0);">Competition Ended</h2>
        <p>Thanks for competing! Check the ranking to see the final results.</p>
      </div>`;
  }

  function renderAllLevelsLocked() {
    // Shouldn't normally happen (level 1 always unlocks), but guard anyway.
    stopClientTimer();
    mainPanel.innerHTML = `
      <div class="locked-state">
        <div class="big-icon">🔒</div>
        <h2 style="color:var(--text-0);">No level available</h2>
        <p>Contact the administrator if this seems wrong.</p>
      </div>`;
  }

  function renderQuestion(dashboard) {
    const levelState = dashboard.levels.find((l) => l.level_id === dashboard.active_level_id);
    const q = dashboard.active_question;

    mainPanel.innerHTML = `
      <div class="level-header">
        <div>
          <div class="label">LEVEL ${levelState.level_number}</div>
          <h2>${escapeHtml(levelState.title).toUpperCase()}</h2>
        </div>
        <div class="timer-box">
          <div class="label">TIME</div>
          <div class="clock" id="timerClock">00:00</div>
        </div>
      </div>

      <div class="question-block">
        <div class="lang-tag"><span class="pill pill-cyan">${escapeHtml(q.language || 'C++')}</span></div>
        <div class="question-title">${escapeHtml(q.title)}</div>
        <div class="question-desc">${escapeHtml(q.description || '')}</div>
        ${q.code ? `<pre class="code-block">${escapeHtml(q.code)}</pre>` : ''}
      </div>

      <div class="answer-block">
        <label>Your Answer</label>
        <div class="answer-input-row">
          <input id="answerInput" type="text" placeholder="Type your answer..." autocomplete="off" />
          <button id="submitBtn" class="btn btn-primary">SUBMIT ANSWER</button>
        </div>
        <div class="feedback-line" id="feedbackLine"></div>
      </div>
    `;

    const answerInput = document.getElementById('answerInput');
    const submitBtn = document.getElementById('submitBtn');
    answerInput.focus();
    isAnswering = true;

    async function submit() {
      const answer = answerInput.value;
      if (!answer.trim()) return;
      submitBtn.disabled = true;
      answerInput.disabled = true;
      isAnswering = false;

      try {
        const res = await fetch(`/api/players/${saved.id}/levels/${dashboard.active_level_id}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer })
        });
        const data = await res.json();

        if (!res.ok) {
          toast('Error', data.error || 'Something went wrong.', 'error');
          submitBtn.disabled = false;
          answerInput.disabled = false;
          isAnswering = true;
          if (data.competition_status) { isAnswering = false; loadDashboard(); }
          return;
        }

        const feedback = document.getElementById('feedbackLine');

        if (!data.correct) {
          feedback.className = 'feedback-line wrong show';
          feedback.textContent = 'INCORRECT ANSWER — Try again.';
          submitBtn.disabled = false;
          answerInput.disabled = false;
          isAnswering = true;
          answerInput.select();
          return;
        }

        stopClientTimer();
        feedback.className = 'feedback-line correct show';
        feedback.textContent = `✓ CORRECT! Level completed in ${formatTime(data.elapsed_seconds)}.`;

        if (data.competition_completed) {
          showCongratsModal(data);
        } else {
          setTimeout(() => showNextLevelCta(data), 700);
        }
      } catch (e) {
        toast('Connection error', 'Could not reach the server.', 'error');
        submitBtn.disabled = false;
        answerInput.disabled = false;
      }
    }

    submitBtn.addEventListener('click', submit);
    answerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  function showNextLevelCta(data) {
    mainPanel.innerHTML = `
      <div class="next-level-cta">
        <div class="check">✓</div>
        <h2 style="color:var(--text-0); margin-bottom:6px;">Level Completed</h2>
        <p style="color:var(--text-1); font-family:var(--mono); margin-bottom:26px;">Time: ${formatTime(data.elapsed_seconds)}</p>
        <button id="nextLevelBtn" class="btn btn-primary" style="padding:14px 30px;">NEXT LEVEL</button>
      </div>`;
    document.getElementById('nextLevelBtn').addEventListener('click', loadDashboard);
  }

  function showCongratsModal(data) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="card congrats-modal">
        <div class="trophy">🏆</div>
        <h2>CONGRATULATIONS!</h2>
        <div class="sub">Competition Completed</div>
        <div class="username-line">Username: ${escapeHtml(saved.username)}</div>
        <div class="congrats-stats">
          <div class="stat">
            <div class="val">${data.levels_completed}/${data.total_levels}</div>
            <div class="lbl">Levels Completed</div>
          </div>
          <div class="stat">
            <div class="val">${formatTime(data.total_time_seconds)}</div>
            <div class="lbl">Total Time</div>
          </div>
        </div>
        <button class="btn btn-primary" id="viewRankingBtn" style="width:100%;">VIEW RANKING</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('viewRankingBtn').addEventListener('click', () => {
      window.location.href = '/ranking';
    });
  }

  /* ---------------------------------------------------------- Level start + dashboard load */

  async function startLevelIfNeeded(dashboard) {
    const levelState = dashboard.levels.find((l) => l.level_id === dashboard.active_level_id);
    if (!levelState) return null;

    if (levelState.status === 'IN_PROGRESS') {
      let iso = levelState.started_at.replace(' ', 'T');
      if (!/Z|[+-]\d\d:\d\d$/.test(iso)) iso += 'Z';
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
      return { started_at: levelState.started_at, elapsed_seconds: elapsed };
    }

    // AVAILABLE but not started yet -> start it now so the server timer begins.
    const res = await fetch(`/api/players/${saved.id}/levels/${dashboard.active_level_id}/start`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      toast('Notice', data.error || 'Could not start level.', 'error');
      return null;
    }
    return data;
  }

  async function loadDashboard() {
    try {
      const res = await fetch(`/api/players/${saved.id}/dashboard`);
      if (res.status === 404) {
        localStorage.removeItem('ccs_player');
        window.location.href = '/';
        return;
      }
      const dashboard = await res.json();

      renderLevelList(dashboard.levels);
      renderProgress(dashboard.completed_count, dashboard.total_levels);

      if (dashboard.competition_status === 'PAUSED') { renderPaused(); return; }
      if (dashboard.competition_status === 'NOT_STARTED') { renderNotStarted(); return; }

      if (dashboard.player.status === 'COMPLETED') {
        mainPanel.innerHTML = `
          <div class="empty-state">
            <div class="big-icon">🏆</div>
            <h2 style="color:var(--text-0);">You've completed the competition!</h2>
            <p>Total time: ${formatTime(dashboard.player.total_time_seconds)}</p>
          </div>`;
        return;
      }

      if (dashboard.competition_status === 'ENDED') { renderEnded(); return; }

      if (!dashboard.active_level_id || !dashboard.active_question) { renderAllLevelsLocked(); return; }

      renderQuestion(dashboard);
      const startResult = await startLevelIfNeeded(dashboard);
      if (startResult) startClientTimer(startResult.elapsed_seconds);
    } catch (e) {
      mainPanel.innerHTML = `
        <div class="empty-state">
          <div class="big-icon">⚠</div>
          <h2 style="color:var(--text-0);">Connection lost</h2>
          <p>Trying to reconnect to the competition server...</p>
        </div>`;
    }
  }

  // Lightweight background check: only forces a full re-render when the
  // competition status actually changes (e.g. admin pauses/ends it), so we
  // never blow away an answer the player is mid-way through typing.
  async function pollStatus() {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      const status = data.competition ? data.competition.status : null;
      if (lastKnownStatus === null) { lastKnownStatus = status; return; }
      if (status !== lastKnownStatus) {
        lastKnownStatus = status;
        loadDashboard();
      } else if (!isAnswering) {
        // Safe moment to refresh (e.g. keep progress panel accurate across tabs).
        loadDashboard();
      }
    } catch (e) { /* ignore transient network hiccups */ }
  }

  loadDashboard();
  pollInterval = setInterval(pollStatus, 6000);
})();
