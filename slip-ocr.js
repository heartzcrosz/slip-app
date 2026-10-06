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
  return null;
}

function findTime(text, from) {
  const re = /(?<![\d:.])([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?::[0-5]\d)?(?![\d.,])\s*(PM|AM)?/gi;
  const all = [...text.matchAll(re)];
  const hit = all.find(m => m.index >= from) || all[0];
  if (!hit) return '';
  let h = +hit[1];
  if (hit[3] && /pm/i.test(hit[3]) && h < 12) h += 12;
  if (hit[3] && /am/i.test(hit[3]) && h === 12) h = 0;
  return `${pad(h)}:${hit[2]}`;
}

const moneyIn = s => {
  const m = s.match(new RegExp(MONEY.source + '\\s*(บาท|THB|฿)?', 'i'));
  if (!m || (!m[2] && !m[3])) return '';
  return m[1].replace(/,/g, '') + (m[2] || '');
};

function findAmount(lines) {
  const label = /(จำนวนเงิน|จำนวน|ยอดเงิน|ยอดชำระ|ยอดโอน|amount|total)/i;
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
    const m = lines[i].match(new RegExp(MONEY.source + '\\s*(บาท|THB|฿)', 'i'));
    if (m && parseFloat(m[1].replace(/,/g, '')) > 0) return m[1].replace(/,/g, '') + (m[2] || '');
  }
  return '';
}

// บรรทัดที่ไม่ใช่ชื่อ: เลขบัญชี เลขอ้างอิง ชื่อธนาคาร
const isNoise = s => /[xX*]{3}|\d{6,}|^[\d\s,.:\-/%]+$/.test(s)
  || /^(ธ\.|ธนาคาร|bank|พร้อมเพย์|promptpay|เลขที่|รหัส|อ้างอิง|ref)/i.test(s);
const clean = s => s.replace(/^[\s:：\-–>|]+/, '').replace(/\s{2,}/g, ' ').trim();

function findPayee(lines) {
  const label = /^(ไปยัง|ถึง|ผู้รับเงิน|ผู้รับ|ร้านค้า|ชื่อร้าน|ชื่อร้านค้า|to|recipient|merchant|payee|pay to)(?=$|[\s:：])\s*[:：]?/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const rest = clean(lines[i].slice(m[0].length));
    if (rest.length > 1 && !isNoise(rest)) return rest;
    for (const s of lines.slice(i + 1, i + 3)) if (s.length > 1 && !isNoise(s)) return clean(s);
  }
  // ไม่มีป้าย: บรรทัดที่ขึ้นต้นด้วยคำนำหน้าชื่อ ตัวแรกมักเป็นผู้โอน ตัวที่สองเป็นผู้รับ
  const names = lines.filter(s => TITLES.test(s) && !isNoise(s));
  return names.length ? clean(names[names.length > 1 ? 1 : 0]) : '';
}

// ไม่อ่านบันทึกช่วยจำที่ผู้โอนพิมพ์เอง (OCR อ่านผิดบ่อย) ใส่เฉพาะชื่อโครงการ เช่น ไทยช่วยไทย
function findProgram(text) {
  const p = text.match(/โครงการ\s*([^\s\n]+)/);
  if (p) return p[1];
  if (/ไทยช่วยไทย/.test(text)) return 'ไทยช่วยไทย';
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
    // เว้นวรรคหลังวันที่ เผื่อเวลาติดกับปี
    time: d ? findTime(text.slice(0, d.at) + ' ' + text.slice(d.at), d.at) : findTime(text, 0),
    amount: findAmount(lines),
    payee: findPayee(lines),
    note: findProgram(text),
  };
}

let workerP = null;
function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('โหลดตัวอ่าน OCR ไม่ได้ ตรวจสอบอินเทอร์เน็ต'));
    document.head.appendChild(s);
  });
}
// ครั้งแรกต้องโหลดตัวอ่านและข้อมูลภาษา (~5 MB) หลังจากนั้นเบราว์เซอร์เก็บไว้ใช้ซ้ำ
export function getWorker(onStatus) {
  if (!workerP) {
    workerP = (async () => {
      if (!window.Tesseract) await loadScript(TESS_URL);
      const w = await window.Tesseract.createWorker(['tha', 'eng'], 1, {
        logger: m => { if (onStatus && m.status && /load|init/i.test(m.status)) onStatus('กำลังเตรียมตัวอ่าน OCR (ครั้งแรกจะช้าหน่อย) …'); },
      });
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

export async function ocrSlip(file, onStatus) {
  const w = await getWorker(onStatus);
  const { data } = await w.recognize(file);
  const d = parseSlipText(data.text);
  d.raw = data.text;
  return d;
}
