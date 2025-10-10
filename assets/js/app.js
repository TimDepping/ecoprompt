(function () {
  initThemeToggle();

  const sourcesNode = document.getElementById('data-sources');
  const equivalentsNode = document.getElementById('data-equivalents');
  if (!sourcesNode || !equivalentsNode) {
    return;
  }

  const sourcesData = safeParseJson(sourcesNode.textContent) || {};
  let sources = [];
  if (Array.isArray(sourcesData)) {
    sources = sourcesData;
  } else if (sourcesData && Array.isArray(sourcesData.tabs)) {
    sources = sourcesData.tabs;
  }
  const equivalents = safeParseJson(equivalentsNode.textContent) || [];
  if (!sources.length) {
    return;
  }

  const sourceMap = new Map();
  sources.forEach((source) => {
    if (source && source.id) {
      sourceMap.set(source.id, source);
    }
  });

  const equivalentsByMetric = new Map();
  equivalents.forEach((eq) => {
    if (eq && eq.metric) {
      equivalentsByMetric.set(eq.metric, eq);
    }
  });

  const state = {
    activeSourceId: sources[0]?.id || null,
    promptCount: null,
    metricsBySource: null,
  };

  const els = {
    fileInput: document.getElementById('chat-export-input'),
    uploadHint: document.getElementById('upload-hint'),
    errorBanner: document.getElementById('upload-error'),
    resultHeadline: document.querySelector('[data-result-headline]'),
    resultCard: document.querySelector('[data-result-card]'),
    resultPlaceholder: document.querySelector('[data-results-placeholder]'),
    metricGrid: document.querySelector('[data-results-grid]'),
    openFileButton: document.getElementById('open-file-btn'),
    metricValues: {
      water: document.querySelector('[data-metric-value="water"]'),
      energy: document.querySelector('[data-metric-value="energy"]'),
      co2: document.querySelector('[data-metric-value="co2"]'),
    },
    metricEquivalents: {
      water: document.querySelector('[data-metric-equivalent="water"]'),
      energy: document.querySelector('[data-metric-equivalent="energy"]'),
      co2: document.querySelector('[data-metric-equivalent="co2"]'),
    },
    footnoteText: document.querySelector('[data-result-footnote-text]'),
    footnoteNotes: document.querySelector('[data-result-footnote-notes]'),
    footnoteLink: document.querySelector('[data-result-footnote-ref]'),
    resultButton: document.getElementById('jump-to-results'),
    tabButtons: Array.from(document.querySelectorAll('[data-source-button]')),
  };

  const numberFormatter = new Intl.NumberFormat('de-DE');

  function decimalFormatter(decimals) {
    return new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.max(0, decimals || 0),
    });
  }

  const metricDisplayConfig = {
    water: {
      unitLabel: 'Milliliter Wasser',
      formatValue: (totalMl) => decimalFormatter(0).format(totalMl),
    },
    energy: {
      unitLabel: 'Wattstunden',
      formatValue: (totalWh) => decimalFormatter(2).format(totalWh),
    },
    co2: {
      unitLabel: 'g CO₂',
      formatValue: (totalG) => decimalFormatter(0).format(totalG),
    },
  };

  function safeParseJson(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Konnte eingebettete Daten nicht lesen', error);
      return null;
    }
  }

  function formatInteger(value) {
    return numberFormatter.format(value);
  }

  function setActiveSource(id) {
    if (!sourceMap.has(id)) {
      return;
    }
    state.activeSourceId = id;
    els.tabButtons.forEach((btn) => {
      const isActive = btn.dataset.sourceButton === id;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    renderFootnote();
    renderMetrics();
  }

  function computeMetrics(promptCount) {
    const metrics = {};
    sourceMap.forEach((source) => {
      const waterMl = promptCount * parseFloat(source.water_ml_per_prompt || 0);
      const energyWh = promptCount * parseFloat(source.energy_wh_per_prompt || 0);
      const co2PerWh = parseFloat(source.co2_g_per_wh || 0);
      const co2g = energyWh * co2PerWh;
      metrics[source.id] = {
        promptCount,
        waterMl,
        energyWh,
        co2g,
      };
    });
    return metrics;
  }

  function renderMetrics() {
    if (!els.metricGrid || !els.resultHeadline) return;
    if (!state.metricsBySource || !state.activeSourceId) {
      els.metricGrid.classList.add('is-dimmed');
      els.resultPlaceholder?.classList.remove('is-hidden');
      els.resultHeadline.textContent =
        'Deine Werte erscheinen hier, sobald du deinen Export lädst.';
      Object.values(els.metricValues).forEach((el) => {
        if (el) el.textContent = '—';
      });
      Object.values(els.metricEquivalents).forEach((el) => {
        if (el) el.textContent = '—';
      });
      updateResultButtonState(false);
      updateResultCardLabel();
      return;
    }

    const metrics = state.metricsBySource[state.activeSourceId];
    if (!metrics) {
      return;
    }

    els.metricGrid.classList.remove('is-dimmed');
    els.resultPlaceholder?.classList.add('is-hidden');
    els.resultHeadline.textContent = `Deine ${formatInteger(metrics.promptCount)} Prompts verbrauchten:`;

    const waterDisplay = metricDisplayConfig.water;
    const energyDisplay = metricDisplayConfig.energy;
    const co2Display = metricDisplayConfig.co2;

    if (els.metricValues.water) {
      els.metricValues.water.textContent = `${waterDisplay.formatValue(metrics.waterMl)} ${waterDisplay.unitLabel}`;
    }
    if (els.metricValues.energy) {
      els.metricValues.energy.textContent = `${energyDisplay.formatValue(metrics.energyWh)} ${energyDisplay.unitLabel}`;
    }
    if (els.metricValues.co2) {
      els.metricValues.co2.textContent = `${co2Display.formatValue(metrics.co2g)} ${co2Display.unitLabel}`;
    }

    if (els.metricEquivalents.water) {
      els.metricEquivalents.water.textContent = formatEquivalent('water', metrics.waterMl);
    }
    if (els.metricEquivalents.energy) {
      els.metricEquivalents.energy.textContent = formatEquivalent('energy', metrics.energyWh);
    }
    if (els.metricEquivalents.co2) {
      els.metricEquivalents.co2.textContent = formatEquivalent('co2', metrics.co2g);
    }

    updateResultButtonState(true);
    updateResultCardLabel();
  }

  function formatEquivalent(metric, totalValue) {
    const eq = equivalentsByMetric.get(metric);
    if (!eq || !eq.unit_value) {
      return '—';
    }
    const unitValue = parseFloat(eq.unit_value);
    if (!unitValue) {
      return '—';
    }
    const precision = Number.isFinite(eq.precision) ? eq.precision : 2;
    const count = totalValue / unitValue;
    const formatter = decimalFormatter(Math.max(0, precision));
    return `≈ ${formatter.format(count)} ${eq.label}`;
  }

  function getEquivalentNotes() {
    const order = ['water', 'energy', 'co2'];
    const items = [];
    order.forEach((metric) => {
      const eq = equivalentsByMetric.get(metric);
      if (!eq) {
        return;
      }
      const note = eq.note ? String(eq.note).trim() : '';
      if (!note) {
        return;
      }
      const label = eq.label ? String(eq.label).trim() : '';
      items.push(label ? `${label}: ${note}` : note);
    });
    return items;
  }

  function renderEquivalentNotes(notes) {
    if (!els.footnoteNotes) {
      return;
    }
    els.footnoteNotes.replaceChildren();
    if (!notes || !notes.length) {
      els.footnoteNotes.style.display = 'none';
      return;
    }
    els.footnoteNotes.style.display = '';
    const heading = document.createElement('span');
    heading.className = 'result-footnote__heading';
    heading.textContent = 'Vergleichswerte';
    els.footnoteNotes.appendChild(heading);
    notes.forEach((entry) => {
      const item = document.createElement('span');
      item.className = 'result-footnote__item';
      item.textContent = entry;
      els.footnoteNotes.appendChild(item);
    });
  }

  function renderFootnote() {
    if (!els.footnoteText || !els.footnoteLink || !state.activeSourceId) {
      return;
    }
    const source = sourceMap.get(state.activeSourceId);
    if (!source || !source.footnote) {
      return;
    }
    const summary = source.footnote.summary ? String(source.footnote.summary).trim() : '';
    const equivalentNotes = getEquivalentNotes();
    els.footnoteText.textContent = summary;
    renderEquivalentNotes(equivalentNotes);
    els.footnoteLink.textContent = source.footnote.label || '';
    if (source.footnote.anchor_id) {
      els.footnoteLink.setAttribute('href', `#${source.footnote.anchor_id}`);
    }
  }

  function updateResultCardLabel() {
    if (!els.resultCard) return;
    if (!state.activeSourceId) return;
    const source = sourceMap.get(state.activeSourceId);
    if (!source) return;
    const base = 'Auswertung basierend auf';
    els.resultCard.setAttribute('aria-label', `${base} ${source.label}`);
  }

  function updateResultButtonState(hasData) {
    if (!els.resultButton) return;
    if (hasData) {
      els.resultButton.removeAttribute('disabled');
      els.resultButton.setAttribute('aria-disabled', 'false');
    } else {
      els.resultButton.setAttribute('disabled', 'disabled');
      els.resultButton.setAttribute('aria-disabled', 'true');
    }
  }

  function resetState() {
    state.promptCount = null;
    state.metricsBySource = null;
    updateUploadHint();
    renderMetrics();
  }

  function updateUploadHint(promptCount) {
    if (!els.uploadHint) return;
    if (promptCount) {
      els.uploadHint.textContent = `${formatInteger(promptCount)} Prompts erkannt.`;
      els.uploadHint.classList.remove('is-hidden');
    } else {
      els.uploadHint.textContent = '';
      els.uploadHint.classList.add('is-hidden');
    }
  }

  function clearError() {
    if (!els.errorBanner) return;
    els.errorBanner.classList.add('is-hidden');
    els.errorBanner.textContent = '';
  }

  function showError(message) {
    if (!els.errorBanner) return;
    els.errorBanner.textContent = message;
    els.errorBanner.classList.remove('is-hidden');
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    clearError();
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const promptCount = extractPromptCount(data);
      if (!promptCount) {
        throw new Error('Keine Prompts gefunden');
      }
      state.promptCount = promptCount;
      state.metricsBySource = computeMetrics(promptCount);
      updateUploadHint(promptCount);
      renderMetrics();
    } catch (error) {
      console.error('Fehler beim Verarbeiten der Datei', error);
      showError(
        'Die Datei konnte nicht verarbeitet werden. Bitte wähle die Datei "conversations.json" aus deinem ChatGPT-Export aus.'
      );
      resetState();
    } finally {
      if (els.fileInput) {
        els.fileInput.value = '';
      }
    }
  }

  function extractPromptCount(data) {
    const conversations = Array.isArray(data)
      ? data
      : Array.isArray(data?.conversations)
      ? data.conversations
      : null;
    if (!conversations) {
      throw new Error('Unerwartetes Dateiformat');
    }
    let count = 0;
    conversations.forEach((conv) => {
      if (!conv?.mapping) return;
      const nodes = Object.values(conv.mapping);
      nodes.forEach((node) => {
        const authorRole = node?.message?.author?.role;
        if (authorRole === 'user') {
          count += 1;
        }
      });
    });
    return count;
  }

  function handleResultButtonClick() {
    if (!state.metricsBySource || !state.activeSourceId) {
      return;
    }
    const target = document.getElementById('results-title');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function initThemeToggle() {
    const toggle = document.querySelector('[data-theme-toggle]');
    if (!toggle || !document.body) {
      return;
    }

    const iconSun = toggle.querySelector('.theme-toggle__icon--sun');
    const iconMoon = toggle.querySelector('.theme-toggle__icon--moon');
    const mediaQuery = window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const storageKey = 'ecoprompt-theme';

    function readStoredTheme() {
      try {
        const value = window.localStorage.getItem(storageKey);
        return value === 'dark' || value === 'light' ? value : null;
      } catch (error) {
        return null;
      }
    }

    function persistTheme(theme) {
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch (error) {
        /*
         * Ignore persistence errors (e.g. disabled storage, private mode)
         * so the toggle keeps working without storage.
         */
      }
    }

    function applyTheme(theme, options = {}) {
      document.body.classList.remove('dark', 'light');
      document.body.classList.add(theme);
      toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      toggle.setAttribute('data-theme', theme);
      toggle.setAttribute(
        'aria-label',
        theme === 'dark'
          ? 'In helles Design wechseln'
          : 'In dunkles Design wechseln'
      );
      if (iconSun && iconMoon) {
        iconSun.setAttribute('aria-hidden', 'true');
        iconMoon.setAttribute('aria-hidden', 'true');
      }
      if (options.persist) {
        persistTheme(theme);
      }
    }

    const storedTheme = readStoredTheme();
    let manualOverride = storedTheme !== null;
    let activeTheme = storedTheme
      ? storedTheme
      : document.body.classList.contains('light')
        ? 'light'
        : document.body.classList.contains('dark')
          ? 'dark'
          : mediaQuery && mediaQuery.matches
            ? 'dark'
            : 'light';

    applyTheme(activeTheme, { persist: manualOverride });

    toggle.addEventListener('click', () => {
      activeTheme = activeTheme === 'dark' ? 'light' : 'dark';
      manualOverride = true;
      applyTheme(activeTheme, { persist: true });
    });

    if (mediaQuery) {
      const listener = (event) => {
        if (manualOverride) {
          return;
        }
        activeTheme = event.matches ? 'dark' : 'light';
        applyTheme(activeTheme);
      };

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', listener);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(listener);
      }
    }
  }

  function bindEvents() {
    if (els.fileInput) {
      els.fileInput.addEventListener('change', handleFileChange);
    }
    if (els.openFileButton && els.fileInput) {
      els.openFileButton.addEventListener('click', () => {
        els.fileInput.click();
      });
    }
    if (els.resultButton) {
      els.resultButton.addEventListener('click', handleResultButtonClick);
    }
    els.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        setActiveSource(btn.dataset.sourceButton);
      });
    });
  }

  bindEvents();
  renderFootnote();
  updateUploadHint();
  renderMetrics();
})();
