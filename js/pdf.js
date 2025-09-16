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
    // eslint-disable-next-line no-undef
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
        } catch (_) { /* ignore and refetch */ }
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
        lines.push(''); // отступ между пунктами
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
      left,
      top,
      innerWidth,
      headerText,
      headerColor,
      bodyColor,
      strokeColor,
      bodyRaw,
      headerSize = 18,
      bodySize = 12,
      headerSpacing = 14,
      lineHeight = 12,
      hasRegular,
      hasBold,
    } = params;

    const pad = 12;
    setFontRegular(doc, hasRegular);
    doc.setFontSize(bodySize);
    const bodyLines = doc.splitTextToSize(bodyRaw, innerWidth);
    const contentH = headerSize + headerSpacing + (bodyLines.length * lineHeight);
    const cardH = pad * 2 + contentH;
    const cardX = left - pad;
    const cardY = top;
    const cardW = innerWidth + pad * 2;

    drawRoundedCard(doc, cardX, cardY, cardW, cardH, strokeColor);

    // Header
    doc.setFontSize(headerSize);
    doc.setTextColor(headerColor);
    setFontBold(doc, hasBold, hasRegular);
    doc.text(headerText, left, cardY + pad + headerSize);

    // Body
    setFontRegular(doc, hasRegular);
    doc.setFontSize(bodySize);
    doc.setTextColor(bodyColor);
    const firstLineY = cardY + pad + headerSize + headerSpacing;
    drawLinesWithBoldCounts(doc, bodyLines, left, firstLineY, lineHeight, hasRegular, hasBold);

    return cardY + cardH;
  }

  Pdf.generateTopReport = async function generateTopReport(topN, c5Groups, c10Groups, mode, meta) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      alert('jsPDF не загружен');
      return;
    }

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const { hasRegular, hasBold } = await ensureFonts(doc);

    // Логотип в правом нижнем углу
    try {
      const logo = await loadLogo();
      if (logo) {
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const targetW = 66; // уменьшили ~в 2 раза
        const ratio = logo.heightPx && logo.widthPx ? (logo.heightPx / logo.widthPx) : 0.3;
        const targetH = targetW * ratio;
        const x = pageW - targetW; // без правого поля
        const y = pageH - targetH; // правый нижний угол
        doc.addImage(logo.dataUrl, 'PNG', x, y, targetW, targetH, undefined, 'FAST');
      }
    } catch (_) { /* ignore */ }

    // Заголовки и тело
    const c5Header = `ТОП-${topN} С5:`;
    const c10Header = `ТОП-${topN} С10:`;
    const c5Text = buildTopText(c5Header, c5Groups, topN);
    const c10Text = buildTopText(c10Header, c10Groups, topN);

    const left = 56;
    let top = 72;
    const lineGap = 18;

    // Центрированный титул и метаданные
    const pageW = doc.internal.pageSize.getWidth();
    // Главный заголовок
    doc.setFontSize(34);
    doc.setTextColor('#2b2b2b'); // чёрный графит
    setFontBold(doc, hasBold, hasRegular);
    doc.text('Отчёт по онлайн-проверкам', pageW / 2, top, { align: 'center' });
    top += 34;

    // Метаданные по центру: пиццерия и период
    if (meta && meta.store) {
      doc.setFontSize(30);
      doc.setTextColor('#4f2150');
      setFontBold(doc, hasBold, hasRegular);
      doc.text(String(meta.store), pageW / 2, top, { align: 'center' });
      top += 28;
    }
    if (meta && meta.period) {
      setFontRegular(doc, hasRegular);
      doc.setFontSize(18);
      doc.setTextColor('#4f2150');
      doc.text(String(meta.period), pageW / 2, top, { align: 'center' });
      top += 26;
    }
    top += 8; // небольшой отступ перед ТОП-блоками

    // Общие параметры карточек
    const innerWidth = 483;
    const headerSize = 18;
    const bodySize = 12;
    const headerSpacing = 14;

    // C5
    const c5BodyRaw = c5Text.split('\n').slice(1).join('\n');
    const c5Bottom = renderTopCard(doc, {
      left,
      top,
      innerWidth,
      headerText: c5Header,
      headerColor: '#FF9933',
      bodyColor: '#a44400',
      strokeColor: '#FF9933',
      bodyRaw: c5BodyRaw,
      headerSize,
      bodySize,
      headerSpacing,
      lineHeight: 12,
      hasRegular,
      hasBold,
    });

    top = c5Bottom + 18; // отступ под карточкой

    // C10
    const c10BodyRaw = c10Text.split('\n').slice(1).join('\n');
    renderTopCard(doc, {
      left,
      top,
      innerWidth,
      headerText: c10Header,
      headerColor: '#FF4F4F',
      bodyColor: '#920000',
      strokeColor: '#FF4F4F',
      bodyRaw: c10BodyRaw,
      headerSize,
      bodySize,
      headerSpacing,
      lineHeight: 12,
      hasRegular,
      hasBold,
    });

    if (mode === 'preview') {
      doc.output('dataurlnewwindow');
    } else {
      const name = buildReportFileName(meta);
      doc.save(name);
    }
  };

  function buildReportFileName(meta) {
    const store = meta && meta.store ? String(meta.store).trim() : '';
    const period = meta && meta.period ? String(meta.period).trim() : '';
    const parts = [];
    if (store) parts.push(store);
    if (period) parts.push(period);
    parts.push('Отчёт');
    const raw = parts.join('_');
    // Допустим кириллицу/латиницу/цифры/пробел/подчёркивание/тире/точку/скобки
    const safe = raw.replace(/[^\p{L}\p{N}\s_\-().]+/gu, '').replace(/\s+/g, ' ').trim();
    return (safe || 'Отчёт') + '.pdf';
  }

  // Экспорт некоторых утилит для повторного использования в app.js
  Pdf.buildTopText = buildTopText;

  window.Pdf = Pdf;
})();


