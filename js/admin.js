// Admin script — manages drivers + geofence via Firebase Realtime Database
document.addEventListener('DOMContentLoaded', ()=>{
  const driverName = document.getElementById('driverName');
  const addBtn = document.getElementById('addDriverBtn');
  const list = document.getElementById('driversList');

  // Firebase (compat) already loaded in page
  const firebaseConfig = {
    apiKey: "AIzaSyDOK9DF3u9JXzfi7PYExrCDQX09vNN_c3k",
    authDomain: "uber-system-e73d6.firebaseapp.com",
    projectId: "uber-system-e73d6",
    storageBucket: "uber-system-e73d6.firebasestorage.app",
    messagingSenderId: "482805503804",
    appId: "1:482805503804:web:fa126da66cf3efcf45b039",
    measurementId: "G-CC559WX63X",
    databaseURL: "https://uber-system-e73d6-default-rtdb.firebaseio.com/"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  // ===== DRIVERS =====
  function renderDrivers(snapshot){
    const val = snapshot.val() || {};
    list.innerHTML = '';
    const keys = Object.keys(val).sort();
    if (!keys.length) { list.textContent = 'No drivers yet.'; return; }
    keys.forEach(k => {
      const d = val[k];
      const el = document.createElement('div');
      el.className = 'driver-card';
      const online = d.online ? '<strong style="color:#06c167">Online</strong>' : '<span style="color:#888">Offline</span>';
      const loc = (d.lat && d.lng) ? `at ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : 'no location';
      el.innerHTML = `<div class="driver-info"><strong>${escapeHtml(d.name||'Unnamed')}</strong><div class="driver-meta">${online} · ${loc}</div></div>
        <div class="driver-actions">
          <button data-id="${escapeHtml(k)}" class="toggle">${d.online ? 'Set offline' : 'Set online'}</button>
          <button data-id="${escapeHtml(k)}" class="remove">Remove</button>
        </div>`;
      list.appendChild(el);
    });
    list.querySelectorAll('.toggle').forEach(btn => btn.addEventListener('click', async (e)=>{
      const id = e.target.getAttribute('data-id');
      const cur = (await db.ref('drivers/'+id).once('value')).val() || {};
      await db.ref('drivers/'+id).update({ online: !cur.online, lastSeen: Date.now() });
    }));
    list.querySelectorAll('.remove').forEach(btn => btn.addEventListener('click', async (e)=>{
      const id = e.target.getAttribute('data-id');
      if (!confirm('Remove driver?')) return;
      await db.ref('drivers/'+id).remove();
    }));
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

  db.ref('drivers').on('value', renderDrivers);

  addBtn.addEventListener('click', async ()=>{
    const name = (driverName.value || '').trim();
    if (!name) return alert('Enter a driver name');
    const r = db.ref('drivers').push();
    await r.set({ name, online:false, created: Date.now() });
    driverName.value = '';
  });

  // ===== GEOFENCE =====
  const fenceToggle = document.getElementById('fenceToggle');
  const fenceStatus = document.getElementById('fenceStatus');
  const fenceMapEl = document.getElementById('fenceMap');
  const radiusInput = document.getElementById('radiusInput');
  const radiusMinus = document.getElementById('radiusMinus');
  const radiusPlus = document.getElementById('radiusPlus');
  const fenceSaveBtn = document.getElementById('fenceSaveBtn');
  const fenceResetBtn = document.getElementById('fenceResetBtn');
  const fenceCoords = document.getElementById('fenceCoords');
  const fenceMsg = document.getElementById('fenceMsg');

  let fenceMap = null;
  let fenceCircle = null;
  let fenceCenter = null;   // {lat, lng}
  let fenceRadiusKm = 10;
  let fenceEnabled = false;

  // Init Leaflet map for geofence
  function initFenceMap(){
    if (fenceMap) return;
    fenceMap = L.map(fenceMapEl, { zoomControl: true }).setView([-26.2041, 28.0473], 10); // default: Johannesburg
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'networKING Technology' }).addTo(fenceMap);
    if (fenceMap.attributionControl) fenceMap.attributionControl.setPrefix('');
    setTimeout(()=>{ try{ fenceMap.invalidateSize(); }catch(e){} }, 200);

    // Click to set center
    fenceMap.on('click', (e)=>{
      fenceCenter = { lat: e.latlng.lat, lng: e.latlng.lng };
      drawFenceCircle();
      updateCoordsLabel();
    });
  }

  function drawFenceCircle(){
    if (!fenceMap || !fenceCenter) return;
    const radiusM = fenceRadiusKm * 1000;
    if (fenceCircle) {
      fenceCircle.setLatLng([fenceCenter.lat, fenceCenter.lng]);
      fenceCircle.setRadius(radiusM);
    } else {
      fenceCircle = L.circle([fenceCenter.lat, fenceCenter.lng], {
        radius: radiusM,
        color: '#06c167',
        fillColor: '#06c167',
        fillOpacity: 0.12,
        weight: 2
      }).addTo(fenceMap);
    }
    // fit map to the circle bounds
    try { fenceMap.fitBounds(fenceCircle.getBounds(), { padding: [30, 30] }); } catch(e){}
  }

  function updateCoordsLabel(){
    if (!fenceCenter) { fenceCoords.textContent = 'Click map to set center'; return; }
    fenceCoords.textContent = `${fenceCenter.lat.toFixed(5)}, ${fenceCenter.lng.toFixed(5)}`;
  }

  function updateStatusPill(){
    if (fenceEnabled) {
      fenceStatus.className = 'status-pill on';
      fenceStatus.innerHTML = '<span class="status-dot"></span> On';
    } else {
      fenceStatus.className = 'status-pill off';
      fenceStatus.innerHTML = '<span class="status-dot"></span> Off';
    }
  }

  function showFenceMsg(text, type){
    fenceMsg.textContent = text;
    fenceMsg.className = 'panel-msg ' + type;
    fenceMsg.classList.remove('hidden');
    clearTimeout(fenceMsg._t);
    fenceMsg._t = setTimeout(()=>{ fenceMsg.classList.add('hidden'); }, 3000);
  }

  // Toggle on/off — saves immediately
  fenceToggle.addEventListener('change', async ()=>{
    fenceEnabled = fenceToggle.checked;
    updateStatusPill();
    try {
      await db.ref('settings/geofence').update({ enabled: fenceEnabled });
      showFenceMsg(fenceEnabled ? 'Geofence turned ON' : 'Geofence turned OFF', 'success');
    } catch(e){
      console.error(e);
      showFenceMsg('Failed to update', 'error');
    }
  });

  // Radius controls
  radiusMinus.addEventListener('click', ()=>{
    fenceRadiusKm = Math.max(1, fenceRadiusKm - 1);
    radiusInput.value = fenceRadiusKm;
    drawFenceCircle();
  });
  radiusPlus.addEventListener('click', ()=>{
    fenceRadiusKm = Math.min(500, fenceRadiusKm + 1);
    radiusInput.value = fenceRadiusKm;
    drawFenceCircle();
  });
  radiusInput.addEventListener('change', ()=>{
    let v = parseInt(radiusInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 500) v = 500;
    fenceRadiusKm = v;
    radiusInput.value = v;
    drawFenceCircle();
  });

  // Save full geofence config
  fenceSaveBtn.addEventListener('click', async ()=>{
    if (!fenceCenter) { showFenceMsg('Click the map to set a center point first', 'error'); return; }
    fenceSaveBtn.disabled = true;
    fenceSaveBtn.textContent = 'Saving…';
    try {
      await db.ref('settings/geofence').set({
        enabled: fenceEnabled,
        lat: fenceCenter.lat,
        lng: fenceCenter.lng,
        radiusKm: fenceRadiusKm,
        updatedAt: Date.now()
      });
      showFenceMsg('Zone saved', 'success');
    } catch(e) {
      console.error(e);
      showFenceMsg('Failed to save', 'error');
    } finally {
      fenceSaveBtn.disabled = false;
      fenceSaveBtn.textContent = 'Save zone';
    }
  });

  // Reset to last saved
  fenceResetBtn.addEventListener('click', ()=>{
    loadFenceFromDB();
  });

  // Load saved geofence from Firebase
  function loadFenceFromDB(){
    db.ref('settings/geofence').once('value').then(snap => {
      const data = snap.val();
      if (!data) return;
      fenceEnabled = !!data.enabled;
      fenceToggle.checked = fenceEnabled;
      updateStatusPill();
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        fenceCenter = { lat: data.lat, lng: data.lng };
      }
      if (typeof data.radiusKm === 'number') {
        fenceRadiusKm = data.radiusKm;
        radiusInput.value = fenceRadiusKm;
      }
      updateCoordsLabel();
      if (fenceCenter) drawFenceCircle();
    }).catch(e => console.error('Failed to load geofence', e));
  }

  // Also listen for live changes so admin sees updates if another admin modifies
  db.ref('settings/geofence').on('value', snap => {
    const data = snap.val();
    if (!data) return;
    fenceEnabled = !!data.enabled;
    fenceToggle.checked = fenceEnabled;
    updateStatusPill();
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      fenceCenter = { lat: data.lat, lng: data.lng };
    }
    if (typeof data.radiusKm === 'number') {
      fenceRadiusKm = data.radiusKm;
      radiusInput.value = fenceRadiusKm;
    }
    updateCoordsLabel();
    if (fenceCenter) drawFenceCircle();
  });

  // Initialise map after a short delay to let the layout settle
  setTimeout(initFenceMap, 100);
});
