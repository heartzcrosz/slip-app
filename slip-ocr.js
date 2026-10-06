// อ่านสลีปแบบฟรีในเครื่อง: Tesseract OCR (ไทย+อังกฤษ) แล้วแยกวันที่ เวลา จำนวนเงิน ผู้รับ และชื่อโครงการ (ถ้ามี) จากข้อความ
// ไม่ต้องใช้ API key แต่แม่นน้อยกว่าการให้ Claude อ่าน โดยเฉพาะชื่อภาษาไทย

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

const TH_MONTHS = [
  ['ม.ค.', 'มกราคม'], ['ก.พ.', 'กุมภาพันธ์'], ['มี.ค.', 'มีนาคม'], ['เม.ย.', 'เมษายน'],
  ['พ.ค.', 'พฤษภาคม'], ['มิ.ย.', 'มิถุนายน'], ['ก.ค.', 'กรกฎาคม'], ['ส.ค.', 'สิงหาคม'],
  ['ก.ย.', 'กันยายน'], ['ต.ค.', 'ตุลาคม'], ['พ.ย.', 'พฤศจิกายน'], ['ธ.ค.', 'ธันวาคม'],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// OCR มักอ่านจุดในตัวย่อเดือนหาย หรือมีช่องว่างแทรก เช่น "ต.ค" "ต ค."
const thMonthRe = TH_MONTHS.map(([ab, full]) => full + '|' + ab.split('.').filter(Boolean).map(esc).join('\\s*\\.?\\s*') + '\\.?').join('|');
const TITLES = /^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|MRS?\.?|MS\.?|MISS|บริษัท|บจก\.?|หจก\.?|ร้าน|Co\.|Company)/i;
const MONEY = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?/;

const pad = n => String(n).padStart(2, '0');
const normalize = t => String(t || '').normalize('NFC')
  .replace(/๓(?=ต)/g, '')                                         // "๓ต.ค." → "ต.ค."
  .replace(/๓(?=\s*\.?\s*ค\s*\.)/g, 'ต')                        // "๓.ค." → "ต.ค."
  .replace(/(\d|\b)\s*[0O]ct\b/g, '$1 Oct')                        // "50ct" → "5 Oct"
  .replace(/ํา/g, 'ำ')                                  // ํา → ำ
  .replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0E50));      // เลขไทย → อารบิก

function year(y, buddhist) {
  y = +y;
  if (y < 100) y += buddhist ? 2500 : 2000;
  if (y > 2400) y -= 543;
  return y;
}

function findDate(text) {
  // ปีอาจติดกับเวลา เช่น "ต.ค.6914:29" จึงรับ 4 หลักเฉพาะที่ขึ้นต้นด้วย 25 หรือ 20
  let m = text.match(new RegExp('(\\d{1,2})\\s*(' + thMonthRe + ')\\s*(25\\d{2}|20\\d{2}|\\d{2})'));
  if (m) {
    const word = m[2].replace(/[\s.]/g, '');
    const mi = TH_MONTHS.findIndex(([ab, full]) => full === word || ab.replace(/\./g, '') === word);
    if (mi >= 0) return { date: `${year(m[3], true)}-${pad(mi + 1)}-${pad(m[1])}`, at: m.index + m[0].length };
  }
  m = text.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(20\d{2}|\d{2})/i);
  if (m) {
    const y = year(m[3], false);
    return { date: `${y}-${pad(EN_MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`, at: m.index + m[0].length };
  }
  m = text.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12) {
    // ปี 2 หลักแบบตัวเลขล้วน: 60-99 น่าจะเป็น พ.ศ.
    const y = m[3].length === 2 && +m[3] >= 60 ? year(m[3], true) : year(m[3], false);
    return { date: `${y}-${pad(m[2])}-${pad(m[1])}`, at: m.index + m[0].length };
  }
  // อ่านชื่อเดือนไม่ออก (เช่น "4 A.A. 2569") แต่มีวันและปี: เดาว่าเป็นวันนั้นที่ใกล้วันนี้ที่สุดในอดีต
  m = text.match(/(?<!\d)(\d{1,2})\s*\S{1,8}\s*(25\d{2}|20\d{2})(?!\d)/);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    const now = new Date(), y = year(m[2], true);
    let mo = now.getMonth() + 1;
    if (+m[1] > now.getDate()) mo -= 1;
    const yy = mo < 1 ? y - 1 : y;
    if (mo < 1) mo = 12;
    return { date: `${yy}-${pad(mo)}-${pad(m[1])}`, at: m.index + m[0].length, guessed: true };
  }
  return null;
}

function findTime(text, from) {
  const re = /(?<![\d:.])([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?::[0-5]\d)?(?![\d.,])\s*(PM|AM)?/gi;
  // OCR อาจอ่านโคลอนหาย เช่น "729PM" หรือ "2019 น." ใช้ได้เมื่อมี AM/PM หรือ น. ตามหลัง
  const loose = /(?<![\d:.])([01]?\d|2[0-3])([0-5]\d)\s*(PM|AM|น\.?)/gi;
  for (const r of [re, loose]) {
    const all = [...text.matchAll(r)];
    const hit = all.find(m => m.index >= from) || all[0];
    if (!hit) continue;
    let h = +hit[1];
    if (hit[3] && /pm/i.test(hit[3]) && h < 12) h += 12;
    if (hit[3] && /am/i.test(hit[3]) && h === 12) h = 0;
    return `${pad(h)}:${hit[2]}`;
  }
  return '';
}

// สลีปภาษาอังกฤษที่ลงท้ายด้วย "Baht" (เช่น K+) พิมพ์ทศนิยม 2 ตำแหน่งเสมอ แต่จุดเล็ก OCR อ่านหายง่าย
// ("87.00 Baht" → "8700") ถ้าไม่มีจุดและมีอย่างน้อย 3 หลัก ให้ใส่จุดกลับก่อน 2 หลักสุดท้าย
const moneyIn = s => {
  const m = s.match(new RegExp(MONEY.source + '\\s*(บาท|baht|THB|฿)?', 'i'));
  if (!m || (!m[2] && !m[3])) return '';
  const n = m[1].replace(/,/g, '');
  if (!m[2] && /baht/i.test(m[3] || '') && n.length >= 3) return n.slice(0, -2) + '.' + n.slice(-2);
  return n + (m[2] || '');
};

function findAmount(lines) {
  // เป๋าตัง: ใช้ "ค่าสินค้า/บริการ" (ยอดก่อนหักสิทธิโครงการ) ซึ่งอยู่ก่อน "จำนวนเงินที่ชำระ"
  const label = /(ค่าสินค้า|จำนวนเงิน|จำนวน|ยอดเงิน|ยอดชำระ|ยอดโอน|amount|total)/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length);
    for (const s of [rest, lines[i + 1] || '', lines[i + 2] || '']) {
      const a = moneyIn(s);
      if (a && parseFloat(a) > 0) return a;
    }
  }
  // ไม่มีป้าย: ใช้ตัวเลขแรกที่ตามด้วย บาท/THB ที่ไม่ใช่ค่าธรรมเนียม
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[i - 1] || '';
    if (/ค่าธรรมเนียม|fee/i.test(lines[i]) || (/ค่าธรรมเนียม|fee/i.test(prev) && !MONEY.test(prev))) continue;
    const m = lines[i].match(new RegExp(MONEY.source + '\\s*(บาท|baht|THB|฿)', 'i'));
    if (m && parseFloat(m[1].replace(/,/g, '')) > 0) return m[1].replace(/,/g, '') + (m[2] || '');
  }
  return '';
}

// บรรทัดที่ไม่ใช่ชื่อ: เลขบัญชี เลขอ้างอิง ชื่อธนาคาร
const isNoise = s => /[xX*%]{3}|\d{6,}|^[\d\s,.:\-/%]+$/.test(s)
  || /^(ธ\.|ธนาคาร|bank|พร้อมเพย์|promptpay|เลขที่|รหัส|อ้างอิง|ref|g-wallet)/i.test(s);
const clean = s => s.replace(/^[\s:：\-–>|]+/, '').replace(/\s{2,}/g, ' ').trim();
const MASKED = /[xX*%]{3}|\*{2,}/;
const BANK = /^(kbank|ktb|scb|bbl|bay|ttb|gsb|baac|uob|cimb|kkp|lhb|krungthai|krungsri|bangkok bank|ธ\.|ธนาคาร)\b/i;
const CATEGORY = /อาหาร|เครื่องดื่ม|เครื่องคื่ม|ของหวาน|ของใช้|บริการ|ค่าสินค้า|จำนวน|amount|transaction|รหัส/i;
const SUFFIX = /^(company|limited|co\.?|ltd\.?|corporation|จำกัด)/i;
const isThai = s => /[\u0E00-\u0E7F]/.test(s);

// เก็บเฉพาะส่วนที่เป็นชื่อในบรรทัด ตัดเศษที่ OCR อ่านจากรูปพื้นหลังทิ้ง
function nameIn(line) {
  const toks = line.split(/\s+/).filter(Boolean);
  const caps = t => /^(MRS?|MS|MISS|DR)\.?$|^[A-Z][A-Z.,'&()\-]{1,}[A-Z.)]?$|^[A-Z]{2,}[.,]?$/.test(t);
  // ชื่อตัวพิมพ์เล็ก/ผสม เช่น kanda, TrueMoney (ต้องยาวอย่างน้อย 5 ตัว กันเศษ เช่น Teme จากรูปพื้นหลัง)
  const word = t => /^[A-Za-z][a-z]{4,}$/.test(t) || /^[A-Z][a-z]+[A-Z][A-Za-z]+$/.test(t);
  const thai = t => /^[\u0E00-\u0E7F.()]+$/.test(t) && /[\u0E01-\u0E2E]/.test(t);
  const kindOf = t => (caps(t) && t.replace(/\W/g, '').length >= 2) ? caps : word(t) ? word : (thai(t) && t.length >= 2) ? thai : null;
  // ลองทุกจุดเริ่มต้นในบรรทัด (เศษอักษรหน้าชื่อ เช่น "FY บอสส์" จะไม่บังชื่อจริง) แล้วเก็บต่อจนเจอคำที่ไม่ใช่ชื่อ
  for (let i = 0; i < toks.length; i++) {
    const kind = kindOf(toks[i]);
    if (!kind) continue;
    const out = [];
    for (let k = i; k < toks.length && kind(toks[k]); k++) out.push(toks[k]);
    const name = out.join(' ');
    // ชื่อภาษาอังกฤษตัวพิมพ์ใหญ่ต้องมีคำยาวอย่างน้อย 4 ตัวอักษร กันเศษตัวอักษรจากรูปพื้นหลัง
    if (kind === caps) { if (out.some(t => t.replace(/[^A-Za-z]/g, '').length >= 4)) return name; }
    else if (kind === word) return name;
    else if (name.replace(/[^\u0E00-\u0E7F]/g, '').length >= 3) return name;
  }
  return '';
}

function findPayee(lines) {
  const label = /^(ไปยัง|ถึง|ผู้รับเงิน|ผู้รับ|ร้านค้า|ชื่อร้าน|ชื่อร้านค้า|to|recipient|merchant|payee|pay to)(?=$|[\s:：])\s*[:：]?/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const rest = clean(lines[i].slice(m[0].length));
    if (rest.length > 1 && !isNoise(rest)) return rest;
    for (const s of lines.slice(i + 1, i + 3)) if (s.length > 1 && !isNoise(s)) return clean(s);
  }
  // K+ และเป๋าตัง: ผู้โอนอยู่ก่อน ตามด้วยเลขบัญชีที่ซ่อนไว้ (xxx-x-x1234-x หรือ ****) แล้วจึงเป็นชื่อผู้รับ
  // ชื่อยาวอาจขึ้นบรรทัดใหม่ จึงต่อบรรทัดจนเจอชื่อธนาคาร เลขบัญชี หรือประเภทร้าน
  const first = lines.findIndex(s => MASKED.test(s));
  if (first >= 0) {
    const parts = [];
    for (const s of lines.slice(first + 1)) {
      if (MASKED.test(s) && !parts.length) continue;
      // เจอเลขบัญชี/เลขอ้างอิงของผู้รับ ประเภทร้าน หรือชื่อธนาคาร แปลว่าหมดส่วนชื่อแล้ว
      if (isNoise(s) || CATEGORY.test(s) || (parts.length && BANK.test(s))) break;
      const n = nameIn(s);
      if (!n) continue;   // บรรทัดเศษจากรูปพื้นหลังข้ามไป
      // บรรทัดต่อของชื่อ: ต่อเมื่อขึ้นต้นด้วย COMPANY/LIMITED/จำกัด หรือบรรทัดก่อนหน้าสั้นและบรรทัดนี้มีคำยาว (ชื่อที่ขึ้นบรรทัดใหม่)
      // ไม่งั้นเป็นบรรทัดที่สอง (เช่น ชื่อบริษัทของร้าน) หรือเศษจากรูปพื้นหลัง ข้ามไป
      if (parts.length && !(SUFFIX.test(n) || (parts[parts.length - 1].split(/\s+/).length <= 2 && n.split(/\s+/).some(t => t.replace(/[^A-Za-z\u0E01-\u0E2E]/g, '').length >= 6)))) continue;
      parts.push(n);
      if (parts.length >= 2) break;
    }
    if (parts.length) return parts.reduce((a, b) => a + (isThai(a.slice(-1)) && isThai(b[0]) ? '' : ' ') + b);
  }
  // ไม่มีป้าย: บรรทัดที่ขึ้นต้นด้วยคำนำหน้าชื่อ ตัวแรกมักเป็นผู้โอน ตัวที่สองเป็นผู้รับ
  const names = lines.filter(s => TITLES.test(s) && !isNoise(s));
  return names.length ? clean(names[names.length > 1 ? 1 : 0]) : '';
}

// ไม่อ่านบันทึกช่วยจำที่ผู้โอนพิมพ์เอง (OCR อ่านผิดบ่อย) ใส่เฉพาะชื่อโครงการ เช่น ไทยช่วยไทย
function findProgram(text) {
  const p = text.match(/โครงการ\s*([^\s\n]+)/);
  if (p) return p[1];
  // OCR มักอ่านโลโก้/ข้อความ "ไทยช่วยไทย" เพี้ยนเป็น "เทยช่วยไทย"
  if (/ช่วยไทย/.test(text)) return 'ไทยช่วยไทย';
  if (/คนละครึ่ง/.test(text)) return 'คนละครึ่ง';
  return '';
}

// แยกข้อมูลจากข้อความ OCR ของสลีป 1 ใบ
export function parseSlipText(raw) {
  const text = normalize(raw);
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const d = findDate(text);
  return {
    date: d ? d.date : '',
    guessed: !!(d && d.guessed),
    // เว้นวรรคหลังวันที่ เผื่อเวลาติดกับปี
    time: d ? findTime(text.slice(0, d.at) + ' ' + text.slice(d.at), d.at) : findTime(text, 0),
    amount: findAmount(lines),
    payee: findPayee(lines),
    note: findProgram(text),
  };
}

const workers = {};
function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('โหลดตัวอ่าน OCR ไม่ได้ ตรวจสอบอินเทอร์เน็ต'));
    document.head.appendChild(s);
  });
}
// ครั้งแรกต้องโหลดตัวอ่านและข้อมูลภาษา (~5 MB) หลังจากนั้นเบราว์เซอร์เก็บไว้ใช้ซ้ำ
// มี 2 ตัว: ไทย+อังกฤษ และอังกฤษล้วน (อ่านวันที่/ชื่อภาษาอังกฤษบนพื้นหลังลวดลายได้ดีกว่า)
function getWorker(langs, onStatus) {
  const key = langs.join('+');
  if (!workers[key]) {
    workers[key] = (async () => {
      if (!window.Tesseract) await loadScript(TESS_URL);
      const w = await window.Tesseract.createWorker(langs, 1, {
        logger: m => { if (onStatus && m.status && /load|init/i.test(m.status)) onStatus('กำลังเตรียมตัวอ่าน OCR (ครั้งแรกจะช้าหน่อย) …'); },
      });
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })();
    workers[key].catch(() => { delete workers[key]; });
  }
  return workers[key];
}

// ปรับรูปให้กว้าง width px (ขยายช่วยให้อ่านสระและวรรณยุกต์ไทยได้ดีขึ้น) ถ้า filter เป็นจริง เก็บเฉพาะพิกเซลสีเทาเข้มแบบตัวหนังสือ
// (ไม่มีสี และไม่ดำสนิท) เป็นสีดำ ที่เหลือเป็นสีขาว เพื่อตัดรูปพื้นหลังและตัวละครที่ทับชื่อออก
function toCanvas(img, filter, width) {
  const k = width / img.width;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  if (filter) {
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = l >= 55 && l < 125 && ch < 35 ? 0 : 255;
    }
    g.putImageData(id, 0, 0);
  }
  return c;
}

const complete = d => d.date && d.time && parseFloat(d.amount) > 0 && d.payee;
const capsName = s => /^[A-Z0-9 .,'&()\-]+$/.test(s) && s.split(' ').some(t => t.replace(/[^A-Z]/g, '').length >= 4);

export async function ocrSlip(file, onStatus) {
  const img = await createImageBitmap(file);
  const th = await getWorker(['tha', 'eng'], onStatus);
  const ta = (await th.recognize(toCanvas(img, false, 1700))).data.text;
  let a = parseSlipText(ta);
  // วันที่ภาษาไทยตัวเล็ก อ่านพลาดง่าย ลองอ่านซ้ำที่ขนาดอื่นก่อนจะเดาเดือน
  if (!a.date || a.guessed) {
    const a2 = parseSlipText((await th.recognize(toCanvas(img, false, 1500))).data.text);
    if (a2.date && !a2.guessed) a = { ...a, date: a2.date, guessed: false, time: a.time || a2.time };
  }
  // สลีปพื้นเรียบ (เช่น เป๋าตัง) อ่านครั้งเดียวพอ
  if (complete(a) && !/verify slip|completed/i.test(ta)) return a;

  // พื้นหลังลวดลาย (เช่น K+): กรองภาพแล้วอ่านซ้ำแบบไทย+อังกฤษ และอังกฤษล้วน แล้วเลือกค่าที่น่าเชื่อที่สุดในแต่ละช่อง
  onStatus && onStatus('กำลังอ่านซ้ำแบบละเอียด …');
  const f = toCanvas(img, true, Math.min(img.width, 1600));
  const b = parseSlipText((await th.recognize(f)).data.text);
  const c = parseSlipText((await (await getWorker(['eng'], onStatus)).recognize(f)).data.text);
  const dt = [c, a, b].find(x => x.date && x.time && !x.guessed) || [c, a, b].find(x => x.date && x.time) || {};
  let amount = a.amount || b.amount || c.amount;
  // จุดทศนิยมเล็ก อ่านหายได้ง่าย ถ้ารอบอื่นอ่านได้ตัวเลขเดียวกันพร้อมจุด ใช้ค่านั้น
  if (!amount.includes('.')) amount = [a, b, c].map(x => x.amount).find(v => v.includes('.') && v.replace('.', '') === amount) || amount;
  const payee = capsName(c.payee) ? c.payee : isThai(b.payee) ? b.payee : isThai(a.payee) ? a.payee : c.payee || b.payee || a.payee;
  return {
    date: dt.date || a.date || b.date || c.date,
    guessed: dt.date ? !!dt.guessed : !!(a.guessed || b.guessed || c.guessed),
    time: dt.time || a.time || b.time || c.time,
    amount, payee,
    note: a.note || b.note,
  };
}
