(function () {
  // Пространство имён для генерации PDF
  const Pdf = {};

  // Кеш шрифтов и логотипа
  let fontRegB64 = null;
  let fontBoldB64 = null;
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

  async function ensureMontserrat(doc) {
    if (fontRegB64) {
      try {
        doc.addFileToVFS('Montserrat-Regular.ttf', fontRegB64);
        doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
        return true;
      } catch (_) { /* ignore */ }
    }
    try {
      const res = await fetch('fonts/Montserrat-Regular.ttf');
      if (!res.ok) throw new Error('font fetch failed');
      const buf = await res.arrayBuffer();
      fontRegB64 = arrayBufferToBase64(buf);
      doc.addFileToVFS('Montserrat-Regular.ttf', fontRegB64);
      doc.addFont('Montserrat-Regular.ttf', 'Montserrat', 'normal');
      return true;
    } catch (e) {
      console.log('[PDF] Regular font error', e);
      return false;
    }
  }

  async function ensureMontserratBold(doc) {
    if (fontBoldB64) {
      try {
        doc.addFileToVFS('Montserrat-Bold.ttf', fontBoldB64);
        doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
        return true;
      } catch (_) { /* ignore */ }
    }
    try {
      const res = await fetch('fonts/Montserrat-Bold.ttf');
      if (!res.ok) throw new Error('font bold fetch failed');
      const buf = await res.arrayBuffer();
      fontBoldB64 = arrayBufferToBase64(buf);
      doc.addFileToVFS('Montserrat-Bold.ttf', fontBoldB64);
      doc.addFont('Montserrat-Bold.ttf', 'Montserrat', 'bold');
      return true;
    } catch (e) {
      console.log('[PDF] Bold font error', e);
      return false;
    }
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

  Pdf.generateTopReport = async function generateTopReport(topN, c5Groups, c10Groups, mode, meta) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      alert('jsPDF не загружен');
      return;
    }

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const hasRegular = await ensureMontserrat(doc);
    const hasBold = await ensureMontserratBold(doc);

    // Логотип в правом нижнем углу
    let contentTopOffset = 0;
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
    let top = Math.max(72, contentTopOffset);
    const lineGap = 18;

    // Центрированный титул и метаданные
    const pageW = doc.internal.pageSize.getWidth();
    // Главный заголовок
    doc.setFontSize(34);
    doc.setTextColor('#2b2b2b'); // чёрный графит
    if (await ensureMontserratBold(doc)) doc.setFont('Montserrat', 'bold'); else doc.setFont('helvetica', 'bold');
    doc.text('Отчёт по онлайн-проверкам', pageW / 2, top, { align: 'center' });
    top += 34;

    // Метаданные по центру: пиццерия и период
    if (meta && meta.store) {
      doc.setFontSize(30);
      doc.setTextColor('#4f2150');
      if (await ensureMontserratBold(doc)) doc.setFont('Montserrat', 'bold'); else doc.setFont('helvetica', 'bold');
      doc.text(String(meta.store), pageW / 2, top, { align: 'center' });
      top += 28;
    }
    if (meta && meta.period) {
      if (await ensureMontserrat(doc)) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
      doc.setFontSize(18);
      doc.setTextColor('#4f2150');
      doc.text(String(meta.period), pageW / 2, top, { align: 'center' });
      top += 26;
    }
    top += 8; // небольшой отступ перед ТОП-блоками

    // Название пиццерии (если задано) уже выше, теперь заголовок C5
    // C5 карточка "liquid glass"
    const innerWidth = 483;
    const cardPad = 12;
    const headerSize = 18;
    const bodySize = 12;
    const headerSpacing = 14; // дополнительный отступ после ТОП-… заголовков
    if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    const c5BodyRaw = c5Text.split('\n').slice(1).join('\n');
    const c5Lines = doc.splitTextToSize(c5BodyRaw, innerWidth);
    const lineHeight = 12; // увеличенная высота строки для С5
    const c5ContentH = headerSize + headerSpacing + (c5Lines.length * lineHeight);
    const c5CardH = cardPad * 2 + c5ContentH;
    const c5CardX = left - cardPad;
    const c5CardY = top;
    const c5CardW = innerWidth + cardPad * 2;
    // Рамка цвета категории (S5 header color)
    drawRoundedCard(doc, c5CardX, c5CardY, c5CardW, c5CardH, '#FF9933');

    // Header inside card
    doc.setFontSize(headerSize);
    doc.setTextColor('#FF9933');
    if (hasBold) doc.setFont('Montserrat', 'bold'); else if (!hasRegular) doc.setFont('helvetica', 'bold');
    doc.text(c5Header, left, c5CardY + cardPad + headerSize);

    // Body inside card
    if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    doc.setTextColor('#a44400');
    // Рисуем строки по одной, делая жирными количество и слово "раз"
    {
      let y = c5CardY + cardPad + headerSize + headerSpacing;
      for (const line of c5Lines) {
        const m = line.match(/^(.*?)(\s*:\s*)(\d+)\s+(раз|раза)\s*$/u);
        if (m) {
          const prefix = m[1] + m[2];
          const countStr = m[3] + ' ' + m[4];
          // prefix (regular)
          if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
          doc.text(prefix, left, y);
          // place bold tail after prefix
          const prefixW = doc.getTextWidth(prefix);
          if (hasBold) doc.setFont('Montserrat', 'bold'); else doc.setFont('helvetica', 'bold');
          doc.text(countStr, left + prefixW, y);
          // back to regular for next line
          if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
        } else {
          doc.text(line, left, y);
        }
        y += lineHeight;
      }
    }

    top = c5CardY + c5CardH + 18; // отступ под карточкой

    // C10 заголовок (жирный)
    // C10 карточка
    if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    const c10BodyRaw = c10Text.split('\n').slice(1).join('\n');
    const c10Lines = doc.splitTextToSize(c10BodyRaw, innerWidth);
    const c10LineHeight = 12; // увеличенная высота строки для С10
    const c10ContentH = headerSize + headerSpacing + (c10Lines.length * c10LineHeight);
    const c10CardH = cardPad * 2 + c10ContentH;
    const c10CardX = left - cardPad;
    const c10CardY = top;
    const c10CardW = innerWidth + cardPad * 2;
    drawRoundedCard(doc, c10CardX, c10CardY, c10CardW, c10CardH, '#FF4F4F');

    doc.setFontSize(headerSize);
    doc.setTextColor('#FF4F4F');
    if (hasBold) doc.setFont('Montserrat', 'bold'); else if (!hasRegular) doc.setFont('helvetica', 'bold');
    doc.text(c10Header, left, c10CardY + cardPad + headerSize);

    if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
    doc.setFontSize(bodySize);
    doc.setTextColor('#920000');
    {
      let y2 = c10CardY + cardPad + headerSize + headerSpacing;
      for (const line of c10Lines) {
        const m = line.match(/^(.*?)(\s*:\s*)(\d+)\s+(раз|раза)\s*$/u);
        if (m) {
          const prefix = m[1] + m[2];
          const countStr = m[3] + ' ' + m[4];
          if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
          doc.text(prefix, left, y2);
          const prefixW = doc.getTextWidth(prefix);
          if (hasBold) doc.setFont('Montserrat', 'bold'); else doc.setFont('helvetica', 'bold');
          doc.text(countStr, left + prefixW, y2);
          if (hasRegular) doc.setFont('Montserrat', 'normal'); else doc.setFont('helvetica', 'normal');
        } else {
          doc.text(line, left, y2);
        }
        y2 += c10LineHeight;
      }
    }

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

  window.Pdf = Pdf;
})();


