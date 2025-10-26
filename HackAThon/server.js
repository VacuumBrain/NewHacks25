import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());               // so your Chrome extension can call this API
app.use(express.json());

// --- Helpers -------------------------------------------------------------

const PLACES_BASE = 'https://places.googleapis.com/v1';

function normalizePriceLevel(priceLevel) {
  // Accept either the v1 enum string or a pre-normalized number
  if (typeof priceLevel === 'number') {
    return Math.max(0, Math.min(4, Math.floor(priceLevel))); // clamp 0..4
  }
  const map = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4
  };
  return map[priceLevel] ?? null; // return null if unknown/missing
}

/**
 * 1) Find the best-matching place near a lat/lng for a given name
 *    Uses Places Text Search (v1): POST /places:searchText
 */
async function searchPlaceByNameNear({ name, latitude, longitude, radiusMeters = 800 }) {
  const url = `${PLACES_BASE}/places:searchText`;

  const body = {
    textQuery: name,
    // Strongly bias results near your known coordinates
    locationBias: {
      circle: {
        center: { latitude, longitude },
        radius: radiusMeters
      }
    },
    // This narrows to restaurants; remove if you want broader matches
    includedType: 'restaurant',
    languageCode: 'en'
  };

  // Ask only for what you need to choose a match (keeps cost down)
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.userRatingCount'
  ].join(',');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TextSearch failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  const { places = [] } = data;

  if (!places.length) return null;

  // Choose the closest hit to the provided coordinates
  const withDistance = places.map(p => {
    const lat = p.location?.latitude ?? 0;
    const lng = p.location?.longitude ?? 0;
    const d =
      Math.hypot(latitude - lat, longitude - lng); // simple proxy; fine for small radii
    return { ...p, _distanceScore: d };
  });

  withDistance.sort((a, b) => a._distanceScore - b._distanceScore);
  return withDistance[0];
}

/**
 * 2) Fetch details & reviews for a place_id
 *    Uses Place Details (v1): GET /places/{place_id}
 */

async function getPlaceDetails(placeId) {
  const url = `${PLACES_BASE}/places/${encodeURIComponent(placeId)}?languageCode=en`;

  // IMPORTANT: In v1 you must ask for nested fields explicitly.
  // Request review text, rating, and publish time so we can score.
  const fieldMask = [
    'id',
    'displayName',
    'formattedAddress',
    'location',
    'rating',
    'userRatingCount',
    'priceLevel',
    'websiteUri',
    'internationalPhoneNumber',
    'regularOpeningHours',
    'types',
    'editorialSummary',
    'reviews',
    'reviews.rating',
    'reviews.publishTime',
    'reviews.text',
    'reviews.text.text',
    'reviews.text.languageCode'
  ].join(',');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': fieldMask
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PlaceDetails failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data; // place object with only the fields we asked for
}


// ---------- server.js additions (paste near top) ----------
const COUNTRY_TO_LANG = {
  // Keep this small & practical; expand as you like
  "United States": "en", "Canada": "en", "United Kingdom": "en", "Ireland": "en",
  "Australia": "en", "New Zealand": "en", "Singapore": "en",
  "France": "fr", "Belgium": "fr", "Switzerland": "fr",
  "Spain": "es", "Mexico": "es", "Argentina": "es", "Chile": "es", "Colombia": "es",
  "Germany": "de", "Austria": "de",
  "Italy": "it",
  "Portugal": "pt", "Brazil": "pt",
  "Japan": "ja",
  "China": "zh", "Taiwan": "zh", "Hong Kong": "zh",
  "South Korea": "ko"
};

// Extract a country token from the formatted address (last comma-separated token)
function countryFromAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  // Last token is usually the country name
  return parts[parts.length - 1];
}

function primaryLanguageForCountry(country) {
  return COUNTRY_TO_LANG[country] || 'en';
}

// Very small language guesser using common function words.
// This is crude but good enough for a demo without extra libs.
const LANG_HINTS = {
  en: [' the ', ' and ', ' my ', ' favourite ', ' favorite ', ' great ', ' good ', ' bad ', ' overpriced '],
  fr: [' le ', ' la ', ' les ', ' des ', ' et ', ' très ', ' cher ', ' favorite ', ' préféré '],
  es: [' el ', ' la ', ' los ', ' las ', ' y ', ' muy ', ' caro ', ' favorita ', ' preferido '],
  de: [' der ', ' die ', ' das ', ' und ', ' sehr ', ' teuer ', ' lieblings '],
  it: [' il ', ' la ', ' gli ', ' le ', ' e ', ' molto ', ' caro ', ' preferito '],
  pt: [' o ', ' a ', ' os ', ' as ', ' e ', ' muito ', ' caro ', ' favorito '],
  ja: ['です', 'ます', '美味', '高い'],
  zh: ['好吃', '非常', '太贵', '价格', '游客'],
  ko: ['좋아요', '매우', '비싸', '가격', '관광객']
};

function guessLanguage(text) {
  if (!text || typeof text !== 'string') return 'unknown';
  const t = ` ${text.toLowerCase()} `;
  let best = 'unknown', bestScore = 0;
  for (const [lang, hints] of Object.entries(LANG_HINTS)) {
    let s = 0;
    for (const h of hints) if (t.includes(h)) s++;
    if (s > bestScore) { bestScore = s; best = lang; }
  }
  return best;
}

// Keywords
const OVERPRICED_KEYWORDS = [
  'overpriced', 'rip off', 'rip-off', 'too expensive', 'pricey', 'service fees', 'overrated', 'not worth',
  'tourist prices', 'bait and switch', 'hidden fee', 'service charge', 'service fee', 'disappointing', 'disappointed'
];

const TOURISTY_KEYWORDS = [
  'touristy', 'tourist trap', 'lots of tourists', 'long line', 'long queue',
  'crowded', 'pushy', 'aggressive staff', 'by the attractions'
];

// Local-praise words per language (positive anti-trap)
const LOCAL_PRAISE = {
  en: ['favorite', 'favourite', 'go-to', 'our spot', 'neighbourhood favourite', 'neighborhood favorite'],
  fr: ['préféré', 'favori', 'notre endroit', 'du quartier'],
  es: ['favorito', 'de siempre', 'del barrio'],
  de: ['lieblings', 'stamm', 'im viertel'],
  it: ['preferito', 'del quartiere'],
  pt: ['favorito', 'do bairro'],
  ja: ['行きつけ', 'お気に入り'],
  zh: ['最喜欢', '常去'],
  ko: ['단골', '최애']
};

function containsAny(text, list) {
  const t = (text || '').toLowerCase();
  return list.reduce((acc, kw) => acc + (t.includes(kw) ? 1 : 0), 0);
}

// ---------- main scoring function ----------
function computeTouristTrapScore(details) {
  const rating = Number(details.rating ?? 0);
  const count = Number(details.userRatingCount ?? 0);
  const rawPriceLevel = details.priceLevel ?? null;       // enum string or null
const priceNum = normalizePriceLevel(rawPriceLevel);    // 0..4 or null
  const address = details.formattedAddress || '';
  const reviews = Array.isArray(details.reviews) ? details.reviews : [];

  // Country / local language
  const country = countryFromAddress(address);
  const localLang = primaryLanguageForCountry(country);

  // Review text blob + per-review language
  const texts = [];
  let localLangCount = 0;
  let localPraiseHits = 0;
  let overpricedHits = 0;
  let touristyHits = 0;

  for (const r of reviews) {
    // v1 reviews often have either { text: { text: '...' } } or just { text: '...' }
    const t = (r.text?.text ?? r.text ?? '').toString();
    if (!t) continue;
    texts.push(t);
    const lang = guessLanguage(t);
    if (lang === localLang) {
      localLangCount++;
      localPraiseHits += containsAny(t, LOCAL_PRAISE[localLang] || []);
    }
    overpricedHits += containsAny(t, OVERPRICED_KEYWORDS);
    touristyHits += containsAny(t, TOURISTY_KEYWORDS);
  }

  const totalReviewsInSample = reviews.length || 1;
  const localLangShare = localLangCount / totalReviewsInSample; // 0..1

  // --- scoring parts (0..100 total, soft weights because sample is small) ---
  let score = 0;

  // rating band (lower or middling with high volume is suspicious)
  if (rating > 0) {
    if (rating < 3.8) score += 18;
    else if (rating < 4.2) score += 8;
    else if (rating >= 4.6) score -= 8;
  }

  // review volume pressure (log-scaled; up to +18)
  const countNorm = Math.min(1, Math.log10(1 + count) / 4); // ~1 at 10,000 reviews
  score += Math.round(countNorm * 18);

  // price level (0..4) up to +16
  if (priceNum !== null) {
    score += Math.max(0, priceNum * 8);
  }

  // keyword signals (cap each to keep stability)
  score += Math.max(0, overpricedHits * 8);
  score += Math.max(0, touristyHits * 25);

  // local-language share (low share → more touristy); push towards 100 if very low
  // If localLangShare < 0.3, add up to +16; if > 0.7, subtract up to -10
  if (localLangShare < 0.3) score += 25;
  else if (localLangShare > 0.7) score -= -10;

  // local praise (anti-trap), up to -18
  score -= Math.max(30, localPraiseHits * 10);

  // clamp
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    components: {
      rating,
      userRatingCount: count,
      rawPriceLevel,          // e.g. "PRICE_LEVEL_MODERATE"
      priceLevelNum: priceNum, // 0..4, or null if unknown
      localLang,
      country,
      localLangShare: Number(localLangShare.toFixed(2)),
      overpricedHits,
      touristyHits,
      localPraiseHits
    }
  };
}

app.post('/api/restaurant-info', async (req, res) => {
  try {
    const { name, latitude, longitude } = req.body;
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }

    // Find the place nearby by name
    const match = await searchPlaceByNameNear({ name, latitude, longitude });
    if (!match) {
      return res.status(404).json({ error: 'Place not found nearby' });
    }

    // Get details + compute score
    const details = await getPlaceDetails(match.id);
    const { score, components } = computeTouristTrapScore(details);

    res.json({
      placeId: match.id,
      name: details.displayName?.text ?? name,
      rating: details.rating ?? match.rating ?? null,
      userRatingCount: details.userRatingCount ?? match.userRatingCount ?? null,
      priceLevel: details.priceLevel ?? match.priceLevel ?? null,
      formattedAddress: details.formattedAddress ?? match.formattedAddress ?? null,
      touristTrap: score,
      touristTrapComponents: components
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Nearby restaurant scan (multi-place mode)
// --- Nearby multi-restaurant scan ---------------------------------------
app.post('/api/nearby-scores', async (req, res) => {
  try {
    const { latitude, longitude, radiusMeters = 800, limit = 10 } = req.body;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'Missing or invalid coordinates' });
    }

    // 1) Nearby search (v1) – ask only for fields we need, including types
    const nearbyUrl = `${PLACES_BASE}/places:searchNearby`;
    const nearbyBody = {
      includedTypes: ['restaurant'],           // hard filter at source
      maxResultCount: limit,
      locationRestriction: {
        circle: {
          center: { latitude, longitude },
          radius: radiusMeters
        }
      },
      languageCode: 'en'
    };
    const fieldMask = [
      'places.id',
      'places.displayName',
      'places.location',
      'places.rating',
      'places.userRatingCount',
      'places.priceLevel',
      'places.types',                   // <-- include types
      'places.primaryType',             // <-- include primaryType
      'places.primaryTypeDisplayName'   // <-- include display name
    ].join(',');

    const nearbyRes = await fetch(nearbyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(nearbyBody)
    });

    if (!nearbyRes.ok) {
      const t = await nearbyRes.text().catch(() => '');
      throw new Error(`NearbySearch failed ${nearbyRes.status}: ${t}`);
    }

    const nearbyData = await nearbyRes.json();
    const places = Array.isArray(nearbyData.places) ? nearbyData.places : [];
    if (!places.length) return res.json({ count: 0, results: [] });

    // 2) Safety net: make sure we only keep restaurants
    const restaurantPlaces = places.filter(p => {
      const types = p.types || [];
      const primary = (p.primaryType || '').toLowerCase();
      const primaryText = (p.primaryTypeDisplayName?.text || '').toLowerCase();
      return (
        types.includes('restaurant') ||
        types.includes('food') ||
        primary === 'restaurant' ||
        primaryText.includes('restaurant')
      );
    });
    if (!restaurantPlaces.length) return res.json({ count: 0, results: [] });

    // 3) For each place, fetch details + score
    const results = [];
    for (const p of restaurantPlaces.slice(0, limit)) {
      try {
        const details = await getPlaceDetails(p.id);                  // you already have this helper
        const { score, components } = computeTouristTrapScore(details); // and this scorer

        results.push({
          placeId: p.id,
          name: details.displayName?.text ?? p.displayName?.text ?? 'Unknown',
          rating: details.rating ?? p.rating ?? null,
          userRatingCount: details.userRatingCount ?? p.userRatingCount ?? null,
          priceLevel: details.priceLevel ?? p.priceLevel ?? null,
          location: details.location ?? p.location ?? null,
          types: details.types ?? p.types ?? [],                      // include for clients
          primaryType: details.primaryType ?? p.primaryType ?? null,  // optional, informative
          touristTrap: score,
          touristTrapComponents: components
        });

        // Gentle throttle to avoid quota spikes
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        console.warn('Failed to score', p.id, err.message);
      }
    }

    res.json({ count: results.length, results });
  } catch (err) {
    console.error('nearby-scores error', err);
    res.status(500).json({ error: err.message });
  }
});


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});