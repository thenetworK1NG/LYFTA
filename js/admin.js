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
          <button data-id="${k}" class="toggle">${d.online ? 'Set offline' : 'Set online'}</button>
          <button data-id="${k}" class="remove">Remove</button>
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
  const fenceRef = db.ref('geofence');
  const mapEl = document.getElementById('fenceMap');
  const fenceToggle = document.getElementById('fenceToggle');
  const radiusInput = document.getElementById('radiusInput');
  const radiusMinus = document.getElementById('radiusMinus');
  const radiusPlus = document.getElementById('radiusPlus');
  const zoneLabel = document.getElementById('zoneLabel');
  const coordsDisplay = document.getElementById('coordsDisplay');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusPill = document.getElementById('statusPill');
  const statusLabelEl = document.getElementById('statusLabel');
  const fenceDesc = document.getElementById('fenceDesc');
  const panelMsg = document.getElementById('panelMsg');

  let fenceMap = null;
  let centerLatLng = null;
  let circle = null;
  let centerMarker = null;
  let loadedFromDB = false;

  function initFenceMap(){
    if (fenceMap || !mapEl) return;
    fenceMap = L.map(mapEl, { zoomControl: true }).setView([-26.2041, 28.0473], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: 'networKING Technology'
    }).addTo(fenceMap);
    if (fenceMap.attributionControl) fenceMap.attributionControl.setPrefix('');

    fenceMap.on('click', (e) => {
      setFenceCenter(e.latlng.lat, e.latlng.lng);
      updateFenceCircle();
      updateFenceSaveBtn();
    });

    // Leaflet needs resize after container is rendered
    setTimeout(() => { try { fenceMap.invalidateSize(); } catch(e){} }, 300);
  }

  function setFenceCenter(lat, lng){
    centerLatLng = { lat, lng };
    coordsDisplay.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (!centerMarker) {
      centerMarker = L.marker([lat, lng], { draggable: true, autoPan: true }).addTo(fenceMap).bindPopup('Zone center');
      centerMarker.on('dragend', () => {
        const pos = centerMarker.getLatLng();
        centerLatLng = { lat: pos.lat, lng: pos.lng };
        coordsDisplay.textContent = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        updateFenceCircle();
        updateFenceSaveBtn();
      });
    } else {
      centerMarker.setLatLng([lat, lng]);
    }
  }

  function updateFenceCircle(){
    if (!centerLatLng || !fenceMap) return;
    const radiusM = getFenceRadiusKm() * 1000;
    if (!circle) {
      circle = L.circle([centerLatLng.lat, centerLatLng.lng], {
        radius: radiusM, color: '#06c167', weight: 2,
        fillColor: '#06c167', fillOpacity: 0.08, dashArray: '6 4'
      }).addTo(fenceMap);
    } else {
      circle.setLatLng([centerLatLng.lat, centerLatLng.lng]);
      circle.setRadius(radiusM);
    }
    try { fenceMap.fitBounds(circle.getBounds(), { padding: [40, 40], maxZoom: 14 }); } catch(e){}
  }

  function clearFenceOverlays(){
    if (circle && fenceMap) { fenceMap.removeLayer(circle); circle = null; }
    if (centerMarker && fenceMap) { fenceMap.removeLayer(centerMarker); centerMarker = null; }
    centerLatLng = null;
    coordsDisplay.textContent = 'Tap the map to set center';
  }

  function getFenceRadiusKm(){
    const v = parseInt(radiusInput.value, 10);
    return (isNaN(v) || v < 1) ? 1 : Math.min(v, 500);
  }

  function updateFenceSaveBtn(){ saveBtn.disabled = !centerLatLng; }

  function updateFenceStatusPill(enabled){
    statusPill.className = 'status-pill ' + (enabled ? 'on' : 'off');
    statusLabelEl.textContent = enabled ? 'Active' : 'Disabled';
  }

  function showFenceMsg(text, type){
    panelMsg.textContent = text;
    panelMsg.className = 'panel-msg ' + type;
    clearTimeout(panelMsg._t);
    panelMsg._t = setTimeout(() => { panelMsg.className = 'panel-msg hidden'; }, 3000);
  }

  function showToast(msg){
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.classList.remove('show'); }, 2500);
  }

  // Load fence from Firebase
  function loadFence(snapshot){
    const data = snapshot.val();
    if (!data) {
      updateFenceStatusPill(false);
      fenceDesc.textContent = 'No zone set';
      fenceToggle.checked = false;
      clearFenceOverlays();
      updateFenceSaveBtn();
      loadedFromDB = true;
      return;
    }
    fenceToggle.checked = !!data.enabled;
    updateFenceStatusPill(!!data.enabled);
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      setFenceCenter(data.lat, data.lng);
      if (data.radiusKm) radiusInput.value = data.radiusKm;
      updateFenceCircle();
    }
    if (data.label) zoneLabel.value = data.label;
    fenceDesc.textContent = data.label
      ? `${data.label} · ${data.radiusKm || 15} km`
      : `${data.radiusKm || 15} km radius`;
    updateFenceSaveBtn();
    loadedFromDB = true;
  }

  async function saveFence(){
    if (!centerLatLng) return;
    const data = {
      lat: centerLatLng.lat,
      lng: centerLatLng.lng,
      radiusKm: getFenceRadiusKm(),
      label: zoneLabel.value.trim().replace(/[<>"'&]/g, '') || '',
      enabled: fenceToggle.checked,
      updatedAt: Date.now()
    };
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await fenceRef.set(data);
      showToast('Geofence saved');
      showFenceMsg('Zone saved successfully', 'success');
      fenceDesc.textContent = data.label
        ? `${data.label} · ${data.radiusKm} km`
        : `${data.radiusKm} km radius`;
      updateFenceStatusPill(data.enabled);
    } catch(e) {
      console.error('Save failed', e);
      showFenceMsg('Failed to save — try again', 'error');
    } finally {
      saveBtn.textContent = 'Save Zone';
      updateFenceSaveBtn();
    }
  }

  async function clearFence(){
    if (!confirm('Remove the geofence? Riders and drivers will be unrestricted.')) return;
    try {
      await fenceRef.remove();
      clearFenceOverlays();
      zoneLabel.value = '';
      radiusInput.value = 15;
      fenceToggle.checked = false;
      updateFenceStatusPill(false);
      fenceDesc.textContent = 'No zone set';
      showToast('Geofence removed');
    } catch(e) {
      console.error('Clear failed', e);
      showFenceMsg('Failed to clear — try again', 'error');
    }
  }

  // Geofence events
  saveBtn.addEventListener('click', saveFence);
  clearBtn.addEventListener('click', clearFence);

  fenceToggle.addEventListener('change', async () => {
    if (!loadedFromDB) return;
    if (centerLatLng) {
      try {
        await fenceRef.update({ enabled: fenceToggle.checked, updatedAt: Date.now() });
        updateFenceStatusPill(fenceToggle.checked);
        showToast(fenceToggle.checked ? 'Geofence enabled' : 'Geofence disabled');
      } catch(e) { console.error('Toggle failed', e); }
    }
  });

  radiusMinus.addEventListener('click', () => {
    const cur = getFenceRadiusKm();
    if (cur > 1) { radiusInput.value = cur - 1; updateFenceCircle(); }
  });
  radiusPlus.addEventListener('click', () => {
    const cur = getFenceRadiusKm();
    if (cur < 500) { radiusInput.value = cur + 1; updateFenceCircle(); }
  });
  radiusInput.addEventListener('input', () => { updateFenceCircle(); });

  // Init geofence map + listener
  initFenceMap();
  fenceRef.on('value', loadFence);
  updateFenceSaveBtn();
});
