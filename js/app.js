(function () {
  /* ──────────────────────────────────────────────────────────────
     DOM-элементы
     ────────────────────────────────────────────────────────────── */
  const statusEl           = document.getElementById('status');
  const resultsEl          = document.getElementById('results');
  const pizzeriaCountEl    = document.getElementById('pizzeriaCount');
  const totalC5El          = document.getElementById('totalC5');
  const totalC10El         = document.getElementById('totalC10');
  const totalC3El          = document.getElementById('totalC3');
  const pizzeriaResultsEl  = document.getElementById('pizzeriaResults');
  const analyzeTextBtn     = document.getElementById('analyzeTextBtn');
  const textAreaInput      = document.getElementById('textAreaInput');

  /* ──────────────────────────────────────────────────────────────
     Состояние приложения
     ────────────────────────────────────────────────────────────── */
  const AppState = {
    lastResults: null, // массив { name, c3, c5, c10, c3Groups, c5Groups, c10Groups }
  };

  /* ──────────────────────────────────────────────────────────────
     Утилиты
     ────────────────────────────────────────────────────────────── */
  function setStatus(text) { statusEl.textContent = text || ''; }

  function isDebug() {
    const el = document.getElementById('toggleDebug');
    return !!(el && el.checked);
  }

  function debugLog(...args) {
    if (isDebug()) console.log('[DEBUG]', ...args);
  }

  function escapeHtml(str) {
    return str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function sumCounts(items) {
    return items.reduce((acc, it) => acc + (typeof it.count === 'number' ? it.count : 0), 0);
  }

  function pluralize(n, one, few, many) {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few;
    return many;
  }

  function ruTimesWord(n) {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return 'раз';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'раза';
    return 'раз';
  }

  /* ──────────────────────────────────────────────────────────────
     Нормализация текста
     ────────────────────────────────────────────────────────────── */
  function normalizeText(text) {
    return latinToCyrillic(text.replace(/\u00A0/g, ' '));
  }

  function latinToCyrillic(input) {
    const map = {
      A: 'А', a: 'а', B: 'В', b: 'в', C: 'С', c: 'с',
      E: 'Е', e: 'е', H: 'Н', h: 'н', K: 'К', k: 'к',
      M: 'М', m: 'м', O: 'О', o: 'о', P: 'Р', p: 'р',
      T: 'Т', t: 'т', X: 'Х', x: 'х', Y: 'У', y: 'у',
    };
    let out = '';
    for (const ch of input) out += map[ch] || ch;
    return out;
  }

  function normalizeForMatch(text) {
    const lowered = normalizeText(text).toLowerCase().replace(/ё/g, 'е');
    return lowered.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeForRegex(text) {
    const lowered = normalizeText(text).toLowerCase().replace(/ё/g, 'е');
    return lowered.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  /* ──────────────────────────────────────────────────────────────
     Парсинг текста
     ────────────────────────────────────────────────────────────── */

  /**
   * Очистка названия пиццерии:
   * «Балтийск-1 (💖 XFOOD - в VK!)» → «Балтийск-1»
   */
  function cleanPizzeriaName(rawName) {
    // 1. Убрать всё от первой открывающей скобки
    let name = rawName.replace(/\s*\(.*$/, '');
    // 2. Убрать эмодзи
    name = name.replace(/[\u{1F000}-\u{1FFFF}]/gu, '');
    name = name.replace(/[\u{2600}-\u{27BF}]/gu, '');
    name = name.replace(/[\u{FE00}-\u{FEFF}]/gu, '');
    // 3. Убрать проценты в конце строки (85%, 92.5%)
    name = name.replace(/\s*\d+[.,]?\d*\s*%\s*$/, '');
    return name.trim();
  }

  /**
   * Разбор одной строки нарушения.
   * Входные форматы: C-10, C10, С-10, С10, c-5, C-3, и т.д.
   * Возвращает { category, description, count, text, matchText } или null.
   */
  function parseViolationLine(line) {
    let normalized = line.replace(/\u00A0/g, ' ').trim();
    if (!normalized) return null;

    // Паттерн: [С/C] [опциональное тире] [число] [пробел] [описание] [*кол-во]
    const match = normalized.match(/^[CcСс]-?(\d+)\s+(.+?)(?:\s*\*(\d+))?\s*$/);
    if (!match) return null;

    const num = match[1];
    const category = `С${num}`; // всегда кириллическая С + число
    const description = match[2].trim();
    const count = match[3] ? Math.max(1, parseInt(match[3], 10)) : 1;

    return {
      category,
      description,
      count,
      text: `${category} ${description}`,
      matchText: description,
    };
  }

  /**
   * Разбивает входной текст на блоки пиццерий.
   * Блоки разделены пустыми строками.
   * Первая строка блока — название, остальные — нарушения.
   */
  function parseBlocks(text) {
    const rawBlocks = text.split(/\n\s*\n/);
    const results = [];

    for (const block of rawBlocks) {
      const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      let name, startIdx;

      // Проверяем: первая строка — это название или нарушение?
      const firstLineAsViolation = parseViolationLine(lines[0]);
      if (firstLineAsViolation) {
        name = 'Без названия';
        startIdx = 0;
      } else {
        name = cleanPizzeriaName(lines[0]);
        startIdx = 1;
      }

      if (!name) continue;

      const c3 = [], c5 = [], c10 = [];

      for (let i = startIdx; i < lines.length; i++) {
        const v = parseViolationLine(lines[i]);
        if (v) {
          if (v.category === 'С3') c3.push(v);
          else if (v.category === 'С5') c5.push(v);
          else if (v.category === 'С10') c10.push(v);
          else debugLog('Unknown category', v.category);
        } else {
          debugLog('Unparsed line', lines[i]);
        }
      }

      // Добавляем только если есть хотя бы одно нарушение
      if (c3.length + c5.length + c10.length > 0) {
        results.push({ name, rawName: lines[0], c3, c5, c10 });
      }
    }

    return results;
  }

  /* ──────────────────────────────────────────────────────────────
     Загрузка правил (словарей категорий)
     ────────────────────────────────────────────────────────────── */
  let rules = { C3: [], C5: [], C10: [] };
  let rulesLoaded = { c3: false, c5: false, c10: false };

  function updateRulesStatus() {
    const status = document.getElementById('rulesStatus');
    if (status) {
      status.textContent = `C10: ${rulesLoaded.c10 ? 'ОК' : '—'}, C5: ${rulesLoaded.c5 ? 'ОК' : '—'}, C3: ${rulesLoaded.c3 ? 'ОК' : '—'}`;
    }
    const banner = document.getElementById('rulesBanner');
    if (banner) {
      // Скрыть баннер если обязательные С5 и С10 загружены
      if (rulesLoaded.c5 && rulesLoaded.c10) {
        banner.classList.add('hidden');
      } else {
        banner.classList.remove('hidden');
      }
    }
  }

  function parseRules(text) {
    const lines = text.split(/\r?\n/);
    const groups = [];
    for (let i = 0; i < lines.length; i += 1) {
      const title = lines[i].trim();
      if (!title) continue;
      const values = (lines[i + 1] || '').split(';').map(s => s.trim()).filter(Boolean);
      groups.push({ title, values });
      i += 1;
    }
    return groups;
  }

  async function loadRulesFromFiles() {
    try {
      const [c3Res, c5Res, c10Res] = await Promise.allSettled([
        fetch('data/rules_c3.txt'),
        fetch('data/rules_c5.txt'),
        fetch('data/rules_c10.txt'),
      ]);

      if (c3Res.status === 'fulfilled' && c3Res.value && c3Res.value.ok) {
        rules.C3 = parseRules(await c3Res.value.text());
        rulesLoaded.c3 = true;
      }
      if (c5Res.status === 'fulfilled' && c5Res.value && c5Res.value.ok) {
        rules.C5 = parseRules(await c5Res.value.text());
        rulesLoaded.c5 = true;
      }
      if (c10Res.status === 'fulfilled' && c10Res.value && c10Res.value.ok) {
        rules.C10 = parseRules(await c10Res.value.text());
        rulesLoaded.c10 = true;
      }
    } catch (_) {
      // ignore
    } finally {
      debugLog('RULES_LOADED', { c3: rulesLoaded.c3, c5: rulesLoaded.c5, c10: rulesLoaded.c10 });
      updateRulesStatus();
    }
  }

  // Автозагрузка правил при старте
  loadRulesFromFiles();

  // Ручная загрузка правил
  function setupRuleUpload(inputId, categoryKey) {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          try {
            const text = await file.text();
            rules[categoryKey] = parseRules(text);
            rulesLoaded[categoryKey.toLowerCase()] = true;
            updateRulesStatus();
            showToast('success', `Правила ${categoryKey} загружены`);
          } catch (err) {
            showToast('error', `Ошибка загрузки ${categoryKey}`);
          }
        }
        e.target.value = '';
      });
    }
  }
  setupRuleUpload('rulesC3File', 'C3');
  setupRuleUpload('rulesC5File', 'C5');
  setupRuleUpload('rulesC10File', 'C10');

  /* ──────────────────────────────────────────────────────────────
     Группировка по категориям (fuzzy-matching)
     ────────────────────────────────────────────────────────────── */

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function keywordToRegex(keyword) {
    const norm = normalizeForRegex(keyword);
    const tokens = norm.split(' ').filter(Boolean);
    const allowFiller = '(?:\\s+\\p{L}+){0,3}?';
    const parts = tokens.map((tok, idx) => {
      const isLongWord = /^[\p{L}]{4,}$/u.test(tok);
      const isWord = /^[\p{L}]+$/u.test(tok);
      let core;
      if (isLongWord && isWord) {
        core = `${escapeRegExp(tok)}[\\p{L}]*`;
      } else {
        core = escapeRegExp(tok);
      }
      if (idx === 0) return core;
      return `${allowFiller}\\s+${core}`;
    });
    const pattern = parts.join('');
    return new RegExp(`(?:^|\\s)${pattern}(?=\\s|$)`, 'u');
  }

  /**
   * Группирует нарушения по правилам (keywords → категории).
   * Возвращает { summary: [{title, count}], details: Map, ungrouped: [] }
   */
  function buildGroupCounters(items, groupSpec) {
    const counters = new Map();
    const byGroupMatchedItems = new Map();
    const index = items.map(x => ({
      rawText: x.text,
      text: normalizeForMatch(x.matchText || x.text),
      textRx: normalizeForRegex(x.matchText || x.text),
      count: x.count,
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
            matchedForGroup.push({ text: item.rawText, count: item.count });
          }
        }
      }
      if (sum > 0) {
        counters.set(title, sum);
        byGroupMatchedItems.set(title, matchedForGroup);
      }
    }

    // Негруппированные строки
    const groupedTexts = new Set(
      Array.from(byGroupMatchedItems.values()).flat().map(it => it.text)
    );
    const rawUngrouped = index
      .filter(it => !groupedTexts.has(it.rawText))
      .map(it => ({ text: it.rawText, count: it.count }));

    // Объединяем одинаковые
    const mergedMap = new Map();
    for (const it of rawUngrouped) {
      const prev = mergedMap.get(it.text);
      if (prev) prev.count += it.count;
      else mergedMap.set(it.text, { text: it.text, count: it.count });
    }
    const ungrouped = Array.from(mergedMap.values());

    // Добавляем «Прочие нарушения»
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

  /**
   * Простой список без группировки (когда нет файла правил).
   * Объединяет одинаковые описания и суммирует множители.
   */
  function buildSimpleList(items) {
    const merged = new Map();
    for (const it of items) {
      const key = it.matchText || it.description || it.text;
      const prev = merged.get(key);
      if (prev) prev.count += it.count;
      else merged.set(key, { title: key, count: it.count });
    }
    const summary = Array.from(merged.values()).sort((a, b) => b.count - a.count);
    return { summary, details: new Map(), ungrouped: [] };
  }

  /* ──────────────────────────────────────────────────────────────
     Анализ: парсинг → группировка для каждой пиццерии
     ────────────────────────────────────────────────────────────── */
  function analyzeBlocks(blocks) {
    return blocks.map(block => {
      const c5Groups  = rules.C5.length > 0 ? buildGroupCounters(block.c5, rules.C5)   : buildSimpleList(block.c5);
      const c10Groups = rules.C10.length > 0 ? buildGroupCounters(block.c10, rules.C10) : buildSimpleList(block.c10);
      const c3Groups  = rules.C3.length > 0 ? buildGroupCounters(block.c3, rules.C3)    : buildSimpleList(block.c3);

      return {
        name: block.name,
        rawName: block.rawName,
        c3: block.c3,
        c5: block.c5,
        c10: block.c10,
        c3Groups,
        c5Groups,
        c10Groups,
      };
    });
  }

  /* ──────────────────────────────────────────────────────────────
     Рендеринг результатов
     ────────────────────────────────────────────────────────────── */

  function resetUI() {
    pizzeriaCountEl.textContent = '0';
    totalC5El.textContent = '0';
    totalC10El.textContent = '0';
    totalC3El.textContent = '0';
    pizzeriaResultsEl.innerHTML = '';
    resultsEl.classList.add('hidden');
    const textSec = document.getElementById('textReportSection');
    if (textSec) textSec.classList.add('hidden');
  }

  function renderAllResults(results) {
    resetUI();

    if (results.length === 0) {
      setStatus('Нарушения не найдены');
      return;
    }

    pizzeriaCountEl.textContent = String(results.length);

    let tC5 = 0, tC10 = 0, tC3 = 0;

    for (const r of results) {
      tC5 += sumCounts(r.c5);
      tC10 += sumCounts(r.c10);
      tC3 += sumCounts(r.c3);

      const card = createPizzeriaCard(r);
      pizzeriaResultsEl.appendChild(card);
    }

    totalC5El.textContent = String(tC5);
    totalC10El.textContent = String(tC10);
    totalC3El.textContent = String(tC3);

    AppState.lastResults = results;

    resultsEl.classList.remove('hidden');
    const preloader = document.getElementById('preloader');
    if (preloader) preloader.classList.add('hidden');
    setStatus(`Готово — обработано ${results.length} ${pluralize(results.length, 'пиццерия', 'пиццерии', 'пиццерий')}`);
  }

  function createPizzeriaCard(result) {
    const card = document.createElement('div');
    card.className = 'pizzeria-card';

    const c5Sum = sumCounts(result.c5);
    const c10Sum = sumCounts(result.c10);
    const c3Sum = sumCounts(result.c3);
    const topN = getTopNFromUI();

    let html = `
      <div class="pizzeria-card-header">
        <h3 class="pizzeria-name">${escapeHtml(result.name)}</h3>
        <div class="pizzeria-badges">
          ${c10Sum > 0 ? `<span class="badge c10-badge">С10: ${c10Sum}</span>` : ''}
          ${c5Sum > 0 ? `<span class="badge c5-badge">С5: ${c5Sum}</span>` : ''}
          ${c3Sum > 0 ? `<span class="badge c3-badge">С3: ${c3Sum}</span>` : ''}
        </div>
      </div>`;

    // С10
    if (result.c10Groups.summary.length > 0) {
      html += `<details open>
        <summary>ТОП-${topN} С10 (${c10Sum})</summary>
        <ol class="result-list">${renderGroupItems(result.c10Groups, topN)}</ol>
      </details>`;
    }

    // С5
    if (result.c5Groups.summary.length > 0) {
      html += `<details open>
        <summary>ТОП-${topN} С5 (${c5Sum})</summary>
        <ol class="result-list">${renderGroupItems(result.c5Groups, topN)}</ol>
      </details>`;
    }

    // С3
    if (result.c3Groups.summary.length > 0) {
      html += `<details>
        <summary>С3 (${c3Sum})</summary>
        <ol class="result-list">${renderGroupItems(result.c3Groups, topN)}</ol>
      </details>`;
    }

    card.innerHTML = html;
    return card;
  }

  function renderGroupItems(grouped, topN) {
    const items = grouped.summary.slice(0, topN);
    return items.map(it =>
      `<li class="result-item">${escapeHtml(it.title)} <span class="badge count-badge">${it.count}</span></li>`
    ).join('');
  }

  /* ──────────────────────────────────────────────────────────────
     Текстовый отчёт (batch)
     ────────────────────────────────────────────────────────────── */
  function buildBatchTextReport(topN, results, period) {
    const sections = [];

    for (const r of results) {
      const lines = [];
      lines.push(r.name);
      if (period) lines.push(period);
      lines.push('');

      // С10
      const c10Items = (r.c10Groups.summary || []).slice(0, topN);
      lines.push(`ТОП-${topN} С10:`);
      if (c10Items.length === 0) { lines.push('—'); }
      else { for (const it of c10Items) lines.push(`- ${it.title}: ${it.count} ${ruTimesWord(it.count)}`); }
      lines.push('');

      // С5
      const c5Items = (r.c5Groups.summary || []).slice(0, topN);
      lines.push(`ТОП-${topN} С5:`);
      if (c5Items.length === 0) { lines.push('—'); }
      else { for (const it of c5Items) lines.push(`- ${it.title}: ${it.count} ${ruTimesWord(it.count)}`); }

      // С3
      const c3Items = (r.c3Groups.summary || []).slice(0, topN);
      if (c3Items.length > 0) {
        lines.push('');
        lines.push('С3:');
        for (const it of c3Items) lines.push(`- ${it.title}: ${it.count} ${ruTimesWord(it.count)}`);
      }

      sections.push(lines.join('\n'));
    }

    const header = 'Отчёт по онлайн-проверкам';
    const divider = '═'.repeat(40);
    const headerBlock = period ? `${header}\n${period}` : header;

    return [headerBlock, '', divider, '', sections.join(`\n\n${divider}\n\n`)].join('\n');
  }

  /* ──────────────────────────────────────────────────────────────
     UI-хелперы
     ────────────────────────────────────────────────────────────── */
  function getTopNFromUI() {
    const sel = document.getElementById('topSelect');
    const n = sel ? parseInt(sel.value, 10) : 3;
    return Number.isFinite(n) && n > 0 ? n : 3;
  }

  function getPeriodLabel() {
    const el = document.getElementById('periodSelect');
    if (!el) return '';
    const opt = el.options[el.selectedIndex];
    return opt && opt.value ? opt.textContent : '';
  }

  function validateForm() {
    let ok = true;
    const periodEl = document.getElementById('periodSelect');
    const errPeriod = document.getElementById('errPeriod');

    if (!periodEl || !periodEl.value) {
      if (errPeriod) { errPeriod.textContent = 'Выберите период'; errPeriod.classList.remove('hidden'); }
      ok = false;
    } else if (errPeriod) {
      errPeriod.classList.add('hidden');
    }

    if (!AppState.lastResults || AppState.lastResults.length === 0) {
      showToast('warning', 'Сначала выполните анализ');
      return false;
    }

    if (!ok) showToast('warning', 'Заполните обязательные поля');
    return ok;
  }

  function showToast(typeOrText, maybeText) {
    const el = document.getElementById('toast');
    if (!el) return;
    const type = maybeText ? String(typeOrText) : 'info';
    const text = maybeText ? String(maybeText) : String(typeOrText);
    el.classList.remove('success', 'warning', 'error', 'info');
    if (['success', 'warning', 'error', 'info'].includes(type)) el.classList.add(type);
    else el.classList.add('info');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  /* ──────────────────────────────────────────────────────────────
     Запуск анализа
     ────────────────────────────────────────────────────────────── */
  function runAnalysis(text, onDone) {
    resetUI();
    if (!text.trim()) {
      showToast('warning', 'Введите текст для анализа');
      if (onDone) onDone();
      return;
    }

    const preloader = document.getElementById('preloader');
    const loaderText = document.getElementById('loaderText');
    preloader.classList.remove('hidden');
    loaderText.textContent = 'Анализ…';

    // Откладываем тяжёлую работу на следующий кадр,
    // чтобы прелоадер успел отрисоваться
    setTimeout(() => {
      try {
        const blocks = parseBlocks(text);
        debugLog('BLOCKS', blocks.length, blocks.map(b => b.name));

        if (blocks.length === 0) {
          preloader.classList.add('hidden');
          showToast('warning', 'Не удалось найти блоки пиццерий в тексте');
          setStatus('Блоки пиццерий не найдены');
          return;
        }

        const results = analyzeBlocks(blocks);
        renderAllResults(results);
      } catch (err) {
        console.error(err);
        document.getElementById('preloader').classList.add('hidden');
        setStatus('Ошибка при анализе текста');
      } finally {
        if (onDone) onDone();
      }
    }, 0);
  }

  /* ──────────────────────────────────────────────────────────────
     Обработчики событий
     ────────────────────────────────────────────────────────────── */

  // Кнопка «Анализировать»
  analyzeTextBtn.addEventListener('click', () => {
    analyzeTextBtn.disabled = true;
    runAnalysis(textAreaInput.value || '', () => {
      analyzeTextBtn.disabled = false;
    });
  });

  // Загрузка периодов из periods.txt
  (async function loadPeriods() {
    const periodSelect = document.getElementById('periodSelect');
    if (!periodSelect) return;
    try {
      const res = await fetch('data/periods.txt');
      if (!res.ok) throw new Error('periods fetch failed');
      const text = await res.text();
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        const opt = document.createElement('option');
        opt.value = line;
        opt.textContent = line;
        periodSelect.appendChild(opt);
      }
    } catch (_) {
      showToast('warning', 'Не удалось загрузить периоды');
    }
  })();

  // Кнопка «Предпросмотр PDF»
  const previewBtn = document.getElementById('previewPdfBtn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (!validateForm()) return;
      const topN = getTopNFromUI();
      const period = getPeriodLabel();
      if (window.Pdf && typeof window.Pdf.generateBatchReport === 'function') {
        window.Pdf.generateBatchReport(topN, AppState.lastResults, 'preview', { period });
      }
    });
  }

  // Кнопка «Скачать PDF»
  const downloadBtn = document.getElementById('downloadPdfBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (!validateForm()) return;
      const topN = getTopNFromUI();
      const period = getPeriodLabel();
      if (window.Pdf && typeof window.Pdf.generateBatchReport === 'function') {
        window.Pdf.generateBatchReport(topN, AppState.lastResults, 'download', { period });
      }
    });
  }

  // Кнопка «Текстовый отчёт»
  const textReportBtn = document.getElementById('textReportBtn');
  if (textReportBtn) {
    textReportBtn.addEventListener('click', () => {
      if (!validateForm()) return;
      if (!AppState.lastResults || AppState.lastResults.length === 0) {
        showToast('warning', 'Сначала выполните анализ');
        return;
      }
      const topN = getTopNFromUI();
      const period = getPeriodLabel();
      const text = buildBatchTextReport(topN, AppState.lastResults, period);
      const sec = document.getElementById('textReportSection');
      const pre = document.getElementById('textReport');
      if (pre) pre.textContent = text;
      if (sec) sec.classList.remove('hidden');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Кнопка «Копировать» текстовый отчёт
  const copyTextReportBtn = document.getElementById('copyTextReportBtn');
  if (copyTextReportBtn) {
    copyTextReportBtn.addEventListener('click', async () => {
      const pre = document.getElementById('textReport');
      const text = pre ? pre.textContent : '';
      if (!text) { showToast('warning', 'Нет данных для копирования'); return; }
      try {
        await navigator.clipboard.writeText(text);
        showToast('success', 'Скопировано');
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('success', 'Скопировано'); }
        catch (e) { showToast('error', 'Не удалось скопировать'); }
        document.body.removeChild(ta);
      }
    });
  }

  // Drag-and-drop .txt файлов на зону ввода
  (function initDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const txtInput = document.getElementById('txtFileInput');
    const textarea = document.getElementById('textAreaInput');
    if (!dropZone || !textarea) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', async (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        textarea.value = text;
        runAnalysis(text);
      } catch (err) {
        showToast('error', 'Ошибка чтения файла');
      }
    });

    // Кнопка «Загрузить .txt»
    if (txtInput) {
      txtInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          textarea.value = text;
          runAnalysis(text);
        } catch (err) {
          showToast('error', 'Ошибка чтения файла');
        }
        e.target.value = '';
      });
    }
  })();

  // Dev-режим по query param ?mode=dev
  (function initDevMode() {
    const params = new URLSearchParams(location.search);
    const isDev = params.get('mode') === 'dev';
    const labelDetails = document.getElementById('labelToggleGroupDetails');
    const labelDebug = document.getElementById('labelToggleDebug');
    if (isDev) {
      if (labelDetails) labelDetails.classList.remove('hidden');
      if (labelDebug) labelDebug.classList.remove('hidden');
    }
  })();
})();
