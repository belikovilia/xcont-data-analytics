(function () {
  // Пространство имён для генерации PDF
  const Pdf = {};

  // Кеш шрифтов и логотипа
  const fontCache = { regular: null, bold: null };
  let logoCache = null;

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  async function ensureFonts(doc) {
    const ensureFontVariant = async (variant) => {
      const fileName = variant === 'bold' ? 'Montserrat-Bold.ttf' : 'Montserrat-Regular.ttf';
      const style = variant === 'bold' ? 'bold' : 'normal';
      const cacheKey = variant;
      if (fontCache[cacheKey]) {
        try {
          doc.addFileToVFS(fileName, fontCache[cacheKey]);
          doc.addFont(fileName, 'Montserrat', style);
          return true;
        } catch (_) { /* refetch */ }
      }
      try {
        const res = await fetch(`fonts/${fileName}`);
        if (!res.ok) throw new Error(`${variant} font fetch failed`);
        const buf = await res.arrayBuffer();
        fontCache[cacheKey] = arrayBufferToBase64(buf);
        doc.addFileToVFS(fileName, fontCache[cacheKey]);
        doc.addFont(fileName, 'Montserrat', style);
        return true;
      } catch (e) {
        console.log(`[PDF] ${variant} font error`, e);
        return false;
      }
    };

    const [hasRegular, hasBold] = await Promise.all([
      ensureFontVariant('regular'),
      ensureFontVariant('bold'),
    ]);
    return { hasRegular, hasBold };
  }

  function setFontRegular(doc, hasRegular) {
    if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
  }

  function setFontBold(doc, hasBold, hasRegular) {
    if (hasBold) doc.setFont('Montserrat', 'bold');
    else if (!hasRegular) doc.setFont('helvetica', 'bold');
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function loadLogo() {
    if (logoCache) return logoCache;
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
      logoCache = { dataUrl, widthPx: dims.w, heightPx: dims.h };
      return logoCache;
    } catch (e) {
      console.log('[PDF] Logo error', e);
      return null;
    }
  }

  function ruTimesWord(n) {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return 'раз';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'раза';
    return 'раз';
  }

  function pickTopN(grouped, n) {
    const arr = grouped.summary || [];
    return arr.slice(0, n);
  }

  function buildTopText(caption, grouped, n) {
    const items = pickTopN(grouped, n);
    const lines = [`${caption}`];
    if (items.length === 0) {
      lines.push('—');
    } else {
      for (const it of items) {
        lines.push(`- ${it.title}: ${it.count} ${ruTimesWord(it.count)}`);
        lines.push(''); // Пустая строка для отступа между элементами списка
      }
      if (lines[lines.length - 1] === '') lines.pop(); // Убираем последнюю пустую строку
    }
    return lines.join('\n');
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function drawRoundedCard(doc, x, y, w, h, strokeHex, fillHex) {
    const [sr, sg, sb] = hexToRgb(strokeHex || '#CCCCCC');
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(1.2);
    
    if (fillHex) {
      const [fr, fg, fb] = hexToRgb(fillHex);
      doc.setFillColor(fr, fg, fb);
      doc.roundedRect(x, y, w, h, 24, 24, 'FD');
    } else {
      doc.roundedRect(x, y, w, h, 24, 24, 'S');
    }
  }

  function drawLinesWithBoldCounts(doc, lines, x, startY, lineHeight, hasRegular, hasBold) {
    let y = startY;
    for (const line of lines) {
      const m = line.match(/^(.*?)(\s*:\s*)(\d+)\s+(раз|раза)\s*$/u);
      if (m) {
        const prefix = m[1] + m[2];
        const countStr = m[3] + ' ' + m[4];
        setFontRegular(doc, hasRegular);
        doc.text(prefix, x, y);
        const prefixW = doc.getTextWidth(prefix);
        setFontBold(doc, hasBold, hasRegular);
        doc.text(countStr, x + prefixW, y);
        setFontRegular(doc, hasRegular);
      } else {
        doc.text(line, x, y);
      }
      y += lineHeight;
    }
    return y;
  }

  function renderTopCard(doc, params) {
    const {
      left, top, innerWidth,
      headerText, headerColor, bodyColor, strokeColor, fillColor, bodyRaw,
      headerSize = 16, bodySize = 11, headerSpacing = 20, lineHeight = 14,
      hasRegular, hasBold,
    } = params;

    const pad = 16;
    setFontRegular(doc, hasRegular);
    doc.setFontSize(bodySize);
    const bodyLines = doc.splitTextToSize(bodyRaw, innerWidth - pad * 2);
    
    // Считаем высоту контента и самой карточки
    const contentH = headerSize + headerSpacing + (bodyLines.length * lineHeight);
    const cardH = pad * 2 + contentH;
    const cardX = left - pad;
    const cardY = top;
    const cardW = innerWidth + pad * 2;

    drawRoundedCard(doc, cardX, cardY, cardW, cardH, strokeColor, fillColor);

    // Заголовок
    doc.setFontSize(headerSize);
    doc.setTextColor(headerColor);
    setFontBold(doc, hasBold, hasRegular);
    doc.text(headerText, left, cardY + pad + headerSize - 2);

    // Тело
    setFontRegular(doc, hasRegular);
    doc.setFontSize(bodySize);
    doc.setTextColor(bodyColor);
    const firstLineY = cardY + pad + headerSize + headerSpacing;
    drawLinesWithBoldCounts(doc, bodyLines, left, firstLineY, lineHeight, hasRegular, hasBold);

    return cardY + cardH;
  }

  /* ──────────────────────────────────────────────────────────────
     Генерация мультистраничного PDF (batch)
     Ориентация: альбомная
     ────────────────────────────────────────────────────────────── */
  Pdf.generateBatchReport = async function generateBatchReport(topN, results, mode, meta) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      alert('jsPDF не загружен');
      return;
    }

    // Альбомная ориентация
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const { hasRegular, hasBold } = await ensureFonts(doc);

    let logo = null;
    try { logo = await loadLogo(); } catch (_) { /* ignore */ }

    for (let i = 0; i < results.length; i++) {
      if (i > 0) doc.addPage();
      renderPizzeriaPage(doc, results[i], topN, meta, logo, hasRegular, hasBold);
    }

    if (mode === 'preview') {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } else {
      const name = buildReportFileName(results, meta);
      doc.save(name);
    }
  };

  /**
   * Рендерит одну страницу (одну пиццерию) в PDF-документе.
   */
  function renderPizzeriaPage(doc, result, topN, meta, logo, hasRegular, hasBold) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // 1. Заливаем фон всей страницы светло-серым
    doc.setFillColor(244, 245, 247); // #F4F5F7
    doc.rect(0, 0, pageW, pageH, 'F');

    const left = 48;
    let top = 48;
    const innerWidth = pageW - left * 2;

    // 2. Шапка: Текст слева, Логотип справа
    if (logo) {
      try {
        const targetW = 140; 
        const ratio = logo.heightPx && logo.widthPx ? (logo.heightPx / logo.widthPx) : 0.3;
        const targetH = targetW * ratio;
        doc.addImage(logo.dataUrl, 'PNG', pageW - targetW - left, top, targetW, targetH, undefined, 'FAST');
      } catch (_) { /* ignore */ }
    }

    // Главный заголовок
    doc.setFontSize(20);
    doc.setTextColor('#2b2b2b');
    setFontBold(doc, hasBold, hasRegular);
    doc.text('ТОП критических нарушений', left, top + 20);

    // Подзаголовок
    doc.setFontSize(16);
    doc.setTextColor('#7A7A7A');
    setFontBold(doc, hasBold, hasRegular);
    const periodStr = meta && meta.period ? String(meta.period) : '';
    const subheadText = periodStr ? `${result.name} | ${periodStr}` : result.name;
    doc.text(subheadText, left, top + 42);

    // Отступ до контента
    top += 70; 

    // 3. Блоки нарушений

    // Карточка С10 (Красная)
    const c10Header = 'С10';
    const c10BodyRaw = buildTopText('', result.c10Groups, topN).split('\n').slice(1).join('\n').trim() || '—';
    const c10Bottom = renderTopCard(doc, {
      left, top, innerWidth,
      headerText: c10Header,
      headerColor: '#FF4F4F', bodyColor: '#2b2b2b', strokeColor: '#FF4F4F', fillColor: '#FFF2F2',
      bodyRaw: c10BodyRaw,
      headerSize: 18, bodySize: 11, headerSpacing: 20, lineHeight: 14, 
      hasRegular, hasBold,
    });
    top = c10Bottom + 16; 

    // Карточка С5 (Оранжевая)
    const c5Header = 'С5';
    const c5BodyRaw = buildTopText('', result.c5Groups, topN).split('\n').slice(1).join('\n').trim() || '—';
    const c5Bottom = renderTopCard(doc, {
      left, top, innerWidth,
      headerText: c5Header,
      headerColor: '#FF9933', bodyColor: '#2b2b2b', strokeColor: '#FF9933', fillColor: '#FFF9F2',
      bodyRaw: c5BodyRaw,
      headerSize: 18, bodySize: 11, headerSpacing: 20, lineHeight: 14,
      hasRegular, hasBold,
    });
    top = c5Bottom + 16; 

    // Карточка С3 (Циан)
    const c3Items = (result.c3Groups.summary || []);
    if (c3Items.length > 0) {
      const c3Header = 'С3';
      const c3BodyRaw = buildTopText('', result.c3Groups, topN).split('\n').slice(1).join('\n').trim() || '—';
      renderTopCard(doc, {
        left, top, innerWidth,
        headerText: c3Header,
        headerColor: '#00BCD4', bodyColor: '#2b2b2b', strokeColor: '#00BCD4', fillColor: '#F0FAFB',
        bodyRaw: c3BodyRaw,
        headerSize: 18, bodySize: 11, headerSpacing: 20, lineHeight: 14,
        hasRegular, hasBold,
      });
    }
  }

  function buildReportFileName(results, meta) {
    const period = meta && meta.period ? String(meta.period).trim() : '';
    const parts = [];
    if (results.length === 1) parts.push(results[0].name);
    if (period) parts.push(period);
    parts.push('Отчёт');
    const raw = parts.join('_');
    const safe = raw.replace(/[^\p{L}\p{N}\s_\-().]+/gu, '').replace(/\s+/g, ' ').trim();
    return (safe || 'Отчёт') + '.pdf';
  }

  // Экспорт утилит для app.js
  Pdf.buildTopText = buildTopText;

  window.Pdf = Pdf;
})();
