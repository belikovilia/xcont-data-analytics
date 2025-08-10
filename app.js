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

  // --- Группировка по категориям на основе словаря ---
  const rules = buildRules();

  function buildRules() {
    // Встроенные группы и ключевые слова из файла "группировка и кей вордс.txt"
    // Каждая строка: Заголовок категории, следующая строка: варианты через ';'
    const c5Text = `5 и более нарушений по качеству продукта
5 и более нарушений; 5и более нарушений по качеству продукта; 5 и более

Использование щепотки при работе с ингредиентами
щепоткой; щепотка; щепотками; без использования стакана; не использовали стакан; без стаканчика; без стакана

Использование бракованного продукта / не списан брак
борт порвался; бортик порвался; тортилья порвалась; брак не списали; брак не переделали; не списали брак; тесто обрезают; тесто обрезали; обрезал; обрезали

Ингредиенты подняли с линии в продукт / лексан
вернули в линию; вернули в лексан; ингредиенты из пиццы вернули; с линии в продукт; с линии в лексан; подняли продукт с линии; упавший на линию; подняли ингредиент с линии в продукт

Облокачиваются на пищевые поверхности
облокачиваются; облокатились; не опищевили; поверхность не опищевили; облокотились; облокачиваются; облокочиваются; облакатились; облакатался; облакатилась; 

Работа в фартуке с непищевым
уборка в кухонном фартуке; уборка в фартуке; работают с непищевым в фартуке; с телефоном в фартуке; в кухонном фартуке у пк; трамбуют мусорку в фартуке; передвигают мусорку в фартуке; трогают мусорку в фартуке; в наушниках; наушник; наушники; в фартуке

В закрытие не было уборки
не было уборки; в закрытие не отодвигали; не отодвигали линию; не проводилась уборка; столы не отодвигали

В уличной одежде в зеленой зоне
выход на улицу в форме; в уличной одежде в зелёной зоне; в тех же брюках что на улице; в тех же шортах что на улице

Гости убирают столы сами
гости сели за грязный столик; клиент сел за грязный столик; гость убрал столик сам

Нарушения при приготовлении напитков
доливают молоко; не отмеряют сироп; не отмеряют концентрат; добавили молоко в готовый коктейль`;

    const c10Text = `Руки не помыли / без антисептика / без мыла
руки не помыли; руки помыли без мыла; руки помыли без антисептика; руки помыли без мыла и антисептика; руки помыли без мыла, антисептика; руки помыли без антисептика и не до локтя; руки помыли без антисептика перед заготовкой салатов; после желтой зоны руки не помыли; после желтой зоны руки помыли без мыла и антисептика; руки помыли без антисептика; руки после телефона не помыли; руки после уборки не помыли; руки не обработали антисептиком; руки помыли, антисептик вытерли салфеткой; руки не помыли, не обработали антисептиком; надели перчатки, руки не помыли; надели перчатки после мытья рук без антисептика; надели перчатки после мытья рук без мыла; перчатки не заменили; мусор собрали в руку, не помыли

Нарушения при работе с перчатками
антисептик нанесли на перчатки; работа с продуктом без перчаток при наличии пластыря на пальце

Пищевое / Непищевое
непищевая упаковка на пищевом столе; непищевой пакет с продуктом на пищевом столе; непищевые руки трогают пищевое; непищевые руки трогают лотки; непищевые руки трогают лексаны; непищевые руки трогают доски; непищевые руки трогают оборудование; непищевая бумага на пищевом столе; непищевые предметы на пищевом столе; непищевые деньги на пищевом столе; не опищевили поверхность после контакта с непищевым; непищевые ножницы на пищевой поверхности; непищевой нож на продукте; подняли с пола предмет/продукт, не помыли, продолжили работу; после непищевой; химия хранится на одной полке с коробками; не опищевили; упавший предмет не отмыли, продолжили работу; упавший фартук не отправили на стирку; упавшая тряпка использована повторно

Заготовка / фасовка без фартука или перчаток
фасовка без фартука; фасовка без перчаток; фасовка чизкейков без фартука; фасовка десертов без фартука и перчаток; без фартука

Посуда помыта без дезинфектора / не помыта / в дезинфекторе менее 15 минут
посуда помыта без дезинфекции; посуда помыта без мыла; посуда помыта не по стандарту; посуда в дезинфекторе менее 15 минут; мытьё посуды без дезинфекции; посуду оставили на ночь; мытьё бутылок без ёршика; бутылки моют без ёршика; дезинфекция бутылочек менее 15 минут; 15 минут

Нарушение правил проведения МК
не заменили половник, стакан, инвентарь после мероприятия; МК; мастеркласс; мероприятие

Уборка не по стандарту
лексаны протёрты грязной тряпкой; инвентарь для уборки касается пищевого стола; ведро; пульверизатор; бутылка с химией; распыляют; над продуктом; химию с поверхности не смыли; химию не смыли с поверхностей; химия на пищевой поверхности, стол не опищевили; не опищевили поверхность после контакта с химией; не смыли

Заготовка в грязный лексан / смешали старое с новым
использование грязной посуды; грязный лексан; заготовка в грязный лексан; смешали старое с новым; добавили старый продукт в новый; не списали продукт в закрытие; заготовили в старый лексан; досыпали; долили; смешали

Охлажденные / замороженные продукты в тепле дольше 60 минут
продукт в тепле более часа; цыпленок в тепле более часа; лук в тепле более часа; томаты в тепле более часа; перец в тепле более часа; сыр в тепле более часа; шампиньоны в тепле более часа; ветчина в тепле более часа; говядина в тепле более часа; брынза в тепле более часа; молоко в тепле; паста в тепле более часа; ингредиенты в цеху более часа; дольше часа; больше часа; дольше 60; больше 60; 60 и более; 60 и больше; час и больше; час и дольше

Продукт без маркировки / просроченный продукт
хранение готовых продуктов без маркировки; продукт без маркировки; просроченный продукт; продукт с плесенью / гнилью; плесень; гнилой; гниль; плесневелый; плесневелое; плесенью; не маркировали продукт после вскрытия; маркировка; маркировки; таймер; просрочка; просроченное

Растарка не по стандарту
растарка; растаривают; растарили; достают непищевыми руками

Нарушения при работе с тестом
использование холодного теста; использование ненагретого теста; использование несозревшего теста; использование перегретого теста; тесто принимают без перчаток; тесто принимают без фартука, головного убора; тесто на полу; тесто в закрытие не списали; тесто в закрытие не списано

Едят, курят, в зеленой зоне / форме
личные напитки в зеленой зоне; едят в зеленой зоне; жуют в зеленой зоне; курение в форме; бросаются едой; пьют; жуют; едят; курят; парят; парит; 

Безопасность при заготовке салатов и чикен роллов
грязный нож; грязная доска; заготовили на грязной доске; грязная доска и нож; овощи помыты в грязном лексане; айсберг не помыли; черри не помыли; салат не помыли; использование айсберга который касался поверхности стола для салата; айсберг на столе; айсберг; салат; кочан; качан; черри; чери; с линии в салат; из линии в салат; в салат; в чикен ролл; в салат ролл; в ЧР; салат без перчаток; черри без перчаток; айсберг без перчаток

Салат или чикен ролл вне ХЦ
заготовлен вне ХЦ; заготовили вне ХЦ; чикен ролл не в ХЦ; салат не в ХЦ; ЧР не в ХЦ; заготовили в ГЦ; заготовили на упаковке;

Модификация обедов / вынос продукции
вынос продукции; продукт которого нет в меню; нет в меню; обед

Вскрывают продукты не по стандарту
упаковку протыкают ножом/ножницами (риск попадания фрагментов); протыкают; проткнули; воткнули`

    function parse(text) {
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

    return {
      C5: parse(c5Text),
      C10: parse(c10Text),
    };
  }

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

  // Анализ текста из textarea
  const analyzeTextBtn = document.getElementById('analyzeTextBtn');
  const textAreaInput = document.getElementById('textAreaInput');
  analyzeTextBtn.addEventListener('click', () => {
    const text = textAreaInput.value || '';
    analyzePlainText(text);
  });

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


