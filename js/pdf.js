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
        lines.push('');
      }
      if (lines[lines.length - 1] === '') lines.pop();
    }
    return lines.join('\n');
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function drawRoundedCard(doc, x, y, w, h, strokeHex) {
    const [r, g, b] = hexToRgb(strokeHex || '#CCCCCC');
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(1.2);
    doc.roundedRect(x, y, w, h, 12, 12, 'S');
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
      headerText, headerColor, bodyColor, strokeColor, bodyRaw,
      headerSize = 16, bodySize = 11, headerSpacing = 12, lineHeight = 11,
      hasRegular, hasBold,
    } = params;

    const pad = 10;
    setFontRegular(doc, hasRegular);
    doc.setFontSize(bodySize);
    const bodyLines = doc.splitTextToSize(bodyRaw, innerWidth);
    const contentH = headerSize + headerSpacing + (bodyLines.length * lineHeight);
    const cardH = pad * 2 + contentH;
    const cardX = left - pad;
    const cardY = top;
    const cardW = innerWidth + pad * 2;

    drawRoundedCard(doc, cardX, cardY, cardW, cardH, strokeColor);

    // Заголовок
    doc.setFontSize(headerSize);
    doc.setTextColor(headerColor);
    setFontBold(doc, hasBold, hasRegular);
    doc.text(headerText, left, cardY + pad + headerSize);

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
    const pageW = doc.internal.pageSize.getWidth();  // 842
    const pageH = doc.internal.pageSize.getHeight();  // 595

    // Логотип в правом нижнем углу
    if (logo) {
      try {
        const targetW = 60;
        const ratio = logo.heightPx && logo.widthPx ? (logo.heightPx / logo.widthPx) : 0.3;
        const targetH = targetW * ratio;
        doc.addImage(logo.dataUrl, 'PNG', pageW - targetW - 10, pageH - targetH - 10, targetW, targetH, undefined, 'FAST');
      } catch (_) { /* ignore */ }
    }

    const left = 48;
    let top = 44;
    const innerWidth = pageW - left * 2;

    // Главный заголовок
    doc.setFontSize(24);
    doc.setTextColor('#2b2b2b');
    setFontBold(doc, hasBold, hasRegular);
    doc.text('Отчёт по онлайн-проверкам', pageW / 2, top, { align: 'center' });
    top += 28;

    // Название пиццерии
    doc.setFontSize(20);
    doc.setTextColor('#4f2150');
    setFontBold(doc, hasBold, hasRegular);
    doc.text(result.name, pageW / 2, top, { align: 'center' });
    top += 22;

    // Период
    if (meta && meta.period) {
      setFontRegular(doc, hasRegular);
      doc.setFontSize(14);
      doc.setTextColor('#4f2150');
      doc.text(String(meta.period), pageW / 2, top, { align: 'center' });
      top += 20;
    }

    top += 6;

    // Карточка С10
    const c10Header = `ТОП-${topN} С10:`;
    const c10BodyRaw = buildTopText(c10Header, result.c10Groups, topN).split('\n').slice(1).join('\n');
    const c10Bottom = renderTopCard(doc, {
      left, top, innerWidth,
      headerText: c10Header,
      headerColor: '#FF4F4F', bodyColor: '#920000', strokeColor: '#FF4F4F',
      bodyRaw: c10BodyRaw,
      headerSize: 15, bodySize: 10, headerSpacing: 10, lineHeight: 10,
      hasRegular, hasBold,
    });
    top = c10Bottom + 10;

    // Карточка С5
    const c5Header = `ТОП-${topN} С5:`;
    const c5BodyRaw = buildTopText(c5Header, result.c5Groups, topN).split('\n').slice(1).join('\n');
    const c5Bottom = renderTopCard(doc, {
      left, top, innerWidth,
      headerText: c5Header,
      headerColor: '#FF9933', bodyColor: '#a44400', strokeColor: '#FF9933',
      bodyRaw: c5BodyRaw,
      headerSize: 15, bodySize: 10, headerSpacing: 10, lineHeight: 10,
      hasRegular, hasBold,
    });
    top = c5Bottom + 10;

    // Карточка С3 (если есть нарушения)
    const c3Items = (result.c3Groups.summary || []);
    if (c3Items.length > 0) {
      const c3Header = 'С3:';
      const c3BodyRaw = buildTopText(c3Header, result.c3Groups, topN).split('\n').slice(1).join('\n');
      renderTopCard(doc, {
        left, top, innerWidth,
        headerText: c3Header,
        headerColor: '#66BB6A', bodyColor: '#2e7d32', strokeColor: '#66BB6A',
        bodyRaw: c3BodyRaw,
        headerSize: 15, bodySize: 10, headerSpacing: 10, lineHeight: 10,
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
