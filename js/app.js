// ═══════════════════════════════════════════
//  CutSilence — Pure Browser Silence Cutter
//  No server. No API. No cost.
// ═══════════════════════════════════════════

const $ = id => document.getElementById(id);

// ── State ──
let videoFile = null;
let videoBlob = null;
let audioBuffer = null;
let silenceSegments = []; // segments to CUT
let selectedSegments = new Set();
let videoDuration = 0;

// ── DOM refs ──
const dropZone = $('dropZone');
const fileInput = $('fileInput');
const previewVideo = $('previewVideo');
const waveformCanvas = $('waveformCanvas');
const segmentsList = $('segmentsList');
const exportBtn = $('exportBtn');
const analyzeBtn = $('analyzeBtn');

// ── Step navigation ──
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Toast ──
function toast(msg, duration = 3000) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Format time ──
function fmt(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

// ── File Drop / Select ──
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) loadFile(file);
  else toast('❌ רק קבצי וידאו נתמכים');
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});

function loadFile(file) {
  videoFile = file;
  videoBlob = URL.createObjectURL(file);
  previewVideo.src = videoBlob;
  previewVideo.onloadedmetadata = () => {
    videoDuration = previewVideo.duration;
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    $('videoInfo').innerHTML = `
      <span>📁 ${file.name}</span>
      <span>⏱ <span>${fmt(videoDuration)}</span></span>
      <span>💾 <span>${sizeMB} MB</span></span>
      <span>📐 <span>${previewVideo.videoWidth}×${previewVideo.videoHeight}</span></span>
    `;
    showStep('step-settings');
  };
}

// ── Settings sliders ──
$('silenceThreshold').addEventListener('input', function() {
  $('thresholdVal').textContent = this.value + ' dB';
});
$('minSilence').addEventListener('input', function() {
  $('minSilenceVal').textContent = parseFloat(this.value).toFixed(1) + " שנ'";
});
$('padding').addEventListener('input', function() {
  $('paddingVal').textContent = parseFloat(this.value).toFixed(2) + " שנ'";
});

// ── Analyze ──
analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = '⏳ מנתח...';

  try {
    await analyzeAudio();
    renderWaveform();
    renderSegments();
    showStep('step-results');
  } catch (err) {
    console.error(err);
    toast('❌ שגיאה בניתוח: ' + err.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> נתח שקט';
  }
});

async function analyzeAudio() {
  const silenceDb = parseFloat($('silenceThreshold').value);
  const minSilenceSec = parseFloat($('minSilence').value);
  const padding = parseFloat($('padding').value);

  // Show progress
  showStep('step-results');
  $('progressWrap').style.display = 'block';
  $('progressLabel').textContent = 'טוען אודיו...';
  $('progressFill').style.width = '5%';

  // Decode audio from video file
  const arrayBuffer = await videoFile.arrayBuffer();
  $('progressLabel').textContent = 'מפענח אודיו...';
  $('progressFill').style.width = '20%';

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    // Some formats need different approach
    throw new Error('לא ניתן לפענח אודיו. נסה MP4 או MOV.');
  }

  $('progressLabel').textContent = 'מנתח עוצמות...';
  $('progressFill').style.width = '50%';

  // Mix down all channels to mono
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = audioBuffer.length;
  const mono = new Float32Array(totalSamples);

  for (let c = 0; c < numChannels; c++) {
    const channelData = audioBuffer.getChannelData(c);
    for (let i = 0; i < totalSamples; i++) {
      mono[i] += channelData[i] / numChannels;
    }
  }

  $('progressFill').style.width = '70%';
  $('progressLabel').textContent = 'מזהה שקט...';

  // Analyze in chunks (window size ~10ms)
  const windowSize = Math.round(sampleRate * 0.01);
  const silenceThresholdLinear = Math.pow(10, silenceDb / 20);
  const silentWindows = [];

  for (let i = 0; i < totalSamples; i += windowSize) {
    const end = Math.min(i + windowSize, totalSamples);
    let rms = 0;
    for (let j = i; j < end; j++) rms += mono[j] * mono[j];
    rms = Math.sqrt(rms / (end - i));
    silentWindows.push(rms < silenceThresholdLinear);
  }

  $('progressFill').style.width = '85%';

  // Convert windows to time segments
  const windowDuration = windowSize / sampleRate;
  const rawSilences = [];
  let silenceStart = null;

  for (let i = 0; i < silentWindows.length; i++) {
    const t = i * windowDuration;
    if (silentWindows[i]) {
      if (silenceStart === null) silenceStart = t;
    } else {
      if (silenceStart !== null) {
        rawSilences.push({ start: silenceStart, end: t });
        silenceStart = null;
      }
    }
  }
  if (silenceStart !== null) {
    rawSilences.push({ start: silenceStart, end: videoDuration });
  }

  // Filter by minimum duration and apply padding
  silenceSegments = rawSilences
    .filter(s => (s.end - s.start) >= minSilenceSec)
    .map(s => ({
      start: Math.max(0, s.start + padding),
      end: Math.min(videoDuration, s.end - padding),
      originalDuration: s.end - s.start
    }))
    .filter(s => s.end > s.start);

  $('progressFill').style.width = '100%';
  $('progressLabel').textContent = `נמצאו ${silenceSegments.length} רגעים שקטים`;

  await audioCtx.close();

  // Update stats
  const totalSilence = silenceSegments.reduce((a, s) => a + (s.end - s.start), 0);
  const saved = (totalSilence / videoDuration * 100).toFixed(1);
  $('resultsStats').innerHTML = `
    <div class="stat"><span class="stat-val">${silenceSegments.length}</span><span class="stat-label">רגעים שקטים</span></div>
    <div class="stat"><span class="stat-val">${fmt(totalSilence)}</span><span class="stat-label">זמן שקט</span></div>
    <div class="stat"><span class="stat-val">${saved}%</span><span class="stat-label">חיסכון פוטנציאלי</span></div>
  `;

  setTimeout(() => { $('progressWrap').style.display = 'none'; }, 800);
}

// ── Waveform ──
function renderWaveform() {
  if (!audioBuffer) return;

  const canvas = waveformCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = 100 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '100px';
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = 100;
  const mid = H / 2;

  ctx.clearRect(0, 0, W, H);

  // Draw waveform
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const amp = mid * 0.9;

  ctx.beginPath();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;

  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    for (let s = x * step; s < (x + 1) * step && s < data.length; s++) {
      if (data[s] < min) min = data[s];
      if (data[s] > max) max = data[s];
    }
    ctx.moveTo(x, mid + min * amp);
    ctx.lineTo(x, mid + max * amp);
  }
  ctx.stroke();

  // Highlight silence regions
  silenceSegments.forEach((seg, i) => {
    const x1 = (seg.start / videoDuration) * W;
    const x2 = (seg.end / videoDuration) * W;
    const isSelected = selectedSegments.has(i);

    ctx.fillStyle = isSelected
      ? 'rgba(255,77,77,0.35)'
      : 'rgba(255,77,77,0.12)';
    ctx.fillRect(x1, 0, x2 - x1, H);

    if (isSelected) {
      ctx.strokeStyle = 'rgba(255,77,77,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 0, x2 - x1, H);
    }
  });
}

// ── Segment List ──
function renderSegments() {
  if (silenceSegments.length === 0) {
    segmentsList.innerHTML = '<div class="empty-state">🎉 לא נמצאו רגעים שקטים בהגדרות אלו<br>נסה להוריד את סף השקט</div>';
    exportBtn.disabled = true;
    return;
  }

  segmentsList.innerHTML = '';
  const maxDur = Math.max(...silenceSegments.map(s => s.end - s.start));

  silenceSegments.forEach((seg, i) => {
    const dur = seg.end - seg.start;
    const pct = (dur / maxDur * 100).toFixed(0);
    const isSelected = selectedSegments.has(i);

    const item = document.createElement('div');
    item.className = 'segment-item' + (isSelected ? ' selected' : '');
    item.innerHTML = `
      <div class="segment-check">${isSelected ? '✓' : ''}</div>
      <div class="segment-times">
        רגע ${i + 1} — <span class="time-range">${fmt(seg.start)} → ${fmt(seg.end)}</span>
      </div>
      <div class="segment-duration">−${dur.toFixed(2)}שנ'</div>
      <div class="segment-bar"><div class="segment-bar-fill" style="width:${pct}%"></div></div>
    `;

    item.addEventListener('click', () => toggleSegment(i));
    segmentsList.appendChild(item);
  });

  updateExportBtn();
}

function toggleSegment(i) {
  if (selectedSegments.has(i)) selectedSegments.delete(i);
  else selectedSegments.add(i);
  renderSegments();
  renderWaveform();
  updateExportBtn();
}

function updateExportBtn() {
  exportBtn.disabled = selectedSegments.size === 0;
  if (selectedSegments.size > 0) {
    const totalCut = [...selectedSegments].reduce((a, i) => a + (silenceSegments[i].end - silenceSegments[i].start), 0);
    exportBtn.innerHTML = `<span class="btn-icon">⬇️</span> ייצא MP4 (חיסכון ${totalCut.toFixed(1)}שנ')`;
  } else {
    exportBtn.innerHTML = '<span class="btn-icon">⬇️</span> ייצא MP4';
  }
}

$('backToSettingsBtn').addEventListener('click', () => showStep('step-settings'));

$('selectAllBtn').addEventListener('click', () => {
  silenceSegments.forEach((_, i) => selectedSegments.add(i));
  renderSegments();
  renderWaveform();
});

$('deselectAllBtn').addEventListener('click', () => {
  selectedSegments.clear();
  renderSegments();
  renderWaveform();
  updateExportBtn();
});

// ══════════════════════════════════════
//  EXPORT — FFmpeg.wasm → תמיד MP4 אמיתי
// ══════════════════════════════════════

// FFmpeg.wasm נטען מ-CDN רק כשצריך
let ffmpegInstance = null;

async function loadFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;

  $('exportNote').textContent = 'טוען FFmpeg (פעם ראשונה בלבד)...';

  // גרסה single-thread — לא צריכה SharedArrayBuffer בכלל
  const { createFFmpeg, fetchFile } = await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
    script.onload = () => resolve({ createFFmpeg: window.createFFmpeg, fetchFile: window.fetchFile });
    script.onerror = reject;
    document.head.appendChild(script);
  });

  const ff = createFFmpeg({
    log: true,
    logger: ({ message }) => {
      const timeMatch = message.match(/time=(\d+):(\d+):([\d.]+)/);
      if (timeMatch) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        window._ffmpegTime = secs;
      }
    },
    // single-thread core — לא משתמש ב-SharedArrayBuffer
    corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js',
  });

  await ff.load();

  ff.exec = (args) => ff.run(...args);

  ffmpegInstance = { ff, fetchFile };
  return ffmpegInstance;
}

exportBtn.addEventListener('click', startExport);

async function startExport() {
  const segsToRemove = [...selectedSegments]
    .map(i => silenceSegments[i])
    .sort((a, b) => a.start - b.start);

  const keepSegments = buildKeepSegments(segsToRemove);

  if (keepSegments.length === 0) {
    toast('❌ לא נשאר תוכן לאחר החיתוכים');
    return;
  }

  showStep('step-export');
  $('exportFill').style.width = '0%';
  $('exportPct').textContent = '0%';
  $('exportNote').textContent = 'מכין ייצוא...';

  try {
    await exportWithFFmpeg(keepSegments);
  } catch (err) {
    console.error(err);
    toast('❌ שגיאה בייצוא: ' + err.message);
    showStep('step-results');
  }
}

function buildKeepSegments(silences) {
  const keep = [];
  let pos = 0;

  for (const seg of silences) {
    if (seg.start > pos + 0.01) {
      keep.push({ start: pos, end: seg.start });
    }
    pos = seg.end;
  }

  if (pos < videoDuration - 0.01) {
    keep.push({ start: pos, end: videoDuration });
  }

  return keep;
}

async function exportWithFFmpeg(keepSegments) {
  // Load FFmpeg
  const { ff, fetchFile } = await loadFFmpeg();

  $('exportNote').textContent = 'מעלה קובץ לעיבוד...';
  $('exportFill').style.width = '10%';
  $('exportPct').textContent = '10%';

  // Write input file to FFmpeg virtual FS
  await ff.writeFile('input.mp4', await fetchFile(videoFile));

  $('exportFill').style.width = '20%';
  $('exportNote').textContent = 'בונה פילטר חיתוך...';

  // ── Build FFmpeg filter_complex for cutting ──
  // Strategy: use select+aselect filters to include only keep segments
  const vw = previewVideo.videoWidth;
  const vh = previewVideo.videoHeight;
  const targetH = Math.max(720, vh);
  const targetW = Math.round(vw * (targetH / vh));
  // ensure even dimensions (required by h264)
  const outW = targetW % 2 === 0 ? targetW : targetW + 1;
  const outH = targetH % 2 === 0 ? targetH : targetH + 1;

  // Build select expression: keep segments as time ranges
  const selectParts = keepSegments.map(s =>
    `between(t,${s.start.toFixed(4)},${s.end.toFixed(4)})`
  );
  const selectExpr = selectParts.join('+');

  // Total output duration for progress tracking
  const totalOutDuration = keepSegments.reduce((a, s) => a + (s.end - s.start), 0);
  window._ffmpegTime = 0;

  // Progress polling
  const progressInterval = setInterval(() => {
    const t = window._ffmpegTime || 0;
    const pct = Math.min(95, 20 + Math.round((t / totalOutDuration) * 75));
    $('exportFill').style.width = pct + '%';
    $('exportPct').textContent = pct + '%';
    $('exportNote').textContent = `מעבד... ${fmt(t)} / ${fmt(totalOutDuration)}`;
  }, 300);

  try {
    await ff.exec([
      '-i', 'input.mp4',
      '-vf', `select='${selectExpr}',setpts=N/FRAME_RATE/TB,scale=${outW}:${outH}`,
      '-af', `aselect='${selectExpr}',asetpts=N/SR/TB`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',           // quality: 18=best, 28=worst, 22=good balance
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y',
      'output.mp4'
    ]);
  } finally {
    clearInterval(progressInterval);
  }

  $('exportFill').style.width = '97%';
  $('exportNote').textContent = 'קורא קובץ פלט...';

  // Read output
  const data = await ff.readFile('output.mp4');

  // Cleanup FFmpeg FS
  await ff.deleteFile('input.mp4').catch(() => {});
  await ff.deleteFile('output.mp4').catch(() => {});

  $('exportFill').style.width = '100%';
  $('exportPct').textContent = '100%';
  $('exportNote').textContent = 'מוריד...';

  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `cutsilence_${Date.now()}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 60000);

  toast(`✅ MP4 הורד! (${(blob.size / 1024 / 1024).toFixed(1)} MB · ${outW}×${outH})`, 5000);
  setTimeout(() => showStep('step-results'), 1500);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Redraw waveform on resize ──
window.addEventListener('resize', () => {
  if (audioBuffer) renderWaveform();
});
