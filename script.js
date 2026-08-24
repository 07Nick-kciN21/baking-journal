$(function(){

const LS_ENTRIES = 'baking_journal_entries';
const LS_MOLDS = 'baking_mold_profiles';
const LS_APIKEY = 'baking_api_key';
let entries = [];
let molds = [];
let editingId = null;
let editingMoldId = null;
let editingAttemptId = null;
let attemptPickedOutcome = '';
let currentAttemptPhotos = [];
let expandedAttemptIds = new Set();
let lastAutoSyncedTime = '';

const $grid = $('#grid');
const $countLine = $('#countLine');
const $statusLine = $('#statusLine');
const $overlay = $('#overlay');
const $moldOverlay = $('#moldOverlay');
const $apiOverlay = $('#apiOverlay');
const $searchInput = $('#searchInput');

function uid(prefix){ return (prefix||'e') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
function outcomeLabel(v){ return v === 'success' ? '成功' : v === 'okay' ? '尚可，需微調' : v === 'fail' ? '失敗' : '未評價'; }
function escapeHtml(s){ return $('<div>').text(s == null ? '' : s).html(); }
function roundAmt(n){
  if(!isFinite(n)) return n;
  if(Math.abs(n) >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}
function sanitizeFilename(s){
  return (s || 'recipe').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'recipe';
}

/* ---------- storage (localStorage, standalone static site) ---------- */
function lsGet(key){
  try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch(e){ return null; }
}
function lsSet(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(e){ return false; }
}
function migrateEntry(e){
  if(!e.attempts){
    const hasAttemptData = e.date || e.myContainerId || e.myTime || e.myIngredients ||
      e.resultNotes || e.nextTime || e.outcome || (e.photos && e.photos.length) || e.photo;
    const attempt = {
      id: uid('att'),
      date: e.date || '',
      myContainerId: e.myContainerId || '',
      myContainerLabel: e.myContainerLabel || '',
      myVolume: e.myVolume != null ? e.myVolume : null,
      scaleRatio: e.scaleRatio != null ? e.scaleRatio : null,
      myTime: e.myTime || '',
      myIngredients: e.myIngredients || '',
      resultNotes: e.resultNotes || '',
      nextTime: e.nextTime || '',
      outcome: e.outcome || '',
      photos: e.photos || (e.photo ? [e.photo] : []),
      createdAt: e.date ? (new Date(e.date).getTime() || Date.now()) : Date.now()
    };
    e.attempts = hasAttemptData ? [attempt] : [];
  }
  delete e.date; delete e.myContainerId; delete e.myContainerLabel; delete e.myVolume;
  delete e.scaleRatio; delete e.myTime; delete e.myIngredients; delete e.resultNotes;
  delete e.nextTime; delete e.outcome; delete e.photos; delete e.photo;
  if(e.createdAt == null){
    e.createdAt = e.attempts.length ? Math.min(...e.attempts.map(a=>a.createdAt||Date.now())) : Date.now();
  }
  if(e.updatedAt == null){
    e.updatedAt = e.attempts.length ? Math.max(...e.attempts.map(a=>a.createdAt||0)) : e.createdAt;
  }
}
async function loadAll(){
  entries = lsGet(LS_ENTRIES) || [];
  let migrated = false;
  entries.forEach(e=>{
    if(!e.attempts || e.updatedAt == null || e.createdAt == null){ migrateEntry(e); migrated = true; }
  });
  molds = lsGet(LS_MOLDS) || [];
  render();
  renderMoldSelect();
  updateKeyDot();
  if(migrated) await persistEntries();
}
async function persistEntries(){ return lsSet(LS_ENTRIES, entries); }
async function persistMolds(){ return lsSet(LS_MOLDS, molds); }

/* ---------- API key management ---------- */
function getApiKey(){
  try{ return localStorage.getItem(LS_APIKEY) || ''; }catch(e){ return ''; }
}
function updateKeyDot(){
  $('#keyDot').attr('class', 'key-dot ' + (getApiKey() ? 'on' : 'off'));
}
function openApiSettings(){
  $('#in-apiKey').val(getApiKey()).attr('type', 'password');
  $('#toggleKeyVisBtn').text('顯示');
  $apiOverlay.addClass('open');
}
function closeApiSettings(){ $apiOverlay.removeClass('open'); }
function saveApiKey(){
  const val = $('#in-apiKey').val().trim();
  try{
    if(val) localStorage.setItem(LS_APIKEY, val);
    else localStorage.removeItem(LS_APIKEY);
    updateKeyDot();
    $statusLine.text(val ? '金鑰已儲存在這台瀏覽器' : '金鑰已清除');
    setTimeout(()=>{ $statusLine.text(''); }, 1800);
    closeApiSettings();
  }catch(e){
    $statusLine.text('儲存失敗，請確認瀏覽器允許本機儲存');
  }
}
function clearApiKey(){
  try{ localStorage.removeItem(LS_APIKEY); }catch(e){}
  $('#in-apiKey').val('');
  updateKeyDot();
  $statusLine.text('金鑰已清除');
  setTimeout(()=>{ $statusLine.text(''); }, 1800);
}

/* ---------- mold profiles ---------- */
function moldVolume(m){
  if(m.shape === 'manual') return Number(m.manualVolume) || 0;
  if(m.shape === 'round') return Math.PI * Math.pow((Number(m.diameter)||0)/2, 2) * (Number(m.heightRound)||0);
  if(m.shape === 'rect') return (Number(m.length)||0) * (Number(m.width)||0) * (Number(m.heightRect)||0);
  return 0;
}
function moldDetailText(m){
  const v = Math.round(moldVolume(m));
  if(m.shape === 'round') return `圓形 · 直徑${m.diameter}cm × 高${m.heightRound}cm · 約${v}ml`;
  if(m.shape === 'rect') return `長方形 · ${m.length}×${m.width}×${m.heightRect}cm · 約${v}ml`;
  return `手動容量 · 約${v}ml`;
}
function renderMoldList(){
  const $list = $('#moldList');
  if(molds.length === 0){
    $list.html('<p class="field-hint">還沒有模具設定檔，新增一個常用的模具吧。</p>');
    return;
  }
  $list.html(molds.map(m => `
    <div class="mold-row">
      <div>
        <div class="mold-row-name">${escapeHtml(m.name)}</div>
        <div class="mold-row-detail">${moldDetailText(m)}</div>
      </div>
      <div class="mold-row-actions">
        <button type="button" class="mold-edit-btn" data-id="${m.id}" aria-label="編輯">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button type="button" class="mold-delete-btn" data-id="${m.id}" aria-label="刪除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>`).join(''));
}
function renderMoldSelect(){
  const $sel = $('#in-att-containerSelect');
  const current = $sel.val();
  $sel.html('<option value="">— 選擇模具 —</option>' +
    molds.map(m => `<option value="${m.id}">${escapeHtml(m.name)}（約${Math.round(moldVolume(m))}ml）</option>`).join(''));
  if(molds.some(m => m.id === current)) $sel.val(current);
}
function shapeFieldsSwitch(){
  const shape = $('#mold-shape').val();
  $('#shape-round').toggleClass('active', shape==='round');
  $('#shape-rect').toggleClass('active', shape==='rect');
  $('#shape-manual').toggleClass('active', shape==='manual');
  updateMoldPreview();
}
function readMoldForm(){
  return {
    name: $('#mold-name').val().trim(),
    shape: $('#mold-shape').val(),
    diameter: $('#mold-diameter').val(),
    heightRound: $('#mold-height-round').val(),
    length: $('#mold-length').val(),
    width: $('#mold-width').val(),
    heightRect: $('#mold-height-rect').val(),
    manualVolume: $('#mold-manual-volume').val()
  };
}
function updateMoldPreview(){
  const m = readMoldForm();
  const v = Math.round(moldVolume(m));
  $('#moldVolumePreview').text(v > 0 ? `估計容量：約 ${v} ml` : '');
}
function clearMoldForm(){
  $('#mold-name').val('');
  $('#mold-shape').val('round');
  $('#mold-diameter').val('');
  $('#mold-height-round').val('');
  $('#mold-length').val('');
  $('#mold-width').val('');
  $('#mold-height-rect').val('');
  $('#mold-manual-volume').val('');
  shapeFieldsSwitch();
  editingMoldId = null;
  $('#moldFormLegend').text('新增模具');
  $('#moldSaveBtn').text('新增模具');
  $('#moldCancelEditBtn').hide();
}
function editMold(id){
  const m = molds.find(x => x.id === id);
  if(!m) return;
  editingMoldId = id;
  $('#mold-name').val(m.name || '');
  $('#mold-shape').val(m.shape || 'round');
  $('#mold-diameter').val(m.diameter || '');
  $('#mold-height-round').val(m.heightRound || '');
  $('#mold-length').val(m.length || '');
  $('#mold-width').val(m.width || '');
  $('#mold-height-rect').val(m.heightRect || '');
  $('#mold-manual-volume').val(m.manualVolume || '');
  shapeFieldsSwitch();
  $('#moldFormLegend').text('編輯模具');
  $('#moldSaveBtn').text('儲存變更');
  $('#moldCancelEditBtn').css('display', 'inline-block');
}
async function saveMold(){
  const data = readMoldForm();
  if(!data.name){ $statusLine.text('請輸入模具名稱'); return; }
  if(editingMoldId){
    const idx = molds.findIndex(x => x.id === editingMoldId);
    if(idx > -1) molds[idx] = Object.assign({id: editingMoldId}, data);
  } else {
    molds.push(Object.assign({id: uid('mold')}, data));
  }
  const ok = await persistMolds();
  if(ok){
    renderMoldList(); renderMoldSelect(); clearMoldForm();
    $statusLine.text('模具已儲存');
    setTimeout(()=>{ if($statusLine.text()==='模具已儲存') $statusLine.text(''); }, 1500);
  } else {
    $statusLine.text('儲存失敗，請再試一次');
  }
}
async function deleteMold(id){
  if(!confirm('確定要刪除這個模具設定檔嗎？')) return;
  molds = molds.filter(x => x.id !== id);
  const ok = await persistMolds();
  if(ok){ renderMoldList(); renderMoldSelect(); }
}
function openMoldSettings(){ clearMoldForm(); renderMoldList(); $moldOverlay.addClass('open'); }
function closeMoldSettings(){ $moldOverlay.removeClass('open'); }

/* ---------- ratio ---------- */
function recomputeRatio(){
  const srcVol = Number($('#in-srcVolume').val());
  const moldId = $('#in-att-containerSelect').val();
  const m = molds.find(x => x.id === moldId);
  if(srcVol > 0 && m){
    const myVol = moldVolume(m);
    if(myVol > 0) $('#in-att-scaleRatio').val(roundAmt(myVol / srcVol));
  }
}

/* ---------- markdown table parse/build/render ---------- */
function buildMarkdownTable(items){
  let md = '| 食材 | 份量 | 單位 |\n|---|---|---|\n';
  items.forEach(it => {
    md += `| ${it.name || ''} | ${it.amount === null || it.amount === undefined || it.amount === '' ? '' : it.amount} | ${it.unit || ''} |\n`;
  });
  return md.trim();
}
function parseMarkdownTable(text){
  const lines = (text||'').split('\n').map(l => l.trim()).filter(Boolean);
  const items = [];
  lines.forEach(line => {
    if(!line.startsWith('|')) return;
    if(/^\|[\s:-]+\|[\s:-]+\|[\s:-]*\|?$/.test(line)) return;
    const cells = line.split('|').map(c => c.trim()).filter((c,i,arr) => !(i===0 && c==='') && !(i===arr.length-1 && c===''));
    if(cells.length < 2) return;
    if(cells[0] === '食材' || cells[0].toLowerCase() === 'ingredient') return;
    const amountNum = parseFloat(cells[1]);
    items.push({ name: cells[0], amount: isNaN(amountNum) ? cells[1] : amountNum, unit: cells[2] || '' });
  });
  return items;
}
function renderMdPreview(textareaId, previewId){
  const text = $('#'+textareaId).val();
  const items = parseMarkdownTable(text);
  const $el = $('#'+previewId);
  if(items.length === 0){
    $el.html(text.trim() ? '<p class="empty-note">目前內容還不是可辨識的表格格式，會以純文字儲存。</p>' : '<p class="empty-note">表格預覽會顯示在這裡。</p>');
    return;
  }
  let html = '<table><thead><tr><th>食材</th><th>份量</th><th>單位</th></tr></thead><tbody>';
  items.forEach(it => {
    html += `<tr><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.amount)}</td><td>${escapeHtml(it.unit)}</td></tr>`;
  });
  html += '</tbody></table>';
  $el.html(html);
}

/* ---------- AI conversion (direct browser call, needs user's own key) ---------- */
async function callClaudeConvert(rawText){
  const apiKey = getApiKey();
  if(!apiKey) throw new Error('NO_KEY');
  const systemPrompt = '你是烘焙食譜整理助手。使用者會貼上從影片或網頁複製的原始食譜文字，內容可能雜亂，也可能是英文、日文或其他語言。請將其中的食材與份量整理出來，並將輸出內容全部翻譯成繁體中文，不要保留原文語言（包含食材名稱、單位、容器敘述、溫度時間敘述都要翻成繁體中文）。只回傳 JSON，不要有任何其他文字、不要加 markdown code fence。JSON 格式為：{"items":[{"name":"食材名稱（繁體中文）","amount":數字或null,"unit":"單位，一律使用繁體中文，例如 克、毫升、小匙、大匙、杯、顆、包 等，若無則空字串"}],"sourceContainer":"文字中提到的容器敘述，翻成繁體中文，若無則null","sourceTime":"文字中提到的烘烤溫度與時間，翻成繁體中文敘述，若無則null"}。amount 請盡量轉成純數字，不要包含文字。';
  let data;
  try{
    data = await $.ajax({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      data: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: rawText }]
      })
    });
  }catch(jqXHR){
    if(jqXHR && jqXHR.status === 401) throw new Error('BAD_KEY');
    throw new Error('API_ERROR');
  }
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if(!textBlock) throw new Error('沒有取得回應內容');
  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
async function handleAiConvert(){
  const raw = $('#in-srcIngredients').val().trim();
  const $hint = $('#aiStatusHint');
  const $btn = $('#aiConvertBtn');
  if(!raw){
    $hint.text('請先貼上原始食譜文字').attr('class', 'field-hint warn');
    return;
  }
  if(!getApiKey()){
    $hint.text('請先在右上角「API 設定」輸入你的 Anthropic API key').attr('class', 'field-hint warn');
    openApiSettings();
    return;
  }
  $btn.prop('disabled', true);
  $hint.attr('class', 'field-hint').text('AI 整理中…');
  try{
    const result = await callClaudeConvert(raw);
    const items = Array.isArray(result.items) ? result.items : [];
    if(items.length === 0) throw new Error('EMPTY');
    $('#in-srcIngredients').val(buildMarkdownTable(items));
    renderMdPreview('in-srcIngredients', 'srcPreview');
    if(result.sourceContainer && !$('#in-srcContainer').val().trim()){
      $('#in-srcContainer').val(result.sourceContainer);
    }
    if(result.sourceTime && !$('#in-srcTime').val().trim()){
      $('#in-srcTime').val(result.sourceTime);
    }
    $hint.text('已轉換成表格');
  }catch(e){
    $hint.attr('class', 'field-hint warn');
    if(e.message === 'BAD_KEY') $hint.text('API key 無效或已過期，請到「API 設定」重新輸入');
    else if(e.message === 'EMPTY') $hint.text('沒有解析出食材，請確認貼上的內容');
    else $hint.text('轉換失敗，請確認網路連線或稍後再試');
  }finally{
    $btn.prop('disabled', false);
    setTimeout(()=>{ if($hint.text()==='已轉換成表格') $hint.text(''); }, 2500);
  }
}
async function callClaudeTranslateSteps(rawText){
  const apiKey = getApiKey();
  if(!apiKey) throw new Error('NO_KEY');
  const systemPrompt = '你是烘焙食譜整理助手。使用者會貼上從影片字幕或網頁複製的原始製作流程／步驟文字，內容可能雜亂、有時間軸或雜訊，也可能是英文、日文或其他語言。請將其整理成清楚有條理的繁體中文步驟，翻譯成繁體中文、不要保留原文語言，每個步驟獨立一行，前面加上流水號（例如「1. 」「2. 」），步驟之間不要有多餘的空行。只回傳整理好的步驟文字本身，不要有任何其他說明文字、不要用 JSON、不要加 markdown code fence。';
  let data;
  try{
    data = await $.ajax({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      data: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: rawText }]
      })
    });
  }catch(jqXHR){
    if(jqXHR && jqXHR.status === 401) throw new Error('BAD_KEY');
    throw new Error('API_ERROR');
  }
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if(!textBlock) throw new Error('沒有取得回應內容');
  return textBlock.text.replace(/```[a-z]*|```/g, '').trim();
}
async function handleAiStepsConvert(){
  const raw = $('#in-srcSteps').val().trim();
  const $hint = $('#aiStepsStatusHint');
  const $btn = $('#aiStepsConvertBtn');
  if(!raw){
    $hint.text('請先貼上原始製作流程文字').attr('class', 'field-hint warn');
    return;
  }
  if(!getApiKey()){
    $hint.text('請先在右上角「API 設定」輸入你的 Anthropic API key').attr('class', 'field-hint warn');
    openApiSettings();
    return;
  }
  $btn.prop('disabled', true);
  $hint.attr('class', 'field-hint').text('AI 翻譯整理中…');
  try{
    const steps = await callClaudeTranslateSteps(raw);
    if(!steps) throw new Error('EMPTY');
    $('#in-srcSteps').val(steps);
    $hint.text('已翻譯成中文步驟');
  }catch(e){
    $hint.attr('class', 'field-hint warn');
    if(e.message === 'BAD_KEY') $hint.text('API key 無效或已過期，請到「API 設定」重新輸入');
    else if(e.message === 'EMPTY') $hint.text('沒有取得整理後的步驟，請確認貼上的內容');
    else $hint.text('轉換失敗，請確認網路連線或稍後再試');
  }finally{
    $btn.prop('disabled', false);
    setTimeout(()=>{ if($hint.text()==='已翻譯成中文步驟') $hint.text(''); }, 2500);
  }
}
function recalcScaledTable(){
  const items = parseMarkdownTable($('#in-srcIngredients').val());
  if(items.length === 0){
    $statusLine.text('目前原始食材欄位還沒有可辨識的表格內容');
    setTimeout(()=>{ if($statusLine.text()==='目前原始食材欄位還沒有可辨識的表格內容') $statusLine.text(''); }, 2000);
    return;
  }
  const ratio = Number($('#in-att-scaleRatio').val()) || 1;
  const scaled = items.map(it => ({
    name: it.name,
    amount: typeof it.amount === 'number' ? roundAmt(it.amount * ratio) : it.amount,
    unit: it.unit
  }));
  $('#in-att-myIngredients').val(buildMarkdownTable(scaled));
  renderMdPreview('in-att-myIngredients', 'attPreview');
}

/* ---------- photos (multiple, per attempt) ---------- */
function compressImage(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取照片失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('圖片格式無法讀取'));
      img.onload = () => {
        const maxDim = 900;
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function renderAttemptPhotoArea(){
  const $area = $('#attPhotoArea');
  let html = currentAttemptPhotos.map((p, idx) => `
    <div class="photo-thumb-wrap">
      <img class="photo-thumb" src="${p}">
      <button type="button" class="photo-thumb-remove" data-idx="${idx}" aria-label="移除照片">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');
  html += `
    <div class="photo-add-tile" id="attPhotoAddTile">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>新增照片</span>
    </div>`;
  $area.html(html);
}

/* ---------- entries render (top-level cards) ---------- */
function latestAttempt(entry){
  const atts = entry.attempts || [];
  return atts.length ? atts[atts.length - 1] : null;
}
function matchesSearch(entry, q){
  if(!q) return true;
  q = q.toLowerCase();
  const attemptText = (entry.attempts||[]).map(a => [a.resultNotes, a.nextTime, a.myTime, a.myIngredients].join(' ')).join(' ');
  const hay = [entry.title, entry.videoNote, entry.srcContainer, entry.srcSteps, attemptText, (entry.tags||[]).join(' ')].join(' ').toLowerCase();
  return hay.includes(q);
}
function render(){
  const q = $searchInput.val().trim();
  const filtered = entries.filter(e => matchesSearch(e, q)).sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  $countLine.text(entries.length === 0 ? '' : `共 ${entries.length} 筆紀錄${q ? '，符合搜尋 ' + filtered.length + ' 筆' : ''}`);
  if(entries.length === 0){
    $grid.html(`
      <div class="empty">
        <h2>還沒有任何紀錄</h2>
        <p>做完下一個蛋糕，把容器、時間和成果記下來，下次就不用再猜一次。</p>
        <button type="button" class="btn-add empty-add-btn">+ 新增第一筆紀錄</button>
      </div>`);
    return;
  }
  if(filtered.length === 0){
    $grid.html(`<div class="empty"><h2>沒有符合的紀錄</h2><p>換個關鍵字再找找看。</p></div>`);
    return;
  }
  $grid.html(filtered.map(e => {
    const latest = latestAttempt(e);
    const outcomeClass = 'outcome-' + (latest ? (latest.outcome || 'okay') : 'none');
    const tagsHtml = (e.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    const photos = latest ? (latest.photos || []) : [];
    const photoHtml = photos.length ? `
      <div class="card-photo-wrap">
        <img class="card-photo" src="${photos[0]}">
        ${photos.length > 1 ? `<span class="card-photo-badge">+${photos.length - 1}</span>` : ''}
      </div>` : '';
    const attemptCount = (e.attempts||[]).length;
    return `
      <div class="card ${outcomeClass}" data-id="${e.id}">
        ${photoHtml}
        <div class="card-top">
          <div>
            <p class="card-title">${escapeHtml(e.title || '未命名')}</p>
            <div class="card-meta">
              ${latest && latest.date ? '<span>' + escapeHtml(latest.date) + '</span>' : ''}
              ${latest && latest.myContainerLabel ? '<span>' + escapeHtml(latest.myContainerLabel) + '</span>' : ''}
              ${latest && latest.myTime ? '<span>' + escapeHtml(latest.myTime) + '</span>' : ''}
              <span class="attempt-count">共 ${attemptCount} 次調整</span>
            </div>
          </div>
          <span class="stamp ${outcomeClass}">${latest ? outcomeLabel(latest.outcome) : '尚無調整記錄'}</span>
        </div>
        ${latest && latest.nextTime ? `<div class="card-next"><span class="label">下次調整</span>${escapeHtml(latest.nextTime)}</div>` : ''}
        ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
      </div>`;
  }).join(''));
}

/* ---------- attempt sub-form (each bake attempt under an entry) ---------- */
function resetTimeSyncTracking(){
  const v = $('#in-att-myTime').val();
  lastAutoSyncedTime = v === '' ? '' : null;
}
function syncMyTimeFromSrc(){
  const $myTime = $('#in-att-myTime');
  if($myTime.val() === '' || $myTime.val() === lastAutoSyncedTime){
    const val = $('#in-srcTime').val();
    $myTime.val(val);
    lastAutoSyncedTime = val;
  }
}
function updateAttemptOutcomePicker(){
  $('#attOutcomePicker .outcome-opt').each(function(){
    const $el = $(this);
    $el.attr('class', 'outcome-opt' + ($el.data('val') === attemptPickedOutcome ? ' picked-' + attemptPickedOutcome : ''));
  });
}
function clearAttemptForm(){
  ['att-date','att-scaleRatio','att-myTime','att-myIngredients','att-resultNotes','att-nextTime'].forEach(k=>{
    $('#in-'+k).val('');
  });
  $('#in-att-date').val(new Date().toISOString().slice(0,10));
  $('#in-att-containerSelect').val('');
  attemptPickedOutcome = '';
  currentAttemptPhotos = [];
  editingAttemptId = null;
  resetTimeSyncTracking();
  renderAttemptPhotoArea();
  updateAttemptOutcomePicker();
  renderMdPreview('in-att-myIngredients', 'attPreview');
  $('#attemptFormTitle').text('新增一次調整記錄');
  $('#saveAttemptBtn').text('儲存這筆調整記錄');
}
function fillAttemptForm(a){
  $('#in-att-date').val(a.date || '');
  $('#in-att-containerSelect').val(a.myContainerId || '');
  $('#in-att-scaleRatio').val(a.scaleRatio == null ? '' : a.scaleRatio);
  $('#in-att-myTime').val(a.myTime || '');
  resetTimeSyncTracking();
  $('#in-att-myIngredients').val(a.myIngredients || '');
  $('#in-att-resultNotes').val(a.resultNotes || '');
  $('#in-att-nextTime').val(a.nextTime || '');
  attemptPickedOutcome = a.outcome || '';
  currentAttemptPhotos = (a.photos || []).slice();
  editingAttemptId = a.id;
  renderAttemptPhotoArea();
  updateAttemptOutcomePicker();
  renderMdPreview('in-att-myIngredients', 'attPreview');
  $('#attemptFormTitle').text('編輯這筆調整記錄');
  $('#saveAttemptBtn').text('儲存變更');
}
function showAttemptForm(){
  $('#attemptForm').show();
  $('#addAttemptBtn').hide();
}
function hideAttemptForm(){
  $('#attemptForm').hide();
  $('#addAttemptBtn').show();
  editingAttemptId = null;
}
function openAttemptForm(id){
  renderMoldSelect();
  if(id){
    const entry = entries.find(x => x.id === editingId);
    const a = entry && entry.attempts.find(x => x.id === id);
    if(!a) return;
    fillAttemptForm(a);
  } else {
    clearAttemptForm();
  }
  showAttemptForm();
  $('#attemptForm').get(0).scrollIntoView({behavior:'smooth', block:'nearest'});
}
async function saveAttempt(){
  const entry = entries.find(x => x.id === editingId);
  if(!entry) return;
  const moldId = $('#in-att-containerSelect').val();
  const moldObj = molds.find(x => x.id === moldId);
  const prev = editingAttemptId ? entry.attempts.find(x => x.id === editingAttemptId) : null;
  const data = {
    id: editingAttemptId || uid('att'),
    date: $('#in-att-date').val() || new Date().toISOString().slice(0,10),
    myContainerId: moldId || '',
    myContainerLabel: moldObj ? moldObj.name : '',
    myVolume: moldObj ? Math.round(moldVolume(moldObj)) : null,
    scaleRatio: $('#in-att-scaleRatio').val() ? Number($('#in-att-scaleRatio').val()) : null,
    myTime: $('#in-att-myTime').val().trim(),
    myIngredients: $('#in-att-myIngredients').val().trim(),
    resultNotes: $('#in-att-resultNotes').val().trim(),
    nextTime: $('#in-att-nextTime').val().trim(),
    outcome: attemptPickedOutcome,
    photos: currentAttemptPhotos.slice(),
    createdAt: prev ? (prev.createdAt || Date.now()) : Date.now()
  };
  if(editingAttemptId){
    const idx = entry.attempts.findIndex(x => x.id === editingAttemptId);
    if(idx > -1) entry.attempts[idx] = data;
  } else {
    entry.attempts.push(data);
  }
  entry.updatedAt = Date.now();
  $statusLine.text('儲存中…');
  const ok = await persistEntries();
  $statusLine.text(ok ? '已儲存這筆調整記錄' : '儲存失敗，本機儲存空間可能已滿');
  if(ok){
    expandedAttemptIds = new Set([data.id]);
    hideAttemptForm();
    renderAttemptsList();
    render();
    setTimeout(()=>{ if($statusLine.text()==='已儲存這筆調整記錄') $statusLine.text(''); }, 1500);
  }
}
async function deleteAttempt(id){
  const entry = entries.find(x => x.id === editingId);
  if(!entry) return;
  if(!confirm('確定要刪除這筆調整記錄嗎？此動作無法復原。')) return;
  entry.attempts = entry.attempts.filter(x => x.id !== id);
  entry.updatedAt = Date.now();
  expandedAttemptIds.delete(id);
  $statusLine.text('刪除中…');
  const ok = await persistEntries();
  $statusLine.text(ok ? '已刪除' : '刪除失敗，請再試一次');
  if(ok){
    renderAttemptsList();
    render();
    setTimeout(()=>{ if($statusLine.text()==='已刪除') $statusLine.text(''); }, 1500);
  }
}
function attemptSummaryLine(a){
  const parts = [];
  if(a.date) parts.push(a.date);
  if(a.myContainerLabel) parts.push(a.myContainerLabel);
  if(a.myTime) parts.push(a.myTime);
  return parts.join(' · ');
}
function renderAttemptsList(){
  const entry = entries.find(x => x.id === editingId);
  const $list = $('#attemptsList');
  if(!entry || !entry.attempts || entry.attempts.length === 0){
    $list.html('<p class="field-hint">還沒有調整記錄，做完之後點下方「新增一次調整記錄」記下來。</p>');
    return;
  }
  const ordered = entry.attempts.slice().reverse();
  $list.html(ordered.map(a => {
    const outcomeClass = 'outcome-' + (a.outcome || 'none');
    const expanded = expandedAttemptIds.has(a.id);
    const items = parseMarkdownTable(a.myIngredients || '');
    const ingredientsHtml = items.length
      ? '<table><thead><tr><th>食材</th><th>份量</th><th>單位</th></tr></thead><tbody>' +
        items.map(it => `<tr><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.amount)}</td><td>${escapeHtml(it.unit)}</td></tr>`).join('') +
        '</tbody></table>'
      : (a.myIngredients ? `<p class="empty-note">${escapeHtml(a.myIngredients)}</p>` : '');
    const photosHtml = (a.photos||[]).length
      ? '<div class="photo-grid">' + a.photos.map(p => `<div class="photo-thumb-wrap"><img class="photo-thumb" src="${p}"></div>`).join('') + '</div>'
      : '';
    return `
      <div class="attempt-row ${expanded ? 'expanded' : ''}" data-id="${a.id}">
        <div class="attempt-row-head" data-action="toggle">
          <div class="attempt-row-main">
            <span class="stamp ${outcomeClass}">${outcomeLabel(a.outcome)}</span>
            <span class="attempt-summary">${escapeHtml(attemptSummaryLine(a)) || '（尚未填寫細節）'}</span>
          </div>
          <div class="attempt-row-actions">
            <button type="button" class="icon-btn" data-action="edit" aria-label="編輯這筆調整記錄">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button type="button" class="icon-btn" data-action="delete" aria-label="刪除這筆調整記錄">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
            <span class="chevron">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </span>
          </div>
        </div>
        <div class="attempt-detail" ${expanded ? '' : 'style="display:none;"'}>
          ${a.scaleRatio ? `<p class="attempt-detail-line"><span class="label">換算倍率</span>${escapeHtml(String(a.scaleRatio))}</p>` : ''}
          ${ingredientsHtml}
          ${a.resultNotes ? `<div class="attempt-detail-block"><span class="label">成果描述</span><p>${escapeHtml(a.resultNotes)}</p></div>` : ''}
          ${a.nextTime ? `<div class="attempt-detail-block"><span class="label">下次調整</span><p>${escapeHtml(a.nextTime)}</p></div>` : ''}
          ${photosHtml}
        </div>
      </div>`;
  }).join(''));
}

/* ---------- entry form (source-level info) ---------- */
function clearForm(){
  ['title','videoUrl','videoNote','srcContainer','srcVolume','srcTime','srcIngredients','srcSteps','tags'].forEach(k=>{
    $('#in-'+k).val('');
  });
  $('#aiStatusHint').text('');
  $('#aiStepsStatusHint').text('');
  renderMdPreview('in-srcIngredients', 'srcPreview');
  $('#f-title').removeClass('invalid');
  $('#exportBtn').hide();
}
function fillForm(e){
  $('#in-title').val(e.title || '');
  $('#in-videoUrl').val(e.videoUrl || '');
  $('#in-videoNote').val(e.videoNote || '');
  $('#in-srcContainer').val(e.srcContainer || '');
  $('#in-srcVolume').val(e.srcVolume || '');
  $('#in-srcTime').val(e.srcTime || '');
  $('#in-srcIngredients').val(e.srcIngredients || '');
  $('#in-srcSteps').val(e.srcSteps || '');
  $('#in-tags').val((e.tags||[]).join(', '));
  $('#aiStatusHint').text('');
  $('#aiStepsStatusHint').text('');
  renderMdPreview('in-srcIngredients', 'srcPreview');
  $('#exportBtn').css('display', 'inline-block');
}
function openModal(id){
  editingId = id || null;
  const $deleteBtn = $('#deleteBtn');
  hideAttemptForm();
  if(id){
    const e = entries.find(x => x.id === id);
    if(!e) return;
    $('#modalTitle').text('編輯紀錄');
    fillForm(e);
    $('#attemptsFieldset').show();
    expandedAttemptIds = new Set();
    const latest = latestAttempt(e);
    if(latest) expandedAttemptIds.add(latest.id);
    renderMoldSelect();
    renderAttemptsList();
    $deleteBtn.css('display', 'inline-block');
  } else {
    $('#modalTitle').text('新增紀錄');
    clearForm();
    $('#attemptsFieldset').hide();
    $deleteBtn.hide();
  }
  $overlay.addClass('open');
}
function closeModal(){ $overlay.removeClass('open'); hideAttemptForm(); editingId = null; }

async function saveEntry(){
  const $titleField = $('#f-title');
  const title = $('#in-title').val().trim();
  if(!title){ $titleField.addClass('invalid'); return; }
  $titleField.removeClass('invalid');

  const tagsRaw = $('#in-tags').val().trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];
  const now = Date.now();
  const isNew = !editingId;

  const fields = {
    title,
    videoUrl: $('#in-videoUrl').val().trim(),
    videoNote: $('#in-videoNote').val().trim(),
    srcContainer: $('#in-srcContainer').val().trim(),
    srcVolume: $('#in-srcVolume').val() ? Number($('#in-srcVolume').val()) : null,
    srcTime: $('#in-srcTime').val().trim(),
    srcIngredients: $('#in-srcIngredients').val().trim(),
    srcSteps: $('#in-srcSteps').val().trim(),
    tags
  };

  if(isNew){
    const newEntry = Object.assign({ id: uid(), attempts: [], createdAt: now, updatedAt: now }, fields);
    entries.push(newEntry);
    editingId = newEntry.id;
  } else {
    const idx = entries.findIndex(x => x.id === editingId);
    if(idx > -1){ Object.assign(entries[idx], fields); entries[idx].updatedAt = now; }
  }

  $statusLine.text('儲存中…');
  const ok = await persistEntries();
  $statusLine.text(ok ? '已儲存' : '儲存失敗，本機儲存空間可能已滿');
  if(ok){
    render();
    if(isNew){
      $('#modalTitle').text('編輯紀錄');
      $('#deleteBtn').css('display', 'inline-block');
      $('#exportBtn').css('display', 'inline-block');
      $('#attemptsFieldset').show();
      expandedAttemptIds = new Set();
      renderMoldSelect();
      renderAttemptsList();
      $statusLine.text('已儲存，可以在下方新增這次的調整記錄了');
    } else {
      closeModal();
    }
    setTimeout(()=>{ if($statusLine.text()==='已儲存' || $statusLine.text()==='已儲存，可以在下方新增這次的調整記錄了') $statusLine.text(''); }, 2200);
  }
}
async function deleteEntry(){
  if(!editingId) return;
  if(!confirm('確定要刪除這筆紀錄嗎？所有調整記錄也會一併刪除，此動作無法復原。')) return;
  entries = entries.filter(x => x.id !== editingId);
  $statusLine.text('刪除中…');
  const ok = await persistEntries();
  $statusLine.text(ok ? '已刪除' : '刪除失敗，請再試一次');
  if(ok){
    closeModal(); render();
    setTimeout(()=>{ if($statusLine.text()==='已刪除') $statusLine.text(''); }, 1500);
  }
}

/* ---------- export / import single entry ---------- */
function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const $a = $('<a>').attr({ href: url, download: filename }).appendTo('body');
  $a.get(0).click();
  $a.remove();
  URL.revokeObjectURL(url);
}
function exportCurrentEntry(){
  if(!editingId) return;
  const e = entries.find(x => x.id === editingId);
  if(!e) return;
  const latest = latestAttempt(e);
  const dateStr = latest && latest.date ? latest.date : new Date(e.updatedAt || Date.now()).toISOString().slice(0,10);
  downloadJSON(e, `${sanitizeFilename(e.title)}_${dateStr}.json`);
}
function handleImportFile(ev){
  const file = ev.target.files && ev.target.files[0];
  $(ev.target).val('');
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const data = JSON.parse(reader.result);
      if(!data || typeof data !== 'object' || Array.isArray(data)){
        throw new Error('格式不正確');
      }
      if(!data.title){
        $statusLine.text('這個檔案看起來不是有效的紀錄（缺少名稱）');
        return;
      }
      migrateEntry(data);
      const imported = Object.assign({}, data, {
        id: uid(),
        attempts: data.attempts.map(a => Object.assign({}, a, { id: uid('att'), myContainerId: '', myContainerLabel: '' })),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      entries.push(imported);
      $statusLine.text('匯入中…');
      const ok = await persistEntries();
      if(ok){
        render();
        openModal(imported.id);
        $statusLine.text(imported.attempts.length ? '已匯入，模具容器需重新選擇' : '已匯入');
        setTimeout(()=>{ $statusLine.text(''); }, 3000);
      } else {
        $statusLine.text('匯入失敗，本機儲存空間可能已滿');
      }
    }catch(e){
      $statusLine.text('匯入失敗，請確認是先前匯出的 JSON 檔案');
      setTimeout(()=>{ if($statusLine.text()==='匯入失敗，請確認是先前匯出的 JSON 檔案') $statusLine.text(''); }, 2500);
    }
  };
  reader.onerror = () => { $statusLine.text('讀取檔案失敗'); };
  reader.readAsText(file);
}

/* ---------- events ---------- */
$('#addBtn').on('click', ()=>openModal());
$('#closeBtn').on('click', closeModal);
$('#saveBtn').on('click', saveEntry);
$('#deleteBtn').on('click', deleteEntry);
$('#exportBtn').on('click', exportCurrentEntry);
$overlay.on('click', function(ev){ if(ev.target === this) closeModal(); });
$searchInput.on('input', render);

$grid.on('click', '.card', function(){ openModal($(this).data('id')); });
$grid.on('click', '.empty-add-btn', function(){ openModal(); });

$('#importBtn').on('click', ()=>{
  $('#importFile').trigger('click');
});
$('#importFile').on('change', handleImportFile);

$('#addAttemptBtn').on('click', ()=>openAttemptForm(null));
$('#cancelAttemptBtn').on('click', hideAttemptForm);
$('#saveAttemptBtn').on('click', saveAttempt);
$('#attOutcomePicker').on('click', function(ev){
  const $opt = $(ev.target).closest('.outcome-opt');
  if($opt.length === 0) return;
  attemptPickedOutcome = $opt.data('val');
  updateAttemptOutcomePicker();
});
$('#attemptsList').on('click', function(ev){
  const $target = $(ev.target);
  const $row = $target.closest('.attempt-row');
  if($row.length === 0) return;
  const attId = $row.data('id');
  if($target.closest('[data-action="edit"]').length){ openAttemptForm(attId); return; }
  if($target.closest('[data-action="delete"]').length){ deleteAttempt(attId); return; }
  if($target.closest('.attempt-row-head').length){
    if(expandedAttemptIds.has(attId)) expandedAttemptIds.delete(attId);
    else expandedAttemptIds.add(attId);
    renderAttemptsList();
  }
});

$('#attPhotoArea').on('click', '.photo-add-tile', function(){
  $('#in-att-photoFile').trigger('click');
});
$('#attPhotoArea').on('click', '.photo-thumb-remove', function(ev){
  ev.stopPropagation();
  const idx = Number($(this).data('idx'));
  currentAttemptPhotos.splice(idx, 1);
  renderAttemptPhotoArea();
});

$('#in-att-photoFile').on('change', async function(ev){
  const files = Array.from(this.files || []);
  $(this).val('');
  if(files.length === 0) return;
  $statusLine.text('處理照片中…');
  for(const file of files){
    try{
      const compressed = await compressImage(file);
      currentAttemptPhotos.push(compressed);
    }catch(err){
      $statusLine.text('有一張照片處理失敗，已略過');
    }
  }
  renderAttemptPhotoArea();
  if($statusLine.text() === '處理照片中…') $statusLine.text('');
});

$('#in-att-containerSelect').on('change', recomputeRatio);
$('#in-srcVolume').on('input', recomputeRatio);
$('#in-srcTime').on('input', syncMyTimeFromSrc);
$('#aiConvertBtn').on('click', handleAiConvert);
$('#aiStepsConvertBtn').on('click', handleAiStepsConvert);
$('#attRecalcBtn').on('click', recalcScaledTable);
$('#in-srcIngredients').on('input', ()=>renderMdPreview('in-srcIngredients','srcPreview'));
$('#in-att-myIngredients').on('input', ()=>renderMdPreview('in-att-myIngredients','attPreview'));

$('#moldSettingsBtn').on('click', openMoldSettings);
$('#manageMoldFromAttempt').on('click', openMoldSettings);
$('#moldCloseBtn').on('click', closeMoldSettings);
$moldOverlay.on('click', function(ev){ if(ev.target === this) closeMoldSettings(); });
$('#moldList').on('click', '.mold-edit-btn', function(){ editMold($(this).data('id')); });
$('#moldList').on('click', '.mold-delete-btn', function(){ deleteMold($(this).data('id')); });
$('#mold-shape').on('change', shapeFieldsSwitch);
$('#mold-diameter, #mold-height-round, #mold-length, #mold-width, #mold-height-rect, #mold-manual-volume').on('input', updateMoldPreview);
$('#moldSaveBtn').on('click', saveMold);
$('#moldCancelEditBtn').on('click', clearMoldForm);

$('#apiSettingsBtn').on('click', openApiSettings);
$('#apiCloseBtn').on('click', closeApiSettings);
$apiOverlay.on('click', function(ev){ if(ev.target === this) closeApiSettings(); });
$('#saveKeyBtn').on('click', saveApiKey);
$('#clearKeyBtn').on('click', clearApiKey);
$('#toggleKeyVisBtn').on('click', function(){
  const $inp = $('#in-apiKey');
  const $btn = $(this);
  if($inp.attr('type') === 'password'){ $inp.attr('type', 'text'); $btn.text('隱藏'); }
  else { $inp.attr('type', 'password'); $btn.text('顯示'); }
});

loadAll();

});
