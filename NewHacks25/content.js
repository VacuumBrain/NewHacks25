// content.js
console.log("Google Maps Food Overlay extension loaded.");

// ---------- Overlay ----------
function formatPrice(priceLevel) {
  if (typeof priceLevel === "number") {
    const n = Math.max(1, Math.min(5, priceLevel + 1));
    return "$".repeat(n);
  }

  const map = {
    PRICE_LEVEL_FREE: 1,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };

  const n = map[priceLevel] ?? 0;
  return n ? "$".repeat(n) : "—";
}

const overlay = document.createElement("div");
overlay.id = "food-overlay";
overlay.style.cssText = `
  position: fixed;
  bottom: 12px;
  left: 12px;
  z-index: 999999;
  max-width: 420px;
  background: #111;
  color: #fff;
  padding: 12px 14px;
  border-radius: 10px;
  font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 6px 24px rgba(0,0,0,.35);
  display: none;
`;

overlay.innerHTML = `<div id="overlay-content"></div>`;
document.body.appendChild(overlay);

function hideOverlay() {
  overlay.style.display = "none";
}

function renderOverlay(info) {
  const c = document.getElementById("overlay-content");
  const price = (info.priceLevel ?? 0) + 1; // 1..5 display
  const priceDisp = formatPrice(info.priceLevel);
  const comp = info.touristTrapComponents || {};

  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
      <div style="font-weight:600; font-size:14px;">${info.name ?? "Unknown place"}</div>
      <button id="close-overlay" style="background:#333;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer">
        Close
      </button>
    </div>

    <div style="margin:6px 0;">⭐ ${info.rating ?? "N/A"} (${info.userRatingCount ?? 0}) · ${priceDisp}</div>

    <div style="font-size:14px;margin:6px 0 8px;">
      <strong>Tourist trap likelihood:</strong>
      <span style="font-size:16px;">${info.touristTrap ?? "?"}%</span>
    </div>

    <div style="opacity:.85;">
      <div>Local language: <code>${comp.localLang || "?"}</code> in ${comp.country || "?"}</div>
      <div>Local-lang share (sample): <code>${comp.localLangShare ?? "?"}</code></div>
      <div>Overpriced mentions: <code>${comp.overpricedHits ?? 0}</code>, Touristy mentions: <code>${comp.touristyHits ?? 0}</code></div>
      <div>Local praise hits: <code>${comp.localPraiseHits ?? 0}</code></div>
    </div>
  `;

  document.getElementById("close-overlay").onclick = hideOverlay;
  overlay.style.display = "block";
}

// ---------- URL parsing helpers ----------
function extractLatLngFromGoogleMapsUrl() {
  try {
    const parsedUrl = new URL(window.location.href);

    // Case 1: after '@' → /@LAT,LNG,zoom/
    const atMatch = parsedUrl.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch)
      return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };

    // Case 2: ...!3dLAT!4dLNG
    const dataMatch = parsedUrl.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (dataMatch)
      return { lat: parseFloat(dataMatch[1]), lng: parseFloat(dataMatch[2]) };

    // Case 3: ?q=LAT,LNG
    const qParam = parsedUrl.searchParams.get("q");
    if (qParam) {
      const coords = qParam.split(",");
      if (coords.length === 2)
        return { lat: parseFloat(coords[0]), lng: parseFloat(coords[1]) };
    }

    return null;
  } catch (err) {
    console.error("Invalid URL:", err);
    return null;
  }
}

function getPlaceIdFromUrl() {
  console.log("Checking url");
  const url = new URL(window.location.href);

  const qParam = url.searchParams.get("q");
  if (qParam && qParam.startsWith("place_id:"))
    return qParam.replace("place_id:", "");

  const placeIdParam = url.searchParams.get("place_id");
  if (placeIdParam) return placeIdParam;

  const pathMatch = window.location.href.match(/1s([^!]+)!/);
  if (pathMatch && pathMatch[1]) return pathMatch[1];

  return null;
}

let lastChecked = null;

function checkUrlChange() {
  const currentPlaceId = getPlaceIdFromUrl();
  if (!currentPlaceId) return;

  // Try to ensure we're on a restaurant-like place
  const placeNameEl =
    document.querySelector("h1.DUwDvf.lfPIob") || document.querySelector("h1");
  const categoryEl = document.querySelector(".DkEaL"); // may change if Google updates DOM

  if (!placeNameEl || !categoryEl) return;
  if (placeNameEl.innerText === lastChecked) return;

  const catText = categoryEl.innerText.toLowerCase();
  if (
    !(
      catText.includes("restaurant") ||
      catText.includes("food") ||
      catText.includes("cafe")
    )
  )
    return;

  // Coordinates
  const coords = extractLatLngFromGoogleMapsUrl();
  if (!coords || Number.isNaN(coords.lat) || Number.isNaN(coords.lng)) {
    // Maps sometimes updates the URL a moment later; we’ll try again on next tick
    return;
  }

  // Send message to background
  chrome.runtime.sendMessage(
    {
      type: "PLACE_INFO",
      placeName: placeNameEl.innerText,
      lat: coords.lat,
      lng: coords.lng,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("sendMessage error:", chrome.runtime.lastError.message);
        return;
      }

      if (!response || !response.ok) {
        console.error("Backend/Background error:", response?.error || "Unknown");
        return;
      }

      lastChecked = placeNameEl.innerText;
      renderOverlay(response.data); // show the result card
    }
  );
}

setInterval(checkUrlChange, 2000);

// === Area Scanner: clickable list + close button (no map pins) ==========
(function() {
  const btn = document.createElement('button');
  btn.textContent = 'Scan nearby restaurants';
  Object.assign(btn.style, {
    position: 'fixed', top: '100px', right: '20px', zIndex: 99999,
    padding: '8px 12px', borderRadius: '6px', background: '#1a73e8',
    color: '#fff', border: 'none', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,.2)'
  });
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', top: '150px', right: '20px', zIndex: 99999,
    background: '#fff', color: '#000', padding: '10px', borderRadius: '8px',
    width: '320px', maxHeight: '60vh', overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
    display: 'none'
  });
  document.body.appendChild(panel);

  // Header with Close button
  const header = document.createElement('div');
  Object.assign(header.style, { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' });
  const title = document.createElement('strong');
  title.textContent = 'Nearby Restaurants';
  const close = document.createElement('button');
  close.textContent = 'Close';
  Object.assign(close.style, { background:'#eee', border:'none', borderRadius:'6px', padding:'4px 8px', cursor:'pointer' });
  close.addEventListener('click', () => { panel.style.display = 'none'; });
  header.appendChild(title);
  header.appendChild(close);

  const listContainer = document.createElement('div');

  panel.appendChild(header);
  panel.appendChild(listContainer);

  btn.addEventListener('click', async () => {
    const coords = extractLatLngFromGoogleMapsUrl();
    if (!coords) return alert('Could not read map coordinates.');
    btn.textContent = 'Scanning...'; btn.disabled = true;

    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'NEARBY_SCORES',
        lat: coords.lat,
        lng: coords.lng,
        radiusMeters: 800,
        limit: 12
      });
      if (!resp?.ok) throw new Error(resp?.error || 'Scan failed');
      renderNearby(resp.data.results || []);
      panel.style.display = 'block';
    } catch (e) {
      alert('Scan failed: ' + e.message);
      console.error(e);
    } finally {
      btn.disabled = false; btn.textContent = 'Scan nearby restaurants';
    }
  });

  function renderNearby(list) {
    listContainer.innerHTML = '';
    if (!list.length) {
      listContainer.innerHTML = '<div>No restaurants found in this area.</div>';
      return;
    }

    for (const r of list) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        borderBottom:'1px solid #ddd', padding:'6px 0', cursor:'pointer',
        outline:'none'
      });
      row.setAttribute('tabindex', '0');
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open ${r.name} in Google Maps`);

      const color = r.touristTrap >= 70 ? '#d32f2f' : r.touristTrap >= 40 ? '#f57c00' : '#2e7d32';
      const price = typeof formatPrice === 'function' ? formatPrice(r.priceLevel) : '';

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${escapeHtml(r.name || 'Unknown')}</strong>
          <span style="font-weight:bold;color:${color}">${r.touristTrap}</span>
        </div>
        <div style="font-size:12px;color:#555">
          ⭐ ${r.rating ?? '–'} • ${r.userRatingCount ?? 0} reviews ${price ? '• ' + price : ''}
        </div>
      `;

      // Click or Enter/Space opens the place in the same tab
      const open = () => openPlaceOnMaps(r);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });

      listContainer.appendChild(row);
    }

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'margin-top:6px;font-size:12px;color:#444;display:flex;gap:10px';
    legend.innerHTML = `
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#d32f2f;margin-right:6px"></span>70+</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f57c00;margin-right:6px"></span>40–69</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#2e7d32;margin-right:6px"></span>0–39</span>
    `;
    listContainer.appendChild(legend);
  }

  function openPlaceOnMaps(r) {
    // Prefer place_id based URL (stable); fallback to a text+lat,lng search.
    if (r.placeId) {
      location.href = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.placeId)}`;
      return;
    }
    if (r.location && r.name) {
      const q = encodeURIComponent(`${r.name} @ ${r.location.latitude},${r.location.longitude}`);
      location.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
      return;
    }
    if (r.name) {
      location.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}`;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
})();
