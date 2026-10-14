/* =========================================================
 *  SIPELLO GURU - Portal Mandiri & Absensi Wajah
 * ========================================================= */

/* ---------- KONFIGURASI (SAMAKAN DENGAN index.html ADMIN) ---------- */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxSZQnW8sDQnRmxVnn-xerpUXEWeCYMPpA5k6TytaUAwKL4ixn51AnrE8EozOH6g9Gk/exec';
const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
const FACE_RADIUS_DEFAULT = 40; // meter, harus sama dengan FACE_RADIUS_METERS_DEFAULT di Code.gs

/* ---------- STATE GLOBAL ---------- */
let GURU_TOKEN = localStorage.getItem('sipello_guru_token') || null;
let GURU_PROFILE = null;
let modelsLoaded = false;
let regStream = null, updStream = null, absenStream = null;
let regDescriptor = null, regFotoBase64 = null, regProfilePhoto = null, regThumb = '';
let absenWatchId = null;
let currentLat = null, currentLng = null;
let activeKegiatanCache = null;
let absenLocked = true;

/* ---------- API HELPER ---------- */
function callAPI(action, params) {
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, params: params || [] })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.status === 'ERROR') throw new Error(res.message);
      return res.data;
    });
}

/* =========================================================
 *  INIT
 * ========================================================= */
window.addEventListener('DOMContentLoaded', function () {
  const wantRegister = (location.hash || '').toLowerCase() === '#daftar';
  const showAuth = function (screen) {
    document.getElementById('authView').classList.remove('d-none');
    showAuthScreen(screen || 'login');
  };
  if (wantRegister) { showAuth('register'); return; }
  if (!GURU_TOKEN) { location.replace('index.html'); return; }
  callAPI('getGuruProfile', [GURU_TOKEN]).then(function (res) {
    if (res.success) { GURU_PROFILE = res.profile; enterApp(); }
    else { localStorage.removeItem('sipello_guru_token'); GURU_TOKEN = null; location.replace('index.html'); }
  }).catch(function () { showAuth('login'); showAuthError('Tidak dapat terhubung ke server. Periksa koneksi lalu muat ulang.'); });
});

/* =========================================================
 *  AUTH: LOGIN / DAFTAR
 * ========================================================= */
function showAuthScreen(screen) {
  document.getElementById('authError').style.display = 'none';
  document.getElementById('loginForm').classList.add('d-none');
  document.getElementById('registerFormStep1').classList.add('d-none');
  document.getElementById('registerFormStep2').classList.add('d-none');
  stopStream(regStream); regStream = null;

  if (screen === 'login') document.getElementById('loginForm').classList.remove('d-none');
  if (screen === 'register') document.getElementById('registerFormStep1').classList.remove('d-none');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.innerText = msg; el.style.display = 'block';
}

function handleGuruLogin() {
  const hp = document.getElementById('loginHp').value.trim().toLowerCase();
  const pw = document.getElementById('loginPw').value;
  if (!hp || !pw) { showAuthError('Username dan password wajib diisi.'); return; }

  const btn = document.getElementById('btnLogin');
  btn.innerText = 'Memproses...'; btn.disabled = true;

  callAPI('loginGuru', [hp, pw]).then(function (res) {
    btn.innerText = 'Masuk'; btn.disabled = false;
    if (!res.success) { showAuthError(res.message); return; }
    GURU_TOKEN = res.token;
    localStorage.setItem('sipello_guru_token', GURU_TOKEN);
    callAPI('getGuruProfile', [GURU_TOKEN]).then(function (p) {
      GURU_PROFILE = p.profile;
      enterApp();
    });
  }).catch(function (err) {
    btn.innerText = 'Masuk'; btn.disabled = false;
    showAuthError('Gagal terhubung ke server: ' + err.message);
  });
}

/* ---------- PENDAFTARAN: STEP 2 - REKAM WAJAH ---------- */
function goToFaceCapture() {
  const nama = document.getElementById('regNama').value.trim();
  const hp = hpToFull(document.getElementById('regHp').value);
  const pw = document.getElementById('regPw').value;
  const pw2 = document.getElementById('regPw2').value;

  const uname = document.getElementById('regUsername').value.trim().toLowerCase();
  if (!nama || !uname || !hp || !pw) { showAuthError('Nama, Username, Nomor HP, dan Password wajib diisi.'); return; }
  if (!/^[a-z0-9._]{4,20}$/.test(uname)) { showAuthError('Username 4-20 karakter: huruf kecil, angka, titik atau garis bawah (tanpa spasi).'); return; }
  if (pw.length < 6) { showAuthError('Password minimal 6 karakter.'); return; }
  if (pw !== pw2) { showAuthError('Konfirmasi password tidak cocok.'); return; }

  document.getElementById('authError').style.display = 'none';
  document.getElementById('registerFormStep1').classList.add('d-none');
  document.getElementById('registerFormStep2').classList.remove('d-none');

  startFaceModelsAndCamera('regVideo', 'regFaceStatus', 'btnCaptureFace').then(function (stream) {
    regStream = stream;
  });
}

function captureRegisterFace() {
  const video = document.getElementById('regVideo');
  detectFaceDescriptor(video).then(function (descriptor) {
    if (!descriptor) {
      document.getElementById('regFaceStatus').innerText = 'Wajah tidak terdeteksi. Pastikan wajah terlihat jelas, coba lagi.';
      document.getElementById('regFaceStatus').style.color = '#dc2626';
      return;
    }
    regDescriptor = descriptor;
    regFotoBase64 = captureSnapshotBase64(video);
    document.getElementById('regFaceStatus').innerText = '✓ Wajah berhasil terekam! Klik "Daftar Sekarang" untuk melanjutkan.';
    document.getElementById('regFaceStatus').style.color = '#16a34a';
    document.getElementById('btnCaptureFace').classList.add('d-none');
    document.getElementById('btnSubmitRegister').classList.remove('d-none');
  });
}

function submitRegister() {
  if (!regDescriptor) { showAuthError('Rekam wajah terlebih dahulu.'); return; }
  const data = {
    Nama: document.getElementById('regNama').value.trim(),
    Username: document.getElementById('regUsername').value.trim().toLowerCase(),
    JenisKelamin: document.getElementById('regJK').value,
    NomorHP: hpToFull(document.getElementById('regHp').value),
    Password: document.getElementById('regPw').value,
    Sekolah: document.getElementById('regSekolah').value.trim(),
    AlamatSekolah: document.getElementById('regAlamatSekolah').value.trim(),
    KepsekNama: document.getElementById('regKepsekNama').value.trim(),
    KepsekHP: hpToFull(document.getElementById('regKepsekHp').value),
    FaceDescriptor: regDescriptor,
    FotoBase64: (regProfilePhoto || regFotoBase64) ? (regProfilePhoto || regFotoBase64).split(',')[1] : '',
    FotoMime: 'image/jpeg',
    FotoThumb: regProfilePhoto ? regThumb : ''
  };

  const btn = document.getElementById('btnSubmitRegister');
  btn.innerText = 'Mendaftarkan...'; btn.disabled = true;

  callAPI('registerGuru', [data]).then(function (res) {
    btn.innerText = 'Daftar Sekarang'; btn.disabled = false;
    if (!res.success) { showAuthError(res.message); return; }
    stopStream(regStream); regStream = null;
    document.getElementById('registerFormStep2').classList.add('d-none');
    document.getElementById('loginForm').classList.remove('d-none');
    document.getElementById('loginHp').value = data.Username;
    const okBox = document.getElementById('authSuccess');
    okBox.innerText = 'Pendaftaran berhasil! Silakan login dengan Username & Password Anda.';
    okBox.classList.remove('d-none');
  }).catch(function (err) {
    btn.innerText = 'Daftar Sekarang'; btn.disabled = false;
    showAuthError('Gagal mendaftar: ' + err.message);
  });
}

/* =========================================================
 *  FACE-API.JS HELPERS
 * ========================================================= */
function loadFaceModels() {
  if (modelsLoaded) return Promise.resolve();
  return Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL)
  ]).then(function () { modelsLoaded = true; });
}

function startFaceModelsAndCamera(videoId, statusId, btnId) {
  const statusEl = document.getElementById(statusId);
  statusEl.innerText = 'Memuat model deteksi wajah...';
  statusEl.style.color = '#6b7280';

  return loadFaceModels().then(function () {
    statusEl.innerText = 'Mengaktifkan kamera...';
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  }).then(function (stream) {
    document.getElementById(videoId).srcObject = stream;
    statusEl.innerText = 'Posisikan wajah Anda di tengah kamera, lalu klik "Ambil Foto".';
    statusEl.style.color = '#166534';
    if (btnId) document.getElementById(btnId).disabled = false;
    return stream;
  }).catch(function (err) {
    statusEl.innerText = 'Gagal mengaktifkan kamera/model: ' + err.message;
    statusEl.style.color = '#dc2626';
    return null;
  });
}

function detectFaceDescriptor(videoEl) {
  return faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks().withFaceDescriptor()
    .then(function (detection) { return detection ? Array.from(detection.descriptor) : null; });
}

function captureSnapshotBase64(videoEl) {
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth || 320;
  canvas.height = videoEl.videoHeight || 240;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
}

/* =========================================================
 *  APP SHELL / NAVIGASI
 * ========================================================= */
function enterApp() {
  document.getElementById('authView').classList.add('d-none');
  document.getElementById('guruApp').classList.remove('d-none');
  document.getElementById('topbarNama').innerText = GURU_PROFILE.Nama || '-';
  document.getElementById('topbarSekolah').innerText = GURU_PROFILE.Sekolah || '-';
  document.getElementById('topbarFoto').src = fotoOrAvatar(GURU_PROFILE.FotoURL, GURU_PROFILE.Nama);
  goToGuruPage('Beranda');
}

function fotoOrAvatar(foto, nama) {
  return foto || ('https://ui-avatars.com/api/?background=166534&color=fff&name=' + encodeURIComponent(nama || '?'));
}

function goToGuruPage(pageName) {
  // Matikan kamera halaman lain saat pindah
  if (pageName !== 'Absensi') { stopAutoScan(); stopStream(absenStream); absenStream = null; if (absenWatchId) { navigator.geolocation.clearWatch(absenWatchId); absenWatchId = null; } }
  if (pageName !== 'UpdateWajah') { stopStream(updStream); updStream = null; }

  document.querySelectorAll('.guru-page').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById('gpage-' + pageName).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); });
  const navEl = document.querySelector('.nav-item[data-gpage="' + pageName + '"]');
  if (navEl) navEl.classList.add('active');

  if (pageName === 'Beranda') loadBeranda();
  if (pageName === 'Profil') loadProfil();
  if (pageName === 'Absensi') startAbsensiPage();
  if (pageName === 'UpdateWajah') startUpdateWajahPage();
}

/* =========================================================
 *  BERANDA
 * ========================================================= */
function renderBerandaKegiatan(k) {
  const el = document.getElementById('berandaKegBody'); if (!el) return;
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
  if (!k) { el.innerHTML = '<div class="d-flex align-items-center gap-2"><span class="badge-off">TIDAK ADA KEGIATAN</span></div><div class="mt-2">Belum ada kegiatan MGMP yang aktif saat ini.</div>'; return; }
  let h = '<div class="d-flex justify-content-between align-items-start gap-2 mb-1"><div class="keg-name">' + esc(k.Nama) + '</div><span class="badge-live">● AKTIF</span></div>';
  if (k.Tema) h += '<div class="keg-row"><i class="bi bi-bookmark-star-fill"></i><div>' + esc(k.Tema) + '</div></div>';
  if (k.Tanggal) h += '<div class="keg-row"><i class="bi bi-calendar-event-fill"></i><div>' + esc(formatTanggalLengkap(k.Tanggal)) + '</div></div>';
  const w = k.Waktu || (k.JamMulai ? k.JamMulai + (k.JamSelesai ? ' - ' + k.JamSelesai : '') : '');
  if (w) h += '<div class="keg-row"><i class="bi bi-clock-fill"></i><div>' + esc(w) + '</div></div>';
  if (k.Lokasi) h += '<div class="keg-row"><i class="bi bi-geo-alt-fill"></i><div>' + esc(k.Lokasi) + '</div></div>';
  if (k.Latitude && k.Longitude) h += '<a class="btn-sp-outline d-flex align-items-center justify-content-center gap-2 text-decoration-none mt-2" target="_blank" href="https://www.google.com/maps?q=' + encodeURIComponent(k.Latitude + ',' + k.Longitude) + '"><i class="bi bi-map-fill"></i> Buka Peta Lokasi</a>';
  el.innerHTML = h;
}

function renderSapaan() {
  const hr = new Date().getHours();
  const s = hr < 11 ? 'Selamat pagi' : hr < 15 ? 'Selamat siang' : hr < 18 ? 'Selamat sore' : 'Selamat malam';
  const a = document.getElementById('berandaSalam'); if (a) a.innerText = s + ' 👋';
  const n = document.getElementById('berandaNama'); if (n) n.innerText = (GURU_PROFILE && GURU_PROFILE.Nama) || document.getElementById('topbarNama').innerText;
  const t = document.getElementById('berandaTanggal');
  if (t) t.innerText = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function parseTanggal(v) {
  if (!v) return null;
  const s = String(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function formatTanggalLengkap(v) {
  const d = parseTanggal(v);
  if (!d) return v ? String(v) : '-';
  return HARI_ID[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN_ID[d.getMonth()] + ' ' + d.getFullYear();
}
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function loadBeranda() {
  renderSapaan();
  callAPI('getGuruAttendanceHistory', [GURU_TOKEN, 200]).then(function (res) {
    const all = res.riwayat || [];
    document.getElementById('berandaTotalHadir').innerText = all.length;
    const el = document.getElementById('berandaRiwayatList');
    if (!all.length) { el.innerHTML = '<div class="text-muted" style="font-size:12.5px;">Belum ada riwayat kehadiran.</div>'; return; }
    el.innerHTML = all.slice(0, 10).map(function (r) {
      return '<div class="rw-item"><div class="rw-ico"><i class="bi bi-calendar2-check-fill"></i></div>' +
        '<div class="rw-body"><div class="rw-title">' + escHtml(r.NamaKegiatan || 'Kegiatan MGMP') + '</div>' +
        '<div class="rw-meta"><span><i class="bi bi-calendar-event"></i>' + escHtml(formatTanggalLengkap(r.Tanggal)) + '</span>' +
        '<span><i class="bi bi-clock"></i>Pukul ' + escHtml(r.Jam || '-') + ' WIB</span></div></div>' +
        '<span class="rw-badge">' + escHtml(r.Status || 'HADIR') + '</span></div>';
    }).join('');
  });

  callAPI('getGuruProfile', [GURU_TOKEN]).then(function (res) {
    if (res.success) { GURU_PROFILE = res.profile; renderQrGuru(res.profile); renderSapaan(); }
  });

  callAPI('getDashboardData').then(function (data) {
    document.getElementById('berandaKegiatanAktif').innerText = data.kegiatan ? data.kegiatan.Nama : 'Tidak ada';
    activeKegiatanCache = data.kegiatan;
    renderBerandaKegiatan(data.kegiatan);
  });
}

/* =========================================================
 *  PROFIL
 * ========================================================= */
function loadProfil() {
  callAPI('getGuruProfile', [GURU_TOKEN]).then(function (res) {
    if (!res.success) return;
    const p = res.profile;
    GURU_PROFILE = p;
    document.getElementById('profilFoto').src = fotoOrAvatar(p.FotoURL, p.Nama);
    document.getElementById('profilNamaDisplay').innerText = p.Nama;
    document.getElementById('profilSekolahDisplay').innerText = p.Sekolah || '-';
    document.getElementById('profilNama').value = p.Nama || '';
    document.getElementById('profilHp').value = hpToLocal(p.NomorHP);
    document.getElementById('profilSekolah').value = p.Sekolah || '';
    document.getElementById('profilAlamatSekolah').value = p.AlamatSekolah || '';
    document.getElementById('profilKepsekNama').value = p.KepsekNama || '';
    document.getElementById('profilKepsekHp').value = hpToLocal(p.KepsekHP);
  });
}

function saveProfilGuru() {
  const data = {
    Nama: document.getElementById('profilNama').value.trim(),
    NomorHP: hpToFull(document.getElementById('profilHp').value),
    Sekolah: document.getElementById('profilSekolah').value.trim(),
    AlamatSekolah: document.getElementById('profilAlamatSekolah').value.trim(),
    KepsekNama: document.getElementById('profilKepsekNama').value.trim(),
    KepsekHP: hpToFull(document.getElementById('profilKepsekHp').value)
  };
  callAPI('updateGuruProfile', [GURU_TOKEN, data]).then(function (res) {
    alert(res.message || 'Profil disimpan.');
    loadProfil();
    document.getElementById('topbarNama').innerText = data.Nama;
    document.getElementById('topbarSekolah').innerText = data.Sekolah;
  }).catch(function (err) { alert('Gagal menyimpan: ' + err.message); });
}

/* =========================================================
 *  ABSENSI KEHADIRAN (WAJAH + GPS)
 * ========================================================= */
function haversineMetersClient(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startAbsensiPage() {
  document.getElementById('absenResultBox').classList.add('d-none');
  autoScanOn = false; autoBusy = false; autoDone = false; autoFail = 0; unlockAudio();
  absenLocked = true;
  updateAbsenLockUI();

  callAPI('getDashboardData').then(function (data) {
    activeKegiatanCache = data.kegiatan;
    if (!data.kegiatan) {
      document.getElementById('absenJarakText').innerText = 'Tidak ada kegiatan aktif saat ini.';
      document.getElementById('absenLockText').innerText = 'Belum ada kegiatan MGMP yang aktif.';
      return;
    }
    watchGpsForAbsensi();
  });

  loadFaceModels();
}

function watchGpsForAbsensi() {
  if (!navigator.geolocation) {
    document.getElementById('absenJarakText').innerText = 'Perangkat tidak mendukung GPS.';
    return;
  }
  absenWatchId = navigator.geolocation.watchPosition(function (pos) {
    currentLat = pos.coords.latitude;
    currentLng = pos.coords.longitude;
    const k = activeKegiatanCache;
    if (!k || !k.Latitude || !k.Longitude) return;

    const dist = Math.round(haversineMetersClient(currentLat, currentLng, parseFloat(k.Latitude), parseFloat(k.Longitude)));
    document.getElementById('absenJarakText').innerText = 'Jarak: ' + dist + 'm (Max: ' + FACE_RADIUS_DEFAULT + 'm)';

    if (dist <= FACE_RADIUS_DEFAULT) {
      absenLocked = false;
      updateAbsenLockUI();
      if (!absenStream) startAbsenCamera();
    } else {
      absenLocked = true;
      updateAbsenLockUI();
      document.getElementById('absenLockText').innerText = 'Anda di luar jangkauan radius absensi (' + dist + 'm / Max: ' + FACE_RADIUS_DEFAULT + 'm).';
    }
  }, function () {
    document.getElementById('absenJarakText').innerText = 'Gagal mendapatkan lokasi. Izinkan akses GPS.';
  }, { enableHighAccuracy: true, maximumAge: 4000 });
}

function updateAbsenLockUI() {
  const overlay = document.getElementById('absenLockOverlay');
  const btn = document.getElementById('btnCheckinWajah');
  const frame = document.getElementById('scanFrame');
  if (absenLocked) { overlay.classList.remove('d-none'); btn.disabled = true; if (frame) frame.classList.add('d-none'); setScanStatus('warn', 'Menunggu Anda berada di lokasi kegiatan...'); }
  else { overlay.classList.add('d-none'); btn.disabled = false; if (frame) frame.classList.remove('d-none'); }
}

function setScanStatus(kind, text) {
  const el = document.getElementById('scanStatus'); if (!el) return;
  el.className = 'scan-status' + (kind ? ' ' + kind : '');
  document.getElementById('scanStatusText').innerText = text;
}

function startAbsenCamera() {
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(function (stream) {
    absenStream = stream;
    const v = document.getElementById('absenVideo');
    v.srcObject = stream;
    v.onplaying = function () { startAutoScan(); };
    if (v.readyState >= 3) startAutoScan();
  }).catch(function (err) {
    document.getElementById('absenJarakText').innerText = 'Gagal mengaktifkan kamera: ' + err.message;
    setScanStatus('err', 'Kamera tidak dapat diaktifkan. Izinkan akses kamera.');
  });
}

/* ---------- ABSEN OTOMATIS: kamera terus memindai wajah, begitu cocok langsung tercatat ---------- */
let autoScanOn = false, autoBusy = false, autoDone = false, autoFail = 0;

function startAutoScan() {
  if (autoScanOn || autoDone) return;
  autoScanOn = true; autoFail = 0;
  setScanStatus('', 'Memuat model pemindai wajah...');
  loadFaceModels().then(function () {
    setScanStatus('', 'Memindai wajah... hadapkan wajah ke kamera');
    autoScanTick();
  }).catch(function (e) { autoScanOn = false; setScanStatus('err', 'Gagal memuat model wajah: ' + e.message); });
}

function stopAutoScan() { autoScanOn = false; }

function autoScanTick() {
  if (!autoScanOn || autoDone) return;
  const video = document.getElementById('absenVideo');
  if (absenLocked || autoBusy || !absenStream || !video.videoWidth) { setTimeout(autoScanTick, 700); return; }
  autoBusy = true;
  detectFaceDescriptor(video).then(function (descriptor) {
    if (!descriptor) { autoBusy = false; setScanStatus('', 'Memindai wajah... hadapkan wajah ke kamera'); setTimeout(autoScanTick, 600); return; }
    setScanStatus('', 'Wajah terdeteksi, memverifikasi...');
    const snap = captureSnapshotBase64(video);
    return callAPI('guruCheckinWajah', [GURU_TOKEN, descriptor, currentLat, currentLng]).then(function (res) {
      autoBusy = false;
      if (res.success) { autoDone = true; autoScanOn = false; onAbsenSukses(res, snap, false); return; }
      if (res.code === 'DUPLICATE') { autoDone = true; autoScanOn = false; onAbsenSukses(res, snap, true); return; }
      if (res.code === 'FACE_NOT_RECOGNIZED') {
        autoFail++;
        setScanStatus('warn', 'Wajah belum dikenali, coba perbaiki pencahayaan & posisi wajah...');
        setTimeout(autoScanTick, autoFail > 4 ? 4000 : 2000); return;
      }
      if (res.code === 'OUT_OF_RANGE' || res.code === 'NO_GPS') { setScanStatus('warn', res.message); setTimeout(autoScanTick, 2500); return; }
      autoScanOn = false;
      setScanStatus('err', res.message || 'Absensi gagal.');
      showAbsenResult(false, res.message || 'Absen gagal, coba lagi.');
    });
  }).catch(function (err) {
    autoBusy = false;
    setScanStatus('warn', 'Gangguan koneksi, mencoba lagi...');
    setTimeout(autoScanTick, 3000);
  });
}

/* ---------- BUNYI "BIPPP" ---------- */
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
['pointerdown', 'touchstart', 'click'].forEach(function (ev) { document.addEventListener(ev, unlockAudio, { passive: true }); });

function playBeep(ok) {
  try {
    unlockAudio(); if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const tone = function (freq, start, dur) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.6, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0 + start); o.stop(t0 + start + dur + 0.02);
    };
    if (ok) { tone(1400, 0, 0.55); } else { tone(700, 0, 0.2); tone(520, 0.25, 0.3); }
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(ok ? [120] : [80, 60, 80]); } catch (e) {}
}

/* ---------- POPUP HASIL ABSENSI ---------- */
let apTimer = null;
function onAbsenSukses(res, snap, duplicate) {
  const g = res.guru || {};
  playBeep(!duplicate);
  setScanStatus('', duplicate ? 'Anda sudah tercatat hadir.' : 'Absensi berhasil!');
  document.getElementById('apFoto').src = g.foto || snap || fotoOrAvatar('', g.nama);
  document.getElementById('apFoto').onerror = function () { this.onerror = null; this.src = snap || fotoOrAvatar('', g.nama); };
  document.getElementById('apNama').innerText = g.nama || (GURU_PROFILE && GURU_PROFILE.Nama) || '-';
  document.getElementById('apSekolah').innerText = g.sekolah || (GURU_PROFILE && GURU_PROFILE.Sekolah) || '-';
  const st = document.getElementById('apStatus');
  st.className = 'ap-status' + (duplicate ? ' warn' : '');
  st.innerHTML = '<i class="bi ' + (duplicate ? 'bi-info-circle-fill' : 'bi-patch-check-fill') + '"></i> ' + escHtml(duplicate ? 'SUDAH ABSEN' : (res.status || 'HADIR'));
  document.getElementById('apJam').innerText = (g.jam || '-') + ' WIB';
  document.getElementById('apTanggal').innerText = formatTanggalLengkap(res.tanggal || new Date().toISOString().slice(0, 10));
  document.getElementById('apKegiatan').innerText = (res.kegiatan && res.kegiatan.nama) || (activeKegiatanCache && activeKegiatanCache.Nama) || '-';
  document.getElementById('apCheck').style.display = duplicate ? 'none' : 'flex';
  document.getElementById('absenPopup').classList.add('show');
  clearTimeout(apTimer);
  apTimer = setTimeout(closeAbsenPopup, 12000);
}

function closeAbsenPopup() {
  clearTimeout(apTimer);
  document.getElementById('absenPopup').classList.remove('show');
  goToGuruPage('Beranda');
}

function doCheckinWajah() {
  const video = document.getElementById('absenVideo');
  const btn = document.getElementById('btnCheckinWajah');
  if (autoBusy) return;
  autoBusy = true;
  btn.disabled = true;
  detectFaceDescriptor(video).then(function (descriptor) {
    if (!descriptor) { autoBusy = false; btn.disabled = false; showAbsenResult(false, 'Wajah tidak terdeteksi jelas. Pastikan pencahayaan cukup dan coba lagi.'); return; }
    const snap = captureSnapshotBase64(video);
    callAPI('guruCheckinWajah', [GURU_TOKEN, descriptor, currentLat, currentLng]).then(function (res) {
      autoBusy = false; btn.disabled = false;
      if (res.success) { autoDone = true; autoScanOn = false; onAbsenSukses(res, snap, false); }
      else if (res.code === 'DUPLICATE') { autoDone = true; autoScanOn = false; onAbsenSukses(res, snap, true); }
      else showAbsenResult(false, res.message || 'Absen gagal, coba lagi.');
    }).catch(function (err) { autoBusy = false; btn.disabled = false; showAbsenResult(false, 'Gagal terhubung ke server: ' + err.message); });
  });
}

function showAbsenResult(ok, msg) {
  const box = document.getElementById('absenResultBox');
  box.classList.remove('d-none', 'absen-result-ok', 'absen-result-fail');
  box.classList.add(ok ? 'absen-result-ok' : 'absen-result-fail');
  box.innerHTML = '<i class="bi ' + (ok ? 'bi-check-circle-fill' : 'bi-x-circle-fill') + '" style="font-size:18px;"></i><div>' + msg + '</div>';
}

/* =========================================================
 *  UPDATE DATA WAJAH
 * ========================================================= */
let updDescriptor = null, updFotoBase64 = null;

function startUpdateWajahPage() {
  document.getElementById('updFaceStatus').innerText = 'Memuat model deteksi wajah...';
  startFaceModelsAndCamera('updVideo', 'updFaceStatus', 'btnCaptureUpdate').then(function (stream) {
    updStream = stream;
  });
}

function captureUpdateFace() {
  const video = document.getElementById('updVideo');
  const btn = document.getElementById('btnCaptureUpdate');
  btn.disabled = true; btn.innerText = 'Memproses...';

  detectFaceDescriptor(video).then(function (descriptor) {
    if (!descriptor) {
      document.getElementById('updFaceStatus').innerText = 'Wajah tidak terdeteksi. Coba lagi.';
      document.getElementById('updFaceStatus').style.color = '#dc2626';
      btn.disabled = false; btn.innerText = 'Ambil & Simpan';
      return;
    }
    const fotoBase64 = captureSnapshotBase64(video);
    callAPI('updateFaceData', [GURU_TOKEN, descriptor, fotoBase64.split(',')[1], 'image/jpeg']).then(function (res) {
      document.getElementById('updFaceStatus').innerText = res.message || 'Data wajah berhasil diperbarui.';
      document.getElementById('updFaceStatus').style.color = '#16a34a';
      btn.disabled = false; btn.innerText = 'Ambil & Simpan';
      setTimeout(function () { goToGuruPage('Absensi'); }, 1500);
    }).catch(function (err) {
      document.getElementById('updFaceStatus').innerText = 'Gagal menyimpan: ' + err.message;
      document.getElementById('updFaceStatus').style.color = '#dc2626';
      btn.disabled = false; btn.innerText = 'Ambil & Simpan';
    });
  });
}

/* =========================================================
 *  GANTI PASSWORD
 * ========================================================= */
function handleGantiPassword() {
  const lama = document.getElementById('pwLama').value;
  const baru = document.getElementById('pwBaru').value;
  const baru2 = document.getElementById('pwBaru2').value;
  const msgEl = document.getElementById('pwResultMsg');

  if (!lama || !baru) { msgEl.innerText = 'Semua field wajib diisi.'; msgEl.style.color = '#dc2626'; return; }
  if (baru !== baru2) { msgEl.innerText = 'Konfirmasi password baru tidak cocok.'; msgEl.style.color = '#dc2626'; return; }

  callAPI('updateGuruPassword', [GURU_TOKEN, lama, baru]).then(function (res) {
    msgEl.innerText = res.message;
    msgEl.style.color = res.success ? '#16a34a' : '#dc2626';
    if (res.success) { document.getElementById('pwLama').value = ''; document.getElementById('pwBaru').value = ''; document.getElementById('pwBaru2').value = ''; }
  }).catch(function (err) {
    msgEl.innerText = 'Gagal: ' + err.message; msgEl.style.color = '#dc2626';
  });
}

/* =========================================================
 *  LOGOUT
 * ========================================================= */
function handleGuruLogout() {
  stopStream(absenStream); stopStream(updStream); stopStream(regStream);
  if (absenWatchId) navigator.geolocation.clearWatch(absenWatchId);
  localStorage.removeItem('sipello_guru_token');
  GURU_TOKEN = null; GURU_PROFILE = null;
  location.replace('index.html');
}

/* =========================================================
 *  FOTO PROFIL (upload + resize) & KARTU QR
 * ========================================================= */
function makeThumb(dataUrl, px) {
  return new Promise(function (resolve) {
    const img = new Image();
    img.onerror = function () { resolve(''); };
    img.onload = function () {
      const s = Math.min(1, px / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.src = dataUrl;
  });
}

function resizeImageToDataUrl(file, maxPx) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('Gagal membaca file foto.')); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error('File bukan gambar yang valid.')); };
      img.onload = function () {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderQrGuru(p) {
  const box = document.getElementById('berandaQr');
  const value = p.QRValue || p.ID;
  document.getElementById('berandaQrLabel').innerText = p.Nama || '';
  box.innerHTML = '';
  try {
    if (typeof QRCode === 'undefined') throw new Error('lib');
    new QRCode(box, { text: String(value), width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) {
    box.innerHTML = '<img src="' + (p.QRUrl || '') + '" alt="QR" style="width:160px;height:160px;">';
  }
}

/* ---------- CROP FOTO (Cropper.js; jika gagal dimuat, pakai resize biasa) ---------- */
let cropperInst = null, cropCallback = null;

function openCropper(file, callback) {
  if (typeof Cropper === 'undefined') {
    resizeImageToDataUrl(file, 600).then(callback).catch(function (err) { alert(err.message); });
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    const img = document.getElementById('cropImage');
    if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
    img.src = reader.result;
    cropCallback = callback;
    document.getElementById('cropModal').style.display = 'flex';
    img.onload = function () {
      cropperInst = new Cropper(img, {
        aspectRatio: 1, viewMode: 1, dragMode: 'move', autoCropArea: 0.9,
        guides: false, center: false, highlight: false, background: false,
        cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false
      });
    };
  };
  reader.onerror = function () { alert('Gagal membaca file foto.'); };
  reader.readAsDataURL(file);
}

function cropAction(a) {
  if (!cropperInst) return;
  if (a === 'zoomIn') cropperInst.zoom(0.1);
  if (a === 'zoomOut') cropperInst.zoom(-0.1);
  if (a === 'rotate') cropperInst.rotate(90);
  if (a === 'reset') cropperInst.reset();
}

function cropClose() {
  document.getElementById('cropModal').style.display = 'none';
  if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
  document.getElementById('regFotoFile').value = '';
  document.getElementById('profilFotoFile').value = '';
}
function cropCancel() { cropCallback = null; cropClose(); }

function cropConfirm() {
  if (!cropperInst) return;
  const canvas = cropperInst.getCroppedCanvas({ width: 600, height: 600, fillColor: '#fff', imageSmoothingQuality: 'high' });
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  const cb = cropCallback; cropCallback = null;
  cropClose();
  if (cb) cb(dataUrl);
}

function afterCropRegister(dataUrl) {
  regProfilePhoto = dataUrl;
  makeThumb(dataUrl, 240).then(function (t) { regThumb = t; });
  document.getElementById('regFotoPreview').src = dataUrl;
}

function afterCropProfil(dataUrl) {
  document.getElementById('profilFoto').src = dataUrl;
  makeThumb(dataUrl, 240).then(function (thumb) {
    return callAPI('updateGuruProfile', [GURU_TOKEN, { FotoBase64: dataUrl.split(',')[1], FotoMime: 'image/jpeg', FotoThumb: thumb }]);
  }).then(function (res) {
    if (!res.success) { alert(res.message || 'Gagal menyimpan foto.'); loadProfil(); return; }
    alert(res.message || 'Foto diperbarui.');
    if (res.fotoUrl) document.getElementById('topbarFoto').src = res.fotoUrl;
    loadProfil();
  }).catch(function (err) { alert('Gagal mengganti foto: ' + err.message); });
}

document.addEventListener('change', function (e) {
  if (!e.target) return;
  if (e.target.id === 'regFotoFile' && e.target.files[0]) openCropper(e.target.files[0], afterCropRegister);
  if (e.target.id === 'profilFotoFile' && e.target.files[0]) openCropper(e.target.files[0], afterCropProfil);
});


/* =========================================================
 *  NOMOR HP: tampil +62 otomatis (ketik tanpa 0), simpan 62xxxxxxxxxx
 * ========================================================= */
function hpToLocal(v) {
  let d = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('62') === 0) d = d.substring(2);
  d = d.replace(/^0+/, '');
  return d;
}
function hpToFull(v) {
  const l = hpToLocal(v);
  return l ? '62' + l : '';
}
document.addEventListener('input', function (e) {
  if (e.target && ['regHp', 'regKepsekHp', 'profilHp', 'profilKepsekHp'].indexOf(e.target.id) !== -1) {
    const l = hpToLocal(e.target.value);
    if (e.target.value !== l) e.target.value = l;
  }
});


function togglePw(id, btn) {
  const el = document.getElementById(id);
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.innerHTML = '<i class="bi ' + (show ? 'bi-eye-slash' : 'bi-eye') + '"></i>';
}
