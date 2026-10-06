// อ่านรูปสลีปแล้วแปลงเป็นบรรทัดข้อความ: ฟรีด้วย OCR ในเครื่อง หรือด้วย Claude เมื่อมี API key
// รูปแบบ: YYYY-MM-DD HH:MM | จำนวนเงิน | ผู้รับ | บันทึก
import Anthropic from './vendor/anthropic-sdk.mjs';
import { ocrSlip } from './slip-ocr.js';

const AKEY = 'slipbudget:apikey', MKEY = 'slipbudget:readmode';
const MODEL = 'claude-opus-5-5';
const $ = id => document.getElementById(id);

const SLIP_SCHEMA = {
  type: 'object',
  properties: {
    is_slip: { type: 'boolean', description: 'รูปนี้เป็นสลีปโอนเงิน/ชำระเงินหรือไม่' },
    date: { type: 'string', description: 'วันที่ทำรายการ แบบ YYYY-MM-DD เป็นปี ค.ศ.' },
    time: { type: 'string', description: 'เวลาทำรายการ แบบ HH:MM (24 ชั่วโมง)' },
    amount: { type: 'string', description: 'จำนวนเงิน ตัวเลขตามที่พิมพ์บนสลีป ไม่มีจุลภาคและไม่มีหน่วย' },
    payee: { type: 'string', description: 'ชื่อผู้รับเงินหรือร้านค้า ตามที่พิมพ์บนสลีป' },
    note: { type: 'string', description: 'ชื่อโครงการรัฐ เช่น ไทยช่วยไทย หรือว่างถ้าไม่มี' },
  },
  required: ['is_slip', 'date', 'time', 'amount', 'payee', 'note'],
  additionalProperties: false,
};

const PROMPT = `อ่านสลีปโอนเงิน/ชำระเงินในรูปนี้ แล้วกรอกข้อมูลตาม schema
- date: แปลงปี พ.ศ. เป็น ค.ศ. (ลบ 543) และเดือนภาษาไทย/อังกฤษเป็นตัวเลข เช่น "5 ต.ค. 69" → 2026-10-05
- time: เวลาบนสลีปแบบ 24 ชั่วโมง HH:MM ไม่ต้องมีวินาที
- amount: ตัวเลขจำนวนเงินตามที่พิมพ์ เช่น "87.00" หรือ "50" ไม่ใส่จุลภาค ไม่ใส่ "บาท"
- payee: ชื่อผู้รับเงิน/ร้านค้า (ฝั่งปลายทาง ไม่ใช่ผู้โอน) สะกดตามสลีปทุกตัวอักษร
- note: ถ้าเป็นการจ่ายผ่านโครงการรัฐ เช่น ไทยช่วยไทย หรือ คนละครึ่ง ให้ใส่ชื่อโครงการ นอกนั้นให้เป็นข้อความว่าง ไม่ต้องใส่บันทึกช่วยจำ (memo) ที่ผู้โอนพิมพ์เอง
- ถ้ารูปไม่ใช่สลีป ให้ is_slip เป็น false และช่องอื่นเป็นข้อความว่าง`;

let apiKey = '', mode = '';
try { apiKey = localStorage.getItem(AKEY) || ''; mode = localStorage.getItem(MKEY) || ''; } catch (e) {}
if (mode !== 'ocr' && mode !== 'claude') mode = apiKey ? 'claude' : 'ocr';

const say = (ok, t) => { const s = $('slipst'); s.className = 'st ' + (ok ? 'ok' : 'er'); s.textContent = t; };

// ย่อรูปให้ด้านยาวไม่เกิน 1600px แล้วเข้ารหัส JPEG base64 (ลดขนาดที่ส่งและค่าใช้จ่าย)
async function toJpegBase64(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export function slipLine(d) {
  return [`${d.date} ${d.time}`.trim(), d.amount, d.payee, d.note]
    .map(x => String(x ?? '').replace(/[|\n\r]+/g, ' ').trim())
    .join(' | ').trimEnd();
}

async function readSlip(client, file) {
  const data = await toJpegBase64(file);
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SLIP_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (res.stop_reason === 'refusal') throw new Error('ระบบปฏิเสธการอ่านรูปนี้');
  if (res.stop_reason === 'max_tokens') throw new Error('คำตอบถูกตัด ลองใหม่อีกครั้ง');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const d = JSON.parse(text);
  if (!d.is_slip) throw new Error('ไม่ใช่สลีป');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !(parseFloat(d.amount) > 0)) throw new Error('อ่านวันที่หรือจำนวนเงินไม่ได้');
  if (d.time && /^\d:\d{2}$/.test(d.time)) d.time = '0' + d.time;
  return d;
}

function errText(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API key ไม่ถูกต้อง';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key นี้ไม่มีสิทธิ์ใช้งาน';
  if (e instanceof Anthropic.RateLimitError) return 'เรียกใช้ถี่เกินไป ลองใหม่อีกครั้ง';
  if (e instanceof Anthropic.APIConnectionError) return 'เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ต';
  if (e instanceof Anthropic.APIError) return 'เกิดข้อผิดพลาดจาก API: ' + (e.message || e.status);
  return e && e.message ? e.message : String(e);
}

// OCR ไม่ได้ตรวจว่าเป็นสลีปจริงหรือไม่ จึงคืนบรรทัดแม้อ่านได้ไม่ครบ ให้ผู้ใช้แก้เอง
async function readSlipOcr(file) {
  const d = await ocrSlip(file, t => say(true, t));
  const miss = [!d.date && 'วันที่', !d.time && 'เวลา', !(parseFloat(d.amount) > 0) && 'จำนวนเงิน', !d.payee && 'ผู้รับ'].filter(Boolean);
  if (!d.date && !(parseFloat(d.amount) > 0)) throw new Error('ไม่พบวันที่และจำนวนเงิน อาจไม่ใช่สลีป');
  return { d, warn: miss.length ? 'อ่าน ' + miss.join(', ') + ' ไม่ได้ แก้ในกล่องข้อความ' : '' };
}

async function readFiles(files) {
  if (mode === 'claude' && !apiKey) {
    $('slipkey').closest('details').open = true;
    $('slipkey').focus();
    return say(false, 'ใส่ Anthropic API key ก่อน แล้วกดบันทึก หรือเปลี่ยนเป็น "อ่านฟรีในเครื่อง"');
  }
  const client = mode === 'claude' ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : null;
  const out = new Array(files.length), errs = [], warns = [];
  let done = 0, next = 0;
  say(true, `กำลังอ่าน 0/${files.length} …`);
  // Claude: อ่านพร้อมกันครั้งละ 3 รูป · OCR: ทีละรูป (ใช้เครื่องคำนวณเอง) · เรียงผลตามลำดับรูปที่เลือก
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try {
        if (client) out[i] = slipLine(await readSlip(client, files[i]));
        else {
          const r = await readSlipOcr(files[i]);
          out[i] = slipLine(r.d);
          if (r.warn) warns.push(`${files[i].name}: ${r.warn}`);
        }
      }
      catch (e) { errs.push(`${files[i].name}: ${errText(e)}`); }
      say(true, `กำลังอ่าน ${++done}/${files.length} …`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(client ? 3 : 1, files.length) }, worker));
  const lines = out.filter(Boolean);
  if (lines.length) {
    const tx = $('sliptx');
    tx.value = (tx.value.trim() ? tx.value.trim() + '\n' : '') + lines.join('\n');
  }
  const s = $('slipst'); s.className = 'st'; s.innerHTML = '';
  const line = (cls, t) => { const d = document.createElement('div'); d.className = cls; d.textContent = t; s.appendChild(d); };
  line(lines.length ? 'ok' : 'er', `✓ อ่านได้ ${lines.length}/${files.length} สลีป`);
  warns.forEach(t => line('er', '⚠ ' + t));
  errs.forEach(t => line('er', '✕ ' + t));
  if (!client && lines.length) line('', 'อ่านแบบฟรีอาจสะกดชื่อผิดบ้าง ตรวจก่อนกด "เพิ่มเข้าแอป"');
}

$('slipbtn').onclick = () => $('slipfile').click();
$('slipfile').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) readFiles(fs); };
$('slipkey').value = apiKey;
$('slipmode').value = mode;
$('slipmode').onchange = e => { mode = e.target.value; try { localStorage.setItem(MKEY, mode); } catch (er) {} };
$('slipkeysave').onclick = () => {
  apiKey = $('slipkey').value.trim();
  try { apiKey ? localStorage.setItem(AKEY, apiKey) : localStorage.removeItem(AKEY); } catch (e) {}
  say(true, apiKey ? 'บันทึก API key แล้ว' : 'ลบ API key แล้ว');
  if (apiKey && mode !== 'claude') { mode = 'claude'; $('slipmode').value = mode; try { localStorage.setItem(MKEY, mode); } catch (e) {} }
  if (apiKey) $('slipkey').closest('details').open = false;
};
$('slipcopy').onclick = async () => {
  const t = $('sliptx').value.trim(); if (!t) return say(false, 'ยังไม่มีข้อความ');
  try { await navigator.clipboard.writeText(t); say(true, 'คัดลอกแล้ว ✓'); }
  catch (e) { $('sliptx').select(); document.execCommand('copy'); say(true, 'คัดลอกแล้ว ✓'); }
};
$('slipadd').onclick = () => {
  const r = window.importLines($('sliptx').value);
  if (!r.lines) return say(false, 'ยังไม่มีข้อความ');
  say(!r.bad, `✓ เพิ่ม ${r.n} รายการ` + (r.dup ? ` · ซ้ำ ${r.dup}` : '') + (r.bad ? ` · ข้าม ${r.bad} บรรทัดที่รูปแบบไม่ถูก` : ''));
  if (r.n && !r.bad) $('sliptx').value = '';
};
