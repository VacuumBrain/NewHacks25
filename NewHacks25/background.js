// === background.js (Manifest V3 service worker) ==========================
// What this file does:
// 1) Listens for messages from content.js
// 2) When it receives { type: "PLACE_INFO", placeName, lat, lng },
//    it calls your backend (http://localhost:8080/api/restaurant-info)
// 3) It sends the backend's JSON response back to content.js via sendResponse
//
// Requirements:
// - In manifest.json, set:
//   "background": { "service_worker": "background.js" }
//   "host_permissions": ["http://localhost:8080/*"]   <-- so we can fetch your backend
//
// Notes:
// - Always `return true` inside onMessage listener when doing async work,
//   so Chrome keeps the message channel open until we call sendResponse().
// ========================================================================

/*const API_BASE = 'http://localhost:8080'; // your Express server base URL


// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Ignore anything that isn't our message shape
  if (!msg || typeof msg !== 'object' || !msg.type) {
    return; // no sendResponse needed
  }


  // We only handle the PLACE_INFO message in this basic example
  if (msg.type !== 'PLACE_INFO') {
    // You could send an error back if you want:
    // sendResponse({ ok: false, error: 'Unknown message type' });
    return;
  }

  // ---- Async handler (do not block here) ----
  (async () => {
    try {
      // Basic validation and normalization
      const placeName = String(msg.placeName || '').trim();
      const lat = Number(msg.lat);
      const lng = Number(msg.lng);


      if (!placeName || Number.isNaN(lat) || Number.isNaN(lng)) {
        sendResponse({ ok: false, error: 'Missing or invalid placeName/lat/lng' });
        return;
      }


      // Make the POST request to your Node/Express backend
      const resp = await fetch(`${API_BASE}/api/restaurant-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: placeName,
          latitude: lat,
          longitude: lng
        })
      });


      // If backend responded with an HTTP error, return a readable message
      if (!resp.ok) {
        // Try to read text for better error diagnostics
        const text = await resp.text().catch(() => '');
        sendResponse({
          ok: false,
          error: `Backend error ${resp.status}${text ? `: ${text}` : ''}`
        });
        return;
      }


      // Parse JSON and forward it to the content script
      const data = await resp.json();
      console.log('[BG] server response:', data);
      // Example fields you’ll get back (from earlier steps):
      // data.placeId, data.name, data.rating, data.userRatingCount, data.priceLevel, data.reviews, ...
      sendResponse({ ok: true, data });
    } catch (err) {
      // Any network/parse errors end up here
      const message = err && err.message ? err.message : String(err);
      sendResponse({ ok: false, error: message });
    }
  })();


  // IMPORTANT: return true to indicate we will send a response asynchronously.
  return true;
}); */



/* 
// === background.js (Manifest V3 service worker) ==========================

console.log('[BG] Service worker loaded');

// --- Utility: fetch with timeout using AbortController -------------------
async function fetchWithTimeout(resource, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resource, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Single listener that handles multiple message types
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || !msg.type) {
    // No response needed for junk messages
    return;
  }

  console.log('[BG] message:', msg.type);

  // Wrap each case in an IIFE and always return true at the end of the listener
  switch (msg.type) {
    case 'PLACE_INFO': {
      (async () => {
        try {
          const placeName = String(msg.placeName || '').trim();
          const lat = Number(msg.lat);
          const lng = Number(msg.lng);
          if (!placeName || Number.isNaN(lat) || Number.isNaN(lng)) {
            sendResponse({ ok: false, error: 'Missing or invalid placeName/lat/lng' });
            return;
          }

          const resp = await fetchWithTimeout(`${API_BASE}/api/restaurant-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: placeName, latitude: lat, longitude: lng })
          }, 15000);

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            sendResponse({ ok: false, error: `Backend error ${resp.status}${text ? `: ${text}` : ''}` });
            return;
          }

          const data = await resp.json();
          // console.log('[BG] /restaurant-info:', data);
          sendResponse({ ok: true, data });
        } catch (err) {
          const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || String(err));
          console.warn('[BG] PLACE_INFO failed:', msg);
          sendResponse({ ok: false, error: msg });
        }
      })();
      break;
    }

    case 'NEARBY_SCORES': {
      (async () => {
        try {
          const lat = Number(msg.lat);
          const lng = Number(msg.lng);
          const radius = Number(msg.radiusMeters || 800);
          const limit = Number(msg.limit || 12);
          if (Number.isNaN(lat) || Number.isNaN(lng)) {
            sendResponse({ ok: false, error: 'Missing or invalid lat/lng' });
            return;
          }

          const resp = await fetchWithTimeout(`${API_BASE}/api/nearby-scores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng, radiusMeters: radius, limit })
          }, 20000);

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            sendResponse({ ok: false, error: `Backend error ${resp.status}${text ? `: ${text}` : ''}` });
            return;
          }

          const data = await resp.json();
          // console.log('[BG] /nearby-scores:', data);
          sendResponse({ ok: true, data });
        } catch (err) {
          const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || String(err));
          console.warn('[BG] NEARBY_SCORES failed:', msg);
          sendResponse({ ok: false, error: msg });
        }
      })();
      break;
    }

    default: {
      // Unknown type — respond so the port doesn't hang
      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    }
  }

  // IMPORTANT: keep the message channel open for async sendResponse in all branches
  return true;
}); */

// === background.js (Manifest V3 service worker) ==========================
// Calls your Express server for:
// 1) Single place scoring:  POST /api/restaurant-info   (msg.type = "PLACE_INFO")
// 2) Area scan scoring:     POST /api/nearby-scores     (msg.type = "NEARBY_SCORES")
// ========================================================================

const API_BASE = 'http://localhost:8080'; // change if your server runs elsewhere

// --- Small helper: fetch with timeout (safer in service workers) --------
async function fetchWithTimeout(resource, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resource, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || !msg.type) {
    // Ignore junk; no response needed
    return;
  }

  // Handle different message types
  switch (msg.type) {
    // -------------------------------------------------------------------
    // When a user clicks/views a specific restaurant on Maps:
    // content.js sends: { type: 'PLACE_INFO', placeName, lat, lng }
    // We forward it to POST /api/restaurant-info and return the JSON.
    // (Your existing code already uses this shape.):contentReference[oaicite:1]{index=1}
    // -------------------------------------------------------------------
    case 'PLACE_INFO': {
      (async () => {
        try {
          const placeName = String(msg.placeName || '').trim();
          const lat = Number(msg.lat);
          const lng = Number(msg.lng);
          if (!placeName || Number.isNaN(lat) || Number.isNaN(lng)) {
            sendResponse({ ok: false, error: 'Missing or invalid placeName/lat/lng' });
            return;
          }

          const resp = await fetchWithTimeout(`${API_BASE}/api/restaurant-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: placeName, latitude: lat, longitude: lng })
          }, 15000);

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            sendResponse({ ok: false, error: `Backend error ${resp.status}${text ? `: ${text}` : ''}` });
            return;
          }

          const data = await resp.json();
          sendResponse({ ok: true, data });

        } catch (err) {
          const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || String(err));
          sendResponse({ ok: false, error: msg });
        }
      })();
      return true; // keep channel open for async sendResponse
    }

    // -------------------------------------------------------------------
    // Area scan: score multiple nearby restaurants around the map center.
    // content.js sends: { type: 'NEARBY_SCORES', lat, lng, radiusMeters?, limit? }
    // We forward it to POST /api/nearby-scores and return the JSON.
    // -------------------------------------------------------------------
    case 'NEARBY_SCORES': {
      (async () => {
        try {
          const lat = Number(msg.lat);
          const lng = Number(msg.lng);
          const radius = Number(msg.radiusMeters ?? 800);
          const limit = Number(msg.limit ?? 12);
          if (Number.isNaN(lat) || Number.isNaN(lng)) {
            sendResponse({ ok: false, error: 'Missing or invalid lat/lng' });
            return;
          }

          const resp = await fetchWithTimeout(`${API_BASE}/api/nearby-scores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng, radiusMeters: radius, limit })
          }, 20000);

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            sendResponse({ ok: false, error: `Backend error ${resp.status}${text ? `: ${text}` : ''}` });
            return;
          }

          const data = await resp.json();
          sendResponse({ ok: true, data });
        } catch (err) {
          const msg = err?.name === 'AbortError' ? 'Request timed out' : (err?.message || String(err));
          sendResponse({ ok: false, error: msg });
        }
      })();
      return true; // keep channel open for async sendResponse
    }

    default: {
      // Unknown message type
      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
      return; // no async work, no need to return true
    }
  }
});



