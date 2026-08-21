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

const grid = document.getElementById('grid');
const countLine = document.getElementById('countLine');
const statusLine = document.getElementById('statusLine');
const overlay = document.getElementById('overlay');
const moldOverlay = document.getElementById('moldOverlay');
const apiOverlay = document.getElementById('apiOverlay');
const searchInput = document.getElementById('searchInput');

function uid(prefix){ return (prefix||'e') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
function outcomeLabel(v){ return v === 'success' ? '成功' : v === 'okay' ? '尚可，需微調' : v === 'fail' ? '失敗' : '未評價'; }
function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
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
  const dot = document.getElementById('keyDot');
  dot.className = 'key-dot ' + (getApiKey() ? 'on' : 'off');
}
function openApiSettings(){
  document.getElementById('in-apiKey').value = getApiKey();
  document.getElementById('in-apiKey').type = 'password';
  document.getElementById('toggleKeyVisBtn').textContent = '顯示';
  apiOverlay.classList.add('open');
}
function closeApiSettings(){ apiOverlay.classList.remove('open'); }
function saveApiKey(){
  const val = document.getElementById('in-apiKey').value.trim();
  try{
    if(val) localStorage.setItem(LS_APIKEY, val);
    else localStorage.removeItem(LS_APIKEY);
    updateKeyDot();
    statusLine.textContent = val ? '金鑰已儲存在這台瀏覽器' : '金鑰已清除';
    setTimeout(()=>{ statusLine.textContent=''; }, 1800);
    closeApiSettings();
  }catch(e){
    statusLine.textContent = '儲存失敗，請確認瀏覽器允許本機儲存';
  }
}
function clearApiKey(){
  try{ localStorage.removeItem(LS_APIKEY); }catch(e){}
  document.getElementById('in-apiKey').value = '';
  updateKeyDot();
  statusLine.textContent = '金鑰已清除';
  setTimeout(()=>{ statusLine.textContent=''; }, 1800);
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
  const list = document.getElementById('moldList');
  if(molds.length === 0){
    list.innerHTML = '<p class="field-hint">還沒有模具設定檔，新增一個常用的模具吧。</p>';
    return;
  }
  list.innerHTML = molds.map(m => `
    <div class="mold-row">
      <div>
        <div class="mold-row-name">${escapeHtml(m.name)}</div>
        <div class="mold-row-detail">${moldDetailText(m)}</div>
      </div>
      <div class="mold-row-actions">
        <button onclick="editMold('${m.id}')" aria-label="編輯">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button onclick="deleteMold('${m.id}')" aria-label="刪除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>`).join('');
}
function renderMoldSelect(){
  const sel = document.getElementById('in-att-containerSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">— 選擇模具 —</option>' +
    molds.map(m => `<option value="${m.id}">${escapeHtml(m.name)}（約${Math.round(moldVolume(m))}ml）</option>`).join('');
  if(molds.some(m => m.id === current)) sel.value = current;
}
function shapeFieldsSwitch(){
  const shape = document.getElementById('mold-shape').value;
  document.getElementById('shape-round').classList.toggle('active', shape==='round');
  document.getElementById('shape-rect').classList.toggle('active', shape==='rect');
  document.getElementById('shape-manual').classList.toggle('active', shape==='manual');
  updateMoldPreview();
}
function readMoldForm(){
  return {
    name: document.getElementById('mold-name').value.trim(),
    shape: document.getElementById('mold-shape').value,
    diameter: document.getElementById('mold-diameter').value,
    heightRound: document.getElementById('mold-height-round').value,
    length: document.getElementById('mold-length').value,
    width: document.getElementById('mold-width').value,
    heightRect: document.getElementById('mold-height-rect').value,
    manualVolume: document.getElementById('mold-manual-volume').value
  };
}
function updateMoldPreview(){
  const m = readMoldForm();
  const v = Math.round(moldVolume(m));
  document.getElementById('moldVolumePreview').textContent = v > 0 ? `估計容量：約 ${v} ml` : '';
}
function clearMoldForm(){
  document.getElementById('mold-name').value = '';
  document.getElementById('mold-shape').value = 'round';
  document.getElementById('mold-diameter').value = '';
  document.getElementById('mold-height-round').value = '';
  document.getElementById('mold-length').value = '';
  document.getElementById('mold-width').value = '';
  document.getElementById('mold-height-rect').value = '';
  document.getElementById('mold-manual-volume').value = '';
  shapeFieldsSwitch();
  editingMoldId = null;
  document.getElementById('moldFormLegend').textContent = '新增模具';
  document.getElementById('moldSaveBtn').textContent = '新增模具';
  document.getElementById('moldCancelEditBtn').style.display = 'none';
}
function editMold(id){
  const m = molds.find(x => x.id === id);
  if(!m) return;
  editingMoldId = id;
  document.getElementById('mold-name').value = m.name || '';
  document.getElementById('mold-shape').value = m.shape || 'round';
  document.getElementById('mold-diameter').value = m.diameter || '';
  document.getElementById('mold-height-round').value = m.heightRound || '';
  document.getElementById('mold-length').value = m.length || '';
  document.getElementById('mold-width').value = m.width || '';
  document.getElementById('mold-height-rect').value = m.heightRect || '';
  document.getElementById('mold-manual-volume').value = m.manualVolume || '';
  shapeFieldsSwitch();
  document.getElementById('moldFormLegend').textContent = '編輯模具';
  document.getElementById('moldSaveBtn').textContent = '儲存變更';
  document.getElementById('moldCancelEditBtn').style.display = 'inline-block';
}
async function saveMold(){
  const data = readMoldForm();
  if(!data.name){ statusLine.textContent = '請輸入模具名稱'; return; }
  if(editingMoldId){
    const idx = molds.findIndex(x => x.id === editingMoldId);
    if(idx > -1) molds[idx] = Object.assign({id: editingMoldId}, data);
  } else {
    molds.push(Object.assign({id: uid('mold')}, data));
  }
  const ok = await persistMolds();
  if(ok){
    renderMoldList(); renderMoldSelect(); clearMoldForm();
    statusLine.textContent = '模具已儲存';
    setTimeout(()=>{ if(statusLine.textContent==='模具已儲存') statusLine.textContent=''; }, 1500);
  } else {
    statusLine.textContent = '儲存失敗，請再試一次';
  }
}
async function deleteMold(id){
  if(!confirm('確定要刪除這個模具設定檔嗎？')) return;
  molds = molds.filter(x => x.id !== id);
  const ok = await persistMolds();
  if(ok){ renderMoldList(); renderMoldSelect(); }
}
function openMoldSettings(){ clearMoldForm(); renderMoldList(); moldOverlay.classList.add('open'); }
function closeMoldSettings(){ moldOverlay.classList.remove('open'); }

/* ---------- ratio ---------- */
function recomputeRatio(){
  const srcVol = Number(document.getElementById('in-srcVolume').value);
  const moldId = document.getElementById('in-att-containerSelect').value;
  const m = molds.find(x => x.id === moldId);
  if(srcVol > 0 && m){
    const myVol = moldVolume(m);
    if(myVol > 0) document.getElementById('in-att-scaleRatio').value = roundAmt(myVol / srcVol);
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
  const text = document.getElementById(textareaId).value;
  const items = parseMarkdownTable(text);
  const el = document.getElementById(previewId);
  if(items.length === 0){
    el.innerHTML = text.trim() ? '<p class="empty-note">目前內容還不是可辨識的表格格式，會以純文字儲存。</p>' : '<p class="empty-note">表格預覽會顯示在這裡。</p>';
    return;
  }
  let html = '<table><thead><tr><th>食材</th><th>份量</th><th>單位</th></tr></thead><tbody>';
  items.forEach(it => {
    html += `<tr><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.amount)}</td><td>${escapeHtml(it.unit)}</td></tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

/* ---------- AI conversion (direct browser call, needs user's own key) ---------- */
async function callClaudeConvert(rawText){
  const apiKey = getApiKey();
  if(!apiKey) throw new Error('NO_KEY');
  const systemPrompt = '你是烘焙食譜整理助手。使用者會貼上從影片或網頁複製的原始食譜文字，內容可能雜亂，也可能是英文、日文或其他語言。請將其中的食材與份量整理出來，並將輸出內容全部翻譯成繁體中文，不要保留原文語言（包含食材名稱、單位、容器敘述、溫度時間敘述都要翻成繁體中文）。只回傳 JSON，不要有任何其他文字、不要加 markdown code fence。JSON 格式為：{"items":[{"name":"食材名稱（繁體中文）","amount":數字或null,"unit":"單位，一律使用繁體中文，例如 克、毫升、小匙、大匙、杯、顆、包 等，若無則空字串"}],"sourceContainer":"文字中提到的容器敘述，翻成繁體中文，若無則null","sourceTime":"文字中提到的烘烤溫度與時間，翻成繁體中文敘述，若無則null"}。amount 請盡量轉成純數字，不要包含文字。';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: rawText }]
    })
  });
  if(!response.ok){
    if(response.status === 401) throw new Error('BAD_KEY');
    throw new Error('API_ERROR');
  }
  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if(!textBlock) throw new Error('沒有取得回應內容');
  const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
async function handleAiConvert(){
  const raw = document.getElementById('in-srcIngredients').value.trim();
  const hint = document.getElementById('aiStatusHint');
  const btn = document.getElementById('aiConvertBtn');
  if(!raw){
    hint.textContent = '請先貼上原始食譜文字';
    hint.className = 'field-hint warn';
    return;
  }
  if(!getApiKey()){
    hint.textContent = '請先在右上角「API 設定」輸入你的 Anthropic API key';
    hint.className = 'field-hint warn';
    openApiSettings();
    return;
  }
  btn.disabled = true;
  hint.className = 'field-hint';
  hint.textContent = 'AI 整理中…';
  try{
    const result = await callClaudeConvert(raw);
    const items = Array.isArray(result.items) ? result.items : [];
    if(items.length === 0) throw new Error('EMPTY');
    document.getElementById('in-srcIngredients').value = buildMarkdownTable(items);
    renderMdPreview('in-srcIngredients', 'srcPreview');
    if(result.sourceContainer && !document.getElementById('in-srcContainer').value.trim()){
      document.getElementById('in-srcContainer').value = result.sourceContainer;
    }
    if(result.sourceTime && !document.getElementById('in-srcTime').value.trim()){
      document.getElementById('in-srcTime').value = result.sourceTime;
    }
    hint.textContent = '已轉換成表格';
  }catch(e){
    hint.className = 'field-hint warn';
    if(e.message === 'BAD_KEY') hint.textContent = 'API key 無效或已過期，請到「API 設定」重新輸入';
    else if(e.message === 'EMPTY') hint.textContent = '沒有解析出食材，請確認貼上的內容';
    else hint.textContent = '轉換失敗，請確認網路連線或稍後再試';
  }finally{
    btn.disabled = false;
    setTimeout(()=>{ if(hint.textContent==='已轉換成表格') hint.textContent=''; }, 2500);
  }
}
function recalcScaledTable(){
  const items = parseMarkdownTable(document.getElementById('in-srcIngredients').value);
  if(items.length === 0){
    statusLine.textContent = '目前原始食材欄位還沒有可辨識的表格內容';
    setTimeout(()=>{ if(statusLine.textContent==='目前原始食材欄位還沒有可辨識的表格內容') statusLine.textContent=''; }, 2000);
    return;
  }
  const ratio = Number(document.getElementById('in-att-scaleRatio').value) || 1;
  const scaled = items.map(it => ({
    name: it.name,
    amount: typeof it.amount === 'number' ? roundAmt(it.amount * ratio) : it.amount,
    unit: it.unit
  }));
  document.getElementById('in-att-myIngredients').value = buildMarkdownTable(scaled);
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
  const area = document.getElementById('attPhotoArea');
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
  area.innerHTML = html;
  document.getElementById('attPhotoAddTile').addEventListener('click', ()=>{
    document.getElementById('in-att-photoFile').click();
  });
  area.querySelectorAll('.photo-thumb-remove').forEach(btn=>{
    btn.addEventListener('click', (ev)=>{
      ev.stopPropagation();
      const idx = Number(btn.dataset.idx);
      currentAttemptPhotos.splice(idx, 1);
      renderAttemptPhotoArea();
    });
  });
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
  const hay = [entry.title, entry.videoNote, entry.srcContainer, attemptText, (entry.tags||[]).join(' ')].join(' ').toLowerCase();
  return hay.includes(q);
}
function render(){
  const q = searchInput.value.trim();
  const filtered = entries.filter(e => matchesSearch(e, q)).sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  countLine.textContent = entries.length === 0 ? '' : `共 ${entries.length} 筆紀錄${q ? '，符合搜尋 ' + filtered.length + ' 筆' : ''}`;
  if(entries.length === 0){
    grid.innerHTML = `
      <div class="empty">
        <h2>還沒有任何紀錄</h2>
        <p>做完下一個蛋糕，把容器、時間和成果記下來，下次就不用再猜一次。</p>
        <button class="btn-add" onclick="openModal()">+ 新增第一筆紀錄</button>
      </div>`;
    return;
  }
  if(filtered.length === 0){
    grid.innerHTML = `<div class="empty"><h2>沒有符合的紀錄</h2><p>換個關鍵字再找找看。</p></div>`;
    return;
  }
  grid.innerHTML = filtered.map(e => {
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
      <div class="card ${outcomeClass}" onclick="openModal('${e.id}')">
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
  }).join('');
}

/* ---------- attempt sub-form (each bake attempt under an entry) ---------- */
function resetTimeSyncTracking(){
  const v = document.getElementById('in-att-myTime').value;
  lastAutoSyncedTime = v === '' ? '' : null;
}
function syncMyTimeFromSrc(){
  const myTimeEl = document.getElementById('in-att-myTime');
  if(myTimeEl.value === '' || myTimeEl.value === lastAutoSyncedTime){
    const val = document.getElementById('in-srcTime').value;
    myTimeEl.value = val;
    lastAutoSyncedTime = val;
  }
}
function updateAttemptOutcomePicker(){
  document.querySelectorAll('#attOutcomePicker .outcome-opt').forEach(el=>{
    el.className = 'outcome-opt' + (el.dataset.val === attemptPickedOutcome ? ' picked-' + attemptPickedOutcome : '');
  });
}
function clearAttemptForm(){
  ['att-date','att-scaleRatio','att-myTime','att-myIngredients','att-resultNotes','att-nextTime'].forEach(k=>{
    document.getElementById('in-'+k).value = '';
  });
  document.getElementById('in-att-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('in-att-containerSelect').value = '';
  attemptPickedOutcome = '';
  currentAttemptPhotos = [];
  editingAttemptId = null;
  resetTimeSyncTracking();
  renderAttemptPhotoArea();
  updateAttemptOutcomePicker();
  renderMdPreview('in-att-myIngredients', 'attPreview');
  document.getElementById('attemptFormTitle').textContent = '新增一次調整記錄';
  document.getElementById('saveAttemptBtn').textContent = '儲存這筆調整記錄';
}
function fillAttemptForm(a){
  document.getElementById('in-att-date').value = a.date || '';
  document.getElementById('in-att-containerSelect').value = a.myContainerId || '';
  document.getElementById('in-att-scaleRatio').value = a.scaleRatio == null ? '' : a.scaleRatio;
  document.getElementById('in-att-myTime').value = a.myTime || '';
  resetTimeSyncTracking();
  document.getElementById('in-att-myIngredients').value = a.myIngredients || '';
  document.getElementById('in-att-resultNotes').value = a.resultNotes || '';
  document.getElementById('in-att-nextTime').value = a.nextTime || '';
  attemptPickedOutcome = a.outcome || '';
  currentAttemptPhotos = (a.photos || []).slice();
  editingAttemptId = a.id;
  renderAttemptPhotoArea();
  updateAttemptOutcomePicker();
  renderMdPreview('in-att-myIngredients', 'attPreview');
  document.getElementById('attemptFormTitle').textContent = '編輯這筆調整記錄';
  document.getElementById('saveAttemptBtn').textContent = '儲存變更';
}
function showAttemptForm(){
  document.getElementById('attemptForm').style.display = '';
  document.getElementById('addAttemptBtn').style.display = 'none';
}
function hideAttemptForm(){
  document.getElementById('attemptForm').style.display = 'none';
  document.getElementById('addAttemptBtn').style.display = '';
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
  document.getElementById('attemptForm').scrollIntoView({behavior:'smooth', block:'nearest'});
}
async function saveAttempt(){
  const entry = entries.find(x => x.id === editingId);
  if(!entry) return;
  const moldId = document.getElementById('in-att-containerSelect').value;
  const moldObj = molds.find(x => x.id === moldId);
  const prev = editingAttemptId ? entry.attempts.find(x => x.id === editingAttemptId) : null;
  const data = {
    id: editingAttemptId || uid('att'),
    date: document.getElementById('in-att-date').value || new Date().toISOString().slice(0,10),
    myContainerId: moldId || '',
    myContainerLabel: moldObj ? moldObj.name : '',
    myVolume: moldObj ? Math.round(moldVolume(moldObj)) : null,
    scaleRatio: document.getElementById('in-att-scaleRatio').value ? Number(document.getElementById('in-att-scaleRatio').value) : null,
    myTime: document.getElementById('in-att-myTime').value.trim(),
    myIngredients: document.getElementById('in-att-myIngredients').value.trim(),
    resultNotes: document.getElementById('in-att-resultNotes').value.trim(),
    nextTime: document.getElementById('in-att-nextTime').value.trim(),
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
  statusLine.textContent = '儲存中…';
  const ok = await persistEntries();
  statusLine.textContent = ok ? '已儲存這筆調整記錄' : '儲存失敗，本機儲存空間可能已滿';
  if(ok){
    expandedAttemptIds = new Set([data.id]);
    hideAttemptForm();
    renderAttemptsList();
    render();
    setTimeout(()=>{ if(statusLine.textContent==='已儲存這筆調整記錄') statusLine.textContent=''; }, 1500);
  }
}
async function deleteAttempt(id){
  const entry = entries.find(x => x.id === editingId);
  if(!entry) return;
  if(!confirm('確定要刪除這筆調整記錄嗎？此動作無法復原。')) return;
  entry.attempts = entry.attempts.filter(x => x.id !== id);
  entry.updatedAt = Date.now();
  expandedAttemptIds.delete(id);
  statusLine.textContent = '刪除中…';
  const ok = await persistEntries();
  statusLine.textContent = ok ? '已刪除' : '刪除失敗，請再試一次';
  if(ok){
    renderAttemptsList();
    render();
    setTimeout(()=>{ if(statusLine.textContent==='已刪除') statusLine.textContent=''; }, 1500);
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
  const list = document.getElementById('attemptsList');
  if(!entry || !entry.attempts || entry.attempts.length === 0){
    list.innerHTML = '<p class="field-hint">還沒有調整記錄，做完之後點下方「新增一次調整記錄」記下來。</p>';
    return;
  }
  const ordered = entry.attempts.slice().reverse();
  list.innerHTML = ordered.map(a => {
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
  }).join('');
}

/* ---------- entry form (source-level info) ---------- */
function clearForm(){
  ['title','videoUrl','videoNote','srcContainer','srcVolume','srcTime','srcIngredients','tags'].forEach(k=>{
    document.getElementById('in-'+k).value = '';
  });
  document.getElementById('aiStatusHint').textContent = '';
  renderMdPreview('in-srcIngredients', 'srcPreview');
  document.getElementById('f-title').classList.remove('invalid');
  document.getElementById('exportBtn').style.display = 'none';
}
function fillForm(e){
  document.getElementById('in-title').value = e.title || '';
  document.getElementById('in-videoUrl').value = e.videoUrl || '';
  document.getElementById('in-videoNote').value = e.videoNote || '';
  document.getElementById('in-srcContainer').value = e.srcContainer || '';
  document.getElementById('in-srcVolume').value = e.srcVolume || '';
  document.getElementById('in-srcTime').value = e.srcTime || '';
  document.getElementById('in-srcIngredients').value = e.srcIngredients || '';
  document.getElementById('in-tags').value = (e.tags||[]).join(', ');
  document.getElementById('aiStatusHint').textContent = '';
  renderMdPreview('in-srcIngredients', 'srcPreview');
  document.getElementById('exportBtn').style.display = 'inline-block';
}
function openModal(id){
  editingId = id || null;
  const deleteBtn = document.getElementById('deleteBtn');
  hideAttemptForm();
  if(id){
    const e = entries.find(x => x.id === id);
    if(!e) return;
    document.getElementById('modalTitle').textContent = '編輯紀錄';
    fillForm(e);
    document.getElementById('attemptsFieldset').style.display = '';
    expandedAttemptIds = new Set();
    const latest = latestAttempt(e);
    if(latest) expandedAttemptIds.add(latest.id);
    renderMoldSelect();
    renderAttemptsList();
    deleteBtn.style.display = 'inline-block';
  } else {
    document.getElementById('modalTitle').textContent = '新增紀錄';
    clearForm();
    document.getElementById('attemptsFieldset').style.display = 'none';
    deleteBtn.style.display = 'none';
  }
  overlay.classList.add('open');
}
function closeModal(){ overlay.classList.remove('open'); hideAttemptForm(); editingId = null; }

async function saveEntry(){
  const titleField = document.getElementById('f-title');
  const title = document.getElementById('in-title').value.trim();
  if(!title){ titleField.classList.add('invalid'); return; }
  titleField.classList.remove('invalid');

  const tagsRaw = document.getElementById('in-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];
  const now = Date.now();
  const isNew = !editingId;

  const fields = {
    title,
    videoUrl: document.getElementById('in-videoUrl').value.trim(),
    videoNote: document.getElementById('in-videoNote').value.trim(),
    srcContainer: document.getElementById('in-srcContainer').value.trim(),
    srcVolume: document.getElementById('in-srcVolume').value ? Number(document.getElementById('in-srcVolume').value) : null,
    srcTime: document.getElementById('in-srcTime').value.trim(),
    srcIngredients: document.getElementById('in-srcIngredients').value.trim(),
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

  statusLine.textContent = '儲存中…';
  const ok = await persistEntries();
  statusLine.textContent = ok ? '已儲存' : '儲存失敗，本機儲存空間可能已滿';
  if(ok){
    render();
    if(isNew){
      document.getElementById('modalTitle').textContent = '編輯紀錄';
      document.getElementById('deleteBtn').style.display = 'inline-block';
      document.getElementById('exportBtn').style.display = 'inline-block';
      document.getElementById('attemptsFieldset').style.display = '';
      expandedAttemptIds = new Set();
      renderMoldSelect();
      renderAttemptsList();
      statusLine.textContent = '已儲存，可以在下方新增這次的調整記錄了';
    } else {
      closeModal();
    }
    setTimeout(()=>{ if(statusLine.textContent==='已儲存' || statusLine.textContent==='已儲存，可以在下方新增這次的調整記錄了') statusLine.textContent=''; }, 2200);
  }
}
async function deleteEntry(){
  if(!editingId) return;
  if(!confirm('確定要刪除這筆紀錄嗎？所有調整記錄也會一併刪除，此動作無法復原。')) return;
  entries = entries.filter(x => x.id !== editingId);
  statusLine.textContent = '刪除中…';
  const ok = await persistEntries();
  statusLine.textContent = ok ? '已刪除' : '刪除失敗，請再試一次';
  if(ok){
    closeModal(); render();
    setTimeout(()=>{ if(statusLine.textContent==='已刪除') statusLine.textContent=''; }, 1500);
  }
}

/* ---------- export / import single entry ---------- */
function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  ev.target.value = '';
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try{
      const data = JSON.parse(reader.result);
      if(!data || typeof data !== 'object' || Array.isArray(data)){
        throw new Error('格式不正確');
      }
      if(!data.title){
        statusLine.textContent = '這個檔案看起來不是有效的紀錄（缺少名稱）';
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
      statusLine.textContent = '匯入中…';
      const ok = await persistEntries();
      if(ok){
        render();
        openModal(imported.id);
        statusLine.textContent = imported.attempts.length ? '已匯入，模具容器需重新選擇' : '已匯入';
        setTimeout(()=>{ statusLine.textContent=''; }, 3000);
      } else {
        statusLine.textContent = '匯入失敗，本機儲存空間可能已滿';
      }
    }catch(e){
      statusLine.textContent = '匯入失敗，請確認是先前匯出的 JSON 檔案';
      setTimeout(()=>{ if(statusLine.textContent==='匯入失敗，請確認是先前匯出的 JSON 檔案') statusLine.textContent=''; }, 2500);
    }
  };
  reader.onerror = () => { statusLine.textContent = '讀取檔案失敗'; };
  reader.readAsText(file);
}

/* ---------- events ---------- */
document.getElementById('addBtn').addEventListener('click', ()=>openModal());
document.getElementById('closeBtn').addEventListener('click', closeModal);
document.getElementById('saveBtn').addEventListener('click', saveEntry);
document.getElementById('deleteBtn').addEventListener('click', deleteEntry);
document.getElementById('exportBtn').addEventListener('click', exportCurrentEntry);
overlay.addEventListener('click', (ev)=>{ if(ev.target === overlay) closeModal(); });
searchInput.addEventListener('input', render);

document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', handleImportFile);

document.getElementById('addAttemptBtn').addEventListener('click', ()=>openAttemptForm(null));
document.getElementById('cancelAttemptBtn').addEventListener('click', hideAttemptForm);
document.getElementById('saveAttemptBtn').addEventListener('click', saveAttempt);
document.getElementById('attOutcomePicker').addEventListener('click', (ev)=>{
  const opt = ev.target.closest('.outcome-opt');
  if(!opt) return;
  attemptPickedOutcome = opt.dataset.val;
  updateAttemptOutcomePicker();
});
document.getElementById('attemptsList').addEventListener('click', (ev)=>{
  const row = ev.target.closest('.attempt-row');
  if(!row) return;
  const attId = row.dataset.id;
  if(ev.target.closest('[data-action="edit"]')){ openAttemptForm(attId); return; }
  if(ev.target.closest('[data-action="delete"]')){ deleteAttempt(attId); return; }
  if(ev.target.closest('.attempt-row-head')){
    if(expandedAttemptIds.has(attId)) expandedAttemptIds.delete(attId);
    else expandedAttemptIds.add(attId);
    renderAttemptsList();
  }
});

document.getElementById('in-att-photoFile').addEventListener('change', async (ev)=>{
  const files = Array.from(ev.target.files || []);
  ev.target.value = '';
  if(files.length === 0) return;
  statusLine.textContent = '處理照片中…';
  for(const file of files){
    try{
      const compressed = await compressImage(file);
      currentAttemptPhotos.push(compressed);
    }catch(err){
      statusLine.textContent = '有一張照片處理失敗，已略過';
    }
  }
  renderAttemptPhotoArea();
  if(statusLine.textContent === '處理照片中…') statusLine.textContent = '';
});

document.getElementById('in-att-containerSelect').addEventListener('change', recomputeRatio);
document.getElementById('in-srcVolume').addEventListener('input', recomputeRatio);
document.getElementById('in-srcTime').addEventListener('input', syncMyTimeFromSrc);
document.getElementById('aiConvertBtn').addEventListener('click', handleAiConvert);
document.getElementById('attRecalcBtn').addEventListener('click', recalcScaledTable);
document.getElementById('in-srcIngredients').addEventListener('input', ()=>renderMdPreview('in-srcIngredients','srcPreview'));
document.getElementById('in-att-myIngredients').addEventListener('input', ()=>renderMdPreview('in-att-myIngredients','attPreview'));

document.getElementById('moldSettingsBtn').addEventListener('click', openMoldSettings);
document.getElementById('manageMoldFromAttempt').addEventListener('click', openMoldSettings);
document.getElementById('moldCloseBtn').addEventListener('click', closeMoldSettings);
moldOverlay.addEventListener('click', (ev)=>{ if(ev.target === moldOverlay) closeMoldSettings(); });
document.getElementById('mold-shape').addEventListener('change', shapeFieldsSwitch);
['mold-diameter','mold-height-round','mold-length','mold-width','mold-height-rect','mold-manual-volume'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateMoldPreview);
});
document.getElementById('moldSaveBtn').addEventListener('click', saveMold);
document.getElementById('moldCancelEditBtn').addEventListener('click', clearMoldForm);

document.getElementById('apiSettingsBtn').addEventListener('click', openApiSettings);
document.getElementById('apiCloseBtn').addEventListener('click', closeApiSettings);
apiOverlay.addEventListener('click', (ev)=>{ if(ev.target === apiOverlay) closeApiSettings(); });
document.getElementById('saveKeyBtn').addEventListener('click', saveApiKey);
document.getElementById('clearKeyBtn').addEventListener('click', clearApiKey);
document.getElementById('toggleKeyVisBtn').addEventListener('click', ()=>{
  const inp = document.getElementById('in-apiKey');
  const btn = document.getElementById('toggleKeyVisBtn');
  if(inp.type === 'password'){ inp.type = 'text'; btn.textContent = '隱藏'; }
  else { inp.type = 'password'; btn.textContent = '顯示'; }
});

loadAll();
