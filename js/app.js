(function () {
  const input = document.getElementById('pdfInput');
  const fileNameEl = document.getElementById('fileName');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');
  const pagesCountEl = document.getElementById('pagesCount');
  const c5CountEl = document.getElementById('c5Count');
  const c10CountEl = document.getElementById('c10Count');
  const c5CountInlineEl = document.getElementById('c5CountInline');
  const c10CountInlineEl = document.getElementById('c10CountInline');
  const listC5 = document.getElementById('listC5');
  const listC10 = document.getElementById('listC10');
  const groupC5List = document.getElementById('groupC5List');
  const groupC10List = document.getElementById('groupC10List');
  const c5GroupedTotalEl = document.getElementById('c5GroupedTotal');
  const c10GroupedTotalEl = document.getElementById('c10GroupedTotal');
  const ungroupedC5 = document.getElementById('ungroupedC5');
  const ungroupedC10 = document.getElementById('ungroupedC10');

  // Отключаем воркер, чтобы можно было открыть файл просто двойным кликом по index.html
  if (window['pdfjsLib']) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    } catch (_) {
      // ignore
    }
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function isDebug() {
    const el = document.getElementById('toggleDebug');
    return !!(el && el.checked);
  }

  function debugLog(...args) {
    if (isDebug()) {
      // eslint-disable-next-line no-console
      console.log('[PDF-DEBUG]', ...args);
    }
  }

  function resetUI() {
    pagesCountEl.textContent = '–';
    c5CountEl.textContent = '0';
    c10CountEl.textContent = '0';
    c5CountInlineEl.textContent = '0';
    c10CountInlineEl.textContent = '0';
    listC5.innerHTML = '';
    listC10.innerHTML = '';
    groupC5List.innerHTML = '';
    groupC10List.innerHTML = '';
    c5GroupedTotalEl.textContent = '0';
    c10GroupedTotalEl.textContent = '0';
    ungroupedC5.innerHTML = '';
    ungroupedC10.innerHTML = '';
    resultsEl.classList.add('hidden');
  }

  function normalizeText(text) {
    // NBSP -> space; приведение латиницы к кириллице для похожих букв
    return latinToCyrillic(text.replace(/\u00A0/g, ' '));
  }

  function latinToCyrillic(input) {
    // Преобразуем похожие латинские символы в кириллицу, чтобы ключи совпадали
    const map = {
      A: 'А', a: 'а',
      B: 'В', b: 'в',
      C: 'С', c: 'с',
      E: 'Е', e: 'е',
      H: 'Н', h: 'н',
      K: 'К', k: 'к',
      M: 'М', m: 'м',
      O: 'О', o: 'о',
      P: 'Р', p: 'р',
      T: 'Т', t: 'т',
      X: 'Х', x: 'х',
      Y: 'У', y: 'у',
    };
    let out = '';
    for (const ch of input) {
      out += map[ch] || ch;
    }
    return out;
  }

  function extractSegmentsFromLines(lines, key) {
    // Поддерживаем перенос описания на следующую строку, если после токена пусто
    const keyVariant = key.replace('С', '[Сс]');
    const tokenRe = new RegExp(`(?:^|\\s)(${keyVariant})(?:\\s*(?:[xX×*хХ]\\s*(\\d+)))?`, 'gu');
    const segments = [];
    let pending = [];
    for (const rawLine of lines) {
      // Пропустить сводные строки
      const bracketRefs = rawLine.match(/\[\s*\d+\s*\]/g);
      if (bracketRefs && bracketRefs.length >= 3) continue;
      const cleanedLine = rawLine.replace(/\[\s*\d+\s*\]/g, '');
      const line = normalizeText(cleanedLine);
      if (isDebug() && /\b[Сс]10?\b/.test(line)) {
        debugLog('LINE', key, line);
      }

      tokenRe.lastIndex = 0;
      const matches = [];
      let m;
      while ((m = tokenRe.exec(line)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        const multi = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;
        matches.push({ start, end, multi });
        debugLog('TOK', key, { at: start, len: end - start, multi });
      }

      if (matches.length === 0) {
        const desc = line.trim();
        if (pending.length > 0 && desc.length > 0) {
          for (const pend of pending) {
            const text = `${key}${pend.multi > 1 ? `*${pend.multi}` : ''} ${desc}`.trim();
            segments.push({ text, matchText: desc, count: pend.multi });
            debugLog('SEG_MERGE_NEXT', key, { seg: desc, multi: pend.multi });
          }
          pending = [];
        }
        continue;
      }

      if (pending.length > 0) {
        const pre = line.slice(0, matches[0].start).trim();
        if (pre.length > 0) {
          for (const pend of pending) {
            const text = `${key}${pend.multi > 1 ? `*${pend.multi}` : ''} ${pre}`.trim();
            segments.push({ text, matchText: pre, count: pend.multi });
            debugLog('SEG_PREV_FLUSH', key, { seg: pre, multi: pend.multi });
          }
          pending = [];
        }
      }

      for (let i = 0; i < matches.length; i += 1) {
        const segStart = matches[i].end;
        const segEnd = i + 1 < matches.length ? matches[i + 1].start : line.length;
        let segText = line.slice(segStart, segEnd).trim();
        let segMul = matches[i].multi;
        // Учтём множители в любом месте сегмента (включая хвост)
        const inline = parseInlineMultipliers(segText);
        if (inline.mul > 1) {
          segMul *= inline.mul;
          segText = inline.text;
          debugLog('INLINE_MUL', key, { mul: inline.mul, after: segMul });
        }
        if (segText.length > 0 && /\p{L}|\p{N}/u.test(segText)) {
          const text = `${key}${segMul > 1 ? `*${segMul}` : ''} ${segText}`.trim();
          segments.push({ text, matchText: segText, count: segMul });
          debugLog('SEG', key, { seg: segText, multi: segMul });
        } else {
          pending.push({ multi: segMul });
          debugLog('PENDING', key, { multi: segMul });
        }
      }
    }
    if (pending.length > 0) {
      debugLog('PENDING_LEFT', key, pending.map((p) => p.multi));
    }
    return segments;
  }

  function parseInlineMultipliers(text) {
    // Возвращает очищенный текст и произведение всех найденных множителей в сегменте
    // Поддерживаем символы множителя: *, x, X, х, Х, ×, допускаем отсутствие пробела
    let mul = 1;
    const token = /([xX×*хХ])\s*(\d+)/gu;
    let m;
    while ((m = token.exec(text)) !== null) {
      const value = parseInt(m[2], 10);
      if (!Number.isNaN(value) && value > 1) mul *= value;
    }
    if (mul > 1) {
      // Удаляем все встреченные множители из текста
      text = text.replace(/\s*[xX×*хХ]\s*\d+\s*(?=[\s).,;:-]|$)/gu, ' ').replace(/\s+/g, ' ').trim();
    }
    return { text, mul };
  }

  function renderList(listEl, items) {
    listEl.innerHTML = '';
    for (const { text, count, page } of items) {
      const li = document.createElement('li');
      li.className = 'result-item';
      const countBadge = count > 1 ? `<span class="badge count-badge">×${count}</span>` : '';
      const pageBadge = page ? `<span class="badge page-badge">стр. ${page}</span>` : '';
      li.innerHTML = `${escapeHtml(text)} ${countBadge} ${pageBadge}`;
      listEl.appendChild(li);
    }
  }

  function sumCounts(items) {
    return items.reduce((acc, it) => acc + (typeof it.count === 'number' ? it.count : 0), 0);
  }

  function escapeHtml(str) {
    return str
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  async function readPdfFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true }).promise;
    const pages = pdf.numPages;
    pagesCountEl.textContent = String(pages);

    const pageTexts = [];

    for (let p = 1; p <= pages; p += 1) {
      setStatus(`Извлечение текста: страница ${p}/${pages}…`);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map((it) => (typeof it.str === 'string' ? it.str : ''));
      // Берём исходные фрагменты без склейки и без дедупликации,
      // чтобы не потерять повторяющиеся токены, являющиеся отдельными событиями
      if (p === 1) {
        debugLog('PAGE_SKIP', p, { fragments: strings.length });
        continue; // игнорируем первую страницу целиком
      }
      pageTexts.push({ page: p, lines: strings });
      debugLog('PAGE', p, { fragments: strings.length });
    }

    return pageTexts;
  }

  function analyze(pageTexts) {
    const c5 = [];
    const c10 = [];
    for (const { page, lines } of pageTexts) {
      const c5Segs = extractSegmentsFromLines(lines, 'С5').map((s) => ({ ...s, page }));
      const c10Segs = extractSegmentsFromLines(lines, 'С10').map((s) => ({ ...s, page }));
      c5.push(...c5Segs);
      c10.push(...c10Segs);
    }
    debugLog('ANALYZE_SUM', { c5Segments: c5.length, c10Segments: c10.length, c5Sum: sumCounts(c5), c10Sum: sumCounts(c10) });
    return { c5, c10 };
  }

  // --- Группировка по категориям на основе внешних файлов правил ---
  let rules = { C5: [], C10: [] };
  let rulesLoaded = { c5: false, c10: false };
  let rulesTextRaw = { c5: '', c10: '' };

  function buildRules() {
    return { C5: [], C10: [] };
  }

  function parseRules(text) {
    const lines = text.split(/\r?\n/);
    const groups = [];
    for (let i = 0; i < lines.length; i += 1) {
      const title = lines[i].trim();
      if (!title) continue;
      const values = (lines[i + 1] || '').split(';').map((s) => s.trim()).filter(Boolean);
      groups.push({ title, values });
      i += 1;
    }
    return groups;
  }

  function updateRulesBanner() {
    const banner = document.getElementById('rulesBanner');
    const status = document.getElementById('rulesStatus');
    const okC5 = !!rulesLoaded.c5;
    const okC10 = !!rulesLoaded.c10;
    if (status) status.textContent = `C5: ${okC5 ? 'OK' : '—'}, C10: ${okC10 ? 'OK' : '—'}`;
    if (banner) {
      if (okC5 && okC10) banner.classList.add('hidden');
      else banner.classList.remove('hidden');
    }
  }

  async function loadRulesFromFiles() {
    try {
      const [c5Res, c10Res] = await Promise.allSettled([
        fetch('data/rules_c5.txt'),
        fetch('data/rules_c10.txt'),
      ]);

      if (c5Res.status === 'fulfilled' && c5Res.value && c5Res.value.ok) {
        const txt = await c5Res.value.text();
        rulesTextRaw.c5 = txt;
        rules.C5 = parseRules(txt);
        rulesLoaded.c5 = true;
      }
      if (c10Res.status === 'fulfilled' && c10Res.value && c10Res.value.ok) {
        const txt = await c10Res.value.text();
        rulesTextRaw.c10 = txt;
        rules.C10 = parseRules(txt);
        rulesLoaded.c10 = true;
      }
    } catch (e) {
      // ignore, перейдём на ручную загрузку
    } finally {
      updateRulesBanner();
      debugLog('RULES_LOADED', { c5: rulesLoaded.c5, c10: rulesLoaded.c10 });
    }
  }

  // Обработчики ручной загрузки правил через UI
  const rulesC5Input = document.getElementById('rulesC5File');
  if (rulesC5Input) {
    rulesC5Input.addEventListener('change', async (e) => {
      const file = e.target && e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const txt = await file.text();
        rulesTextRaw.c5 = txt;
        rules.C5 = parseRules(txt);
        rulesLoaded.c5 = true;
        updateRulesBanner();
        debugLog('RULES_C5_UPLOAD', { ok: true });
      } catch (err) {
        debugLog('RULES_C5_UPLOAD', { ok: false, err });
      } finally {
        e.target.value = '';
      }
    });
  }

  const rulesC10Input = document.getElementById('rulesC10File');
  if (rulesC10Input) {
    rulesC10Input.addEventListener('change', async (e) => {
      const file = e.target && e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const txt = await file.text();
        rulesTextRaw.c10 = txt;
        rules.C10 = parseRules(txt);
        rulesLoaded.c10 = true;
        updateRulesBanner();
        debugLog('RULES_C10_UPLOAD', { ok: true });
      } catch (err) {
        debugLog('RULES_C10_UPLOAD', { ok: false, err });
      } finally {
        e.target.value = '';
      }
    });
  }

  // Попытка автозагрузки правил при старте
  loadRulesFromFiles();

  function normalizeForMatch(text) {
    // Канонизация для сопоставления: нижний регистр, ё->е, замена не-букв/цифр на пробел, схлопывание пробелов
    const lowered = normalizeText(text).toLowerCase().replace(/ё/g, 'е');
    return lowered
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildGroupCounters(items, groupSpec) {
    const counters = new Map();
    const byGroupMatchedItems = new Map();
    const index = items.map((x) => ({
      rawText: x.text,
      text: normalizeForMatch(x.text.replace(/\[\s*\d+\s*\]/g, '')),
      textRx: normalizeForRegex(x.text.replace(/\[\s*\d+\s*\]/g, '')),
      count: x.count,
      page: x.page,
    }));

    for (const { title, values } of groupSpec) {
      let sum = 0;
      const accountedItemIdx = new Set();
      const matchedForGroup = [];
      for (const keyword of values) {
        if (!keyword) continue;
        const rx = keywordToRegex(keyword);
        for (let i = 0; i < index.length; i += 1) {
          if (accountedItemIdx.has(i)) continue;
          const item = index[i];
          if (rx.test(item.textRx)) {
            sum += item.count;
            accountedItemIdx.add(i);
            matchedForGroup.push({ text: item.rawText, page: item.page, count: item.count });
          }
        }
      }
      if (sum > 0) {
        counters.set(title, sum);
        byGroupMatchedItems.set(title, matchedForGroup);
      }
    }

    // Негруппированные строки
    const groupedIdx = new Set(
      Array.from(byGroupMatchedItems.values()).flat().map((it) => `${it.page}::${it.text}`)
    );
    // Сгруппируем "Без категории" одинаковые строки и просуммируем множители
    const rawUngrouped = index
      .filter((it) => !groupedIdx.has(`${it.page}::${it.rawText}`))
      .map((it) => ({ text: it.rawText, page: it.page, count: it.count }));

    const groupedMap = new Map();
    for (const it of rawUngrouped) {
      const key = `${it.text}`;
      const prev = groupedMap.get(key);
      if (prev) {
        prev.count += it.count;
        prev.pages.add(it.page);
      } else {
        groupedMap.set(key, { text: it.text, count: it.count, pages: new Set([it.page]) });
      }
    }
    const ungrouped = Array.from(groupedMap.values()).map((x) => ({
      text: x.text,
      page: Array.from(x.pages).sort((a, b) => a - b).join(','),
      count: x.count,
    }));

    // Добавляем как категорию "Прочие нарушения"
    if (ungrouped.length > 0) {
      const othersCount = ungrouped.reduce((acc, it) => acc + (it.count || 0), 0);
      counters.set('Прочие нарушения', othersCount);
      byGroupMatchedItems.set('Прочие нарушения', ungrouped);
    }

    const sorted = Array.from(counters.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]) => ({ title, count }));

    return { summary: sorted, details: byGroupMatchedItems, ungrouped };
  }

  function normalizeForRegex(text) {
    const lowered = normalizeText(text).toLowerCase().replace(/ё/g, 'е');
    // Оставляем только буквы/цифры и пробелы
    return lowered.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function keywordToRegex(keyword) {
    const norm = normalizeForRegex(keyword);
    const tokens = norm.split(' ').filter(Boolean);
    const allowFiller = '(?:\\s+\\p{L}+){0,3}?';
    const parts = tokens.map((tok, idx) => {
      const isLongWord = /^[\p{L}]{4,}$/u.test(tok);
      const isWord = /^[\p{L}]+$/u.test(tok);
      const isNum = /^[\p{N}]+$/u.test(tok);
      let core;
      if (isLongWord && isWord) {
        core = `${escapeRegExp(tok)}[\\p{L}]*`;
      } else {
        core = escapeRegExp(tok);
      }
      if (idx === 0) return core;
      // Между токенами допускаем до 3 произвольных «вставочных» слов
      return `${allowFiller}\\s+${core}`;
    });
    const pattern = parts.join('');
    return new RegExp(`(?:^|\\s)${pattern}(?=\\s|$)`, 'u');
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderGroups(listEl, grouped, showDetails) {
    const { summary, details } = grouped;
    listEl.innerHTML = '';
    for (const { title, count } of summary) {
      const li = document.createElement('li');
      li.className = 'result-item';
      li.innerHTML = `${escapeHtml(title)} <span class="badge count-badge">${count}</span>`;
      if (showDetails) {
        const nested = document.createElement('ol');
        nested.className = 'nested-list';
        const items = details.get(title) || [];
        for (const it of items) {
          const sub = document.createElement('li');
          sub.innerHTML = `${escapeHtml(it.text)} <span class="badge page-badge">стр. ${it.page}</span>${it.count > 1 ? ` <span class="badge count-badge">×${it.count}</span>` : ''}`;
          nested.appendChild(sub);
        }
        li.appendChild(nested);
      }
      listEl.appendChild(li);
    }
  }

  function renderUngrouped(listEl, items) {
    listEl.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'result-item';
      const pages = it.page ? `стр. ${it.page}` : '';
      li.innerHTML = `${escapeHtml(it.text)} ${pages ? `<span class="badge page-badge">${pages}</span>` : ''}${it.count > 1 ? ` <span class="badge count-badge">×${it.count}</span>` : ''}`;
      listEl.appendChild(li);
    }
  }

  // --- Формирование PDF (ТОП-N) ---
  // Кеш шрифтов Montserrat (base64)
  let _pdfFontB64 = null;
  let _pdfFontB64Bold = null;
  let _logoCache = null;

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, slice);
    }
    // eslint-disable-next-line no-undef
    return btoa(binary);
  }

  // Перенесено в pdf.js

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function loadLogo() {
    if (_logoCache) return _logoCache;
    try {
      const res = await fetch('images/logo.png');
      if (!res.ok) throw new Error('logo fetch failed');
      const blob = await res.blob();
      const dataUrl = await blobToDataURL(blob);
      const img = new Image();
      const dims = await new Promise((resolve, reject) => {
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = dataUrl;
      });
      _logoCache = { dataUrl, widthPx: dims.w, heightPx: dims.h };
      return _logoCache;
    } catch (e) {
      debugLog('PDF_LOGO_ERROR', e);
      return null;
    }
  }

  function getTopNFromUI() {
    const sel = document.getElementById('topSelect');
    const n = sel ? parseInt(sel.value, 10) : 3;
    return Number.isFinite(n) && n > 0 ? n : 3;
  }

  // Вспомогательные функции для формирования текстов ТОП перенесены в pdf.js

  // Генерация PDF вынесена в pdf.js (window.Pdf.generateTopReport)

  async function handleFile(file) {
    resetUI();
    fileNameEl.textContent = file ? file.name : 'Файл не выбран';
    if (!file) return;
    try {
      // показать прелоадер
      const preloader = document.getElementById('preloader');
      const loaderText = document.getElementById('loaderText');
      preloader.classList.remove('hidden');
      loaderText.textContent = 'Чтение PDF…';
      if (!window['pdfjsLib']) {
        setStatus('Ошибка: библиотека PDF.js не загружена');
        preloader.classList.add('hidden');
        return;
      }
      setStatus('Чтение PDF…');
      const pageTexts = await readPdfFile(file);
      loaderText.textContent = 'Анализ…';
      setStatus('Анализ…');
      const { c5, c10 } = analyze(pageTexts);
      const c5Total = sumCounts(c5);
      const c10Total = sumCounts(c10);

      c5CountEl.textContent = String(c5Total);
      c10CountEl.textContent = String(c10Total);
      c5CountInlineEl.textContent = String(c5.length);
      c10CountInlineEl.textContent = String(c10.length);
      renderList(listC5, c5);
      renderList(listC10, c10);

      // Группировка по ключевым словам
      const c5Groups = buildGroupCounters(c5, rules.C5);
      const c10Groups = buildGroupCounters(c10, rules.C10);
      const showDetails = document.getElementById('toggleGroupDetails').checked;
      renderGroups(groupC5List, c5Groups, showDetails);
      renderGroups(groupC10List, c10Groups, showDetails);
      renderUngrouped(ungroupedC5, c5Groups.ungrouped);
      renderUngrouped(ungroupedC10, c10Groups.ungrouped);
      c5GroupedTotalEl.textContent = String(c5Groups.summary.reduce((a, b) => a + b.count, 0));
      c10GroupedTotalEl.textContent = String(c10Groups.summary.reduce((a, b) => a + b.count, 0));

      // Сохраняем последний результат для быстрого переключения чекбокса
      const toggle = document.getElementById('toggleGroupDetails');
      toggle._last = { c5Groups, c10Groups };
      // Сохраним в элементы PDF-кнопок
      const topSel = document.getElementById('topSelect');
      if (topSel) topSel._last = { c5Groups, c10Groups };
      const previewBtn = document.getElementById('previewPdfBtn');
      if (previewBtn) previewBtn._last = { c5Groups, c10Groups };
      const downloadBtn = document.getElementById('downloadPdfBtn');
      if (downloadBtn) downloadBtn._last = { c5Groups, c10Groups };

      resultsEl.classList.remove('hidden');
      preloader.classList.add('hidden');
      setStatus('Готово');
    } catch (err) {
      console.error(err);
      const preloader = document.getElementById('preloader');
      preloader.classList.add('hidden');
      setStatus('Ошибка при обработке PDF. Подробности в консоли.');
    }
  }

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    handleFile(file);
  });

  const toggle = document.getElementById('toggleGroupDetails');
  toggle.addEventListener('change', () => {
    // Перерисовать детали групп без повторного парсинга PDF
    // Используем последнюю сохранённую выборку
    if (!toggle._last) return;
    const { c5Groups, c10Groups } = toggle._last;
    renderGroups(groupC5List, c5Groups, toggle.checked);
    renderGroups(groupC10List, c10Groups, toggle.checked);
  });

  // Переключение режимов ввода
  const modePdfBtn = document.getElementById('modePdfBtn');
  const modeTextBtn = document.getElementById('modeTextBtn');
  const inputPdf = document.getElementById('inputPdf');
  const inputText = document.getElementById('inputText');
  function setMode(mode) {
    if (mode === 'pdf') {
      modePdfBtn.classList.add('active');
      modeTextBtn.classList.remove('active');
      inputPdf.classList.remove('hidden');
      inputText.classList.add('hidden');
    } else {
      modeTextBtn.classList.add('active');
      modePdfBtn.classList.remove('active');
      inputText.classList.remove('hidden');
      inputPdf.classList.add('hidden');
    }
  }
  modePdfBtn.addEventListener('click', () => setMode('pdf'));
  modeTextBtn.addEventListener('click', () => setMode('text'));

  // Dev mode по query param ?mode=dev
  (function initDevMode() {
    const params = new URLSearchParams(location.search);
    const isDev = params.get('mode') === 'dev';
    // Элементы дев-режима
    const labelDetails = document.getElementById('labelToggleGroupDetails');
    const labelDebug = document.getElementById('labelToggleDebug');
    const devUngroupedC5 = document.getElementById('devUngroupedC5');
    const devUngroupedC10 = document.getElementById('devUngroupedC10');
    const devListC5 = document.getElementById('devListC5');
    const devListC10 = document.getElementById('devListC10');
    const results = document.getElementById('results');

    if (isDev) {
      // Показать весь аналитический блок и переключатели
      if (labelDetails) labelDetails.classList.remove('hidden');
      if (labelDebug) labelDebug.classList.remove('hidden');
      if (results) results.classList.remove('hidden');
      if (devUngroupedC5) devUngroupedC5.classList.remove('hidden');
      if (devUngroupedC10) devUngroupedC10.classList.remove('hidden');
      // Списки строк останутся скрытыми до анализа, но их контейнеры видимы
      if (devListC5) devListC5.classList.remove('hidden');
      if (devListC10) devListC10.classList.remove('hidden');
    } else {
      // Спрятать отладочные элементы, оставить только ввод/ТОП/PDF
      if (labelDetails) labelDetails.classList.add('hidden');
      if (labelDebug) labelDebug.classList.add('hidden');
      if (devUngroupedC5) devUngroupedC5.classList.add('hidden');
      if (devUngroupedC10) devUngroupedC10.classList.add('hidden');
      if (devListC5) devListC5.classList.add('hidden');
      if (devListC10) devListC10.classList.add('hidden');
    }
  })();

  // Заполнение выпадающего списка периодов (месяцы и 5 недель вперёд)
  // Загрузка периодов из periods.txt
  (async function loadPeriods() {
    const periodSelect = document.getElementById('periodSelect');
    if (!periodSelect) return;
    try {
      const res = await fetch('data/periods.txt');
      if (!res.ok) throw new Error('periods fetch failed');
      const text = await res.text();
      const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        const opt = document.createElement('option');
        opt.value = line;
        opt.textContent = line;
        periodSelect.appendChild(opt);
      }
    } catch (e) {
      showToast('Не удалось загрузить периоды');
    }
  })();

  // Загрузка списка пиццерий из pizzerias.txt
  (async function loadPizzerias() {
    const sel = document.getElementById('storeSelect');
    if (!sel) return;
    try {
      const res = await fetch('data/pizzerias.txt');
      if (!res.ok) throw new Error('pizzerias fetch failed');
      const text = await res.text();
      const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        const opt = document.createElement('option');
        opt.value = line;
        opt.textContent = line;
        sel.appendChild(opt);
      }
    } catch (e) {
      showToast('Не удалось загрузить список пиццерий');
    }
  })();

  // Поиск по списку пиццерий
  (function initPizzeriaSearch() {
    const search = document.getElementById('storeSearch');
    const sel = document.getElementById('storeSelect');
    if (!search || !sel) return;
    search.addEventListener('input', () => {
      const q = (search.value || '').trim().toLowerCase();
      for (const opt of sel.options) {
        if (!opt.value) continue; // пропустить placeholder
        const visible = !q || opt.textContent.toLowerCase().includes(q);
        opt.hidden = !visible;
      }
    });
  })();

  // Анализ текста из textarea
  const analyzeTextBtn = document.getElementById('analyzeTextBtn');
  const textAreaInput = document.getElementById('textAreaInput');
  analyzeTextBtn.addEventListener('click', () => {
    const text = textAreaInput.value || '';
    analyzePlainText(text);
  });

  // Кнопки PDF
  const previewBtn = document.getElementById('previewPdfBtn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (!validateForm()) return;
      const sel = document.getElementById('topSelect');
      const topN = getTopNFromUI();
      const last = (sel && sel._last) || (previewBtn && previewBtn._last);
      if (!last) { showToast('Сначала выполните анализ'); return; }
      const store = document.getElementById('storeSelect').value;
      const period = getPeriodLabel();
      if (window.Pdf && typeof window.Pdf.generateTopReport === 'function') {
        window.Pdf.generateTopReport(topN, last.c5Groups, last.c10Groups, 'preview', { store, period });
      }
    });
  }

  const downloadBtn = document.getElementById('downloadPdfBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (!validateForm()) return;
      const sel = document.getElementById('topSelect');
      const topN = getTopNFromUI();
      const last = (sel && sel._last) || (downloadBtn && downloadBtn._last);
      if (!last) { showToast('Сначала выполните анализ'); return; }
      const store = document.getElementById('storeSelect').value;
      const period = getPeriodLabel();
      if (window.Pdf && typeof window.Pdf.generateTopReport === 'function') {
        window.Pdf.generateTopReport(topN, last.c5Groups, last.c10Groups, 'download', { store, period });
      }
    });
  }

  function showToast(text) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  function validateForm() {
    let ok = true;
    const topEl = document.getElementById('topSelect');
    const storeEl = document.getElementById('storeSelect');
    const periodEl = document.getElementById('periodSelect');
    const errTop = document.getElementById('errTop');
    const errStore = document.getElementById('errStore');
    const errPeriod = document.getElementById('errPeriod');
    // TOP обязателен (всегда выбран), но оставим проверку на всякий случай
    if (!topEl || !topEl.value) { if (errTop) { errTop.textContent = 'Выберите ТОП'; errTop.classList.remove('hidden'); } ok = false; } else if (errTop) errTop.classList.add('hidden');
    // Store обязателен
    if (!storeEl || !storeEl.value) { if (errStore) { errStore.textContent = 'Выберите пиццерию'; errStore.classList.remove('hidden'); } ok = false; } else if (errStore) errStore.classList.add('hidden');
    // Period обязателен
    if (!periodEl || !periodEl.value) { if (errPeriod) { errPeriod.textContent = 'Выберите период'; errPeriod.classList.remove('hidden'); } ok = false; } else if (errPeriod) errPeriod.classList.add('hidden');
    if (!ok) showToast('Заполните обязательные поля');
    return ok;
  }

  function getPeriodLabel() {
    const el = document.getElementById('periodSelect');
    if (!el) return '';
    const opt = el.options[el.selectedIndex];
    return opt ? opt.textContent : '';
  }

  function analyzePlainText(text) {
    resetUI();
    const preloader = document.getElementById('preloader');
    const loaderText = document.getElementById('loaderText');
    preloader.classList.remove('hidden');
    loaderText.textContent = 'Подготовка текста…';

    try {
      // Разобьём текст на строки. Первая страница в текстовом режиме не нужна —
      // но у нас нет разметки страниц, поэтому просто анализируем всё.
      const lines = text.split(/\r?\n/);
      const pageTexts = [{ page: 2, lines }];

      loaderText.textContent = 'Анализ…';
      const { c5, c10 } = analyze(pageTexts);
      const c5Total = sumCounts(c5);
      const c10Total = sumCounts(c10);

      c5CountEl.textContent = String(c5Total);
      c10CountEl.textContent = String(c10Total);
      c5CountInlineEl.textContent = String(c5.length);
      c10CountInlineEl.textContent = String(c10.length);
      renderList(listC5, c5);
      renderList(listC10, c10);

      const c5Groups = buildGroupCounters(c5, rules.C5);
      const c10Groups = buildGroupCounters(c10, rules.C10);
      const showDetails = document.getElementById('toggleGroupDetails').checked;
      renderGroups(groupC5List, c5Groups, showDetails);
      renderGroups(groupC10List, c10Groups, showDetails);
      renderUngrouped(ungroupedC5, c5Groups.ungrouped);
      renderUngrouped(ungroupedC10, c10Groups.ungrouped);
      c5GroupedTotalEl.textContent = String(c5Groups.summary.reduce((a, b) => a + b.count, 0));
      c10GroupedTotalEl.textContent = String(c10Groups.summary.reduce((a, b) => a + b.count, 0));

      const toggle = document.getElementById('toggleGroupDetails');
      toggle._last = { c5Groups, c10Groups };
      const topSel = document.getElementById('topSelect');
      if (topSel) topSel._last = { c5Groups, c10Groups };
      const previewBtn = document.getElementById('previewPdfBtn');
      if (previewBtn) previewBtn._last = { c5Groups, c10Groups };
      const downloadBtn = document.getElementById('downloadPdfBtn');
      if (downloadBtn) downloadBtn._last = { c5Groups, c10Groups };
      resultsEl.classList.remove('hidden');
      document.getElementById('preloader').classList.add('hidden');
      setStatus('Готово');
    } catch (err) {
      console.error(err);
      document.getElementById('preloader').classList.add('hidden');
      setStatus('Ошибка при анализе текста');
    }
  }
})();


