const { execFile } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cachedYtDlpPath = null;
function resolveYtDlpPath(logger, customPath) {
  if (customPath && String(customPath).trim() && fs.existsSync(String(customPath).trim())) {
    return String(customPath).trim();
  }

  if (cachedYtDlpPath && (cachedYtDlpPath === 'yt-dlp' || fs.existsSync(cachedYtDlpPath))) {
    return cachedYtDlpPath;
  }

  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    cachedYtDlpPath = process.env.YTDLP_PATH;
    return cachedYtDlpPath;
  }

  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        'D:\\yaktube_storage\\bin\\yt-dlp.exe',
        'C:\\laragon\\bin\\yt-dlp.exe',
        path.join(process.cwd(), 'bin', 'yt-dlp.exe'),
        'yt-dlp.exe'
      ]
    : ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', '/bin/yt-dlp', path.join(process.cwd(), 'bin', 'yt-dlp'), 'yt-dlp'];

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        cachedYtDlpPath = candidate;
        if (logger) logger.info(`[YakTube OnDemand] Auto-detected yt-dlp binary at: ${cachedYtDlpPath}`);
        return cachedYtDlpPath;
      }
    } catch (e) {}
  }

  cachedYtDlpPath = isWin ? 'D:\\yaktube_storage\\bin\\yt-dlp.exe' : 'yt-dlp';
  return cachedYtDlpPath;
}

function getCached(q) {
  const item = searchCache.get(q);
  if (item && Date.now() - item.time < CACHE_TTL) {
    return item.data;
  }
  return null;
}

function setCache(q, data) {
  searchCache.set(q, { time: Date.now(), data });
  if (searchCache.size > 200) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
}

function postInnerTubeJSON(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
        }
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function register({ getRouter, registerSetting, settingsManager, peertubeHelpers, logger }) {
  const router = getRouter();

  let guestImportLimit = 5;
  let customChannelId = '';
  let customYtDlpPath = '';

  if (typeof registerSetting === 'function') {
    registerSetting({
      name: 'guest-import-limit',
      label: 'Misafir Video İndirme Sınırı (Kota)',
      type: 'input',
      description:
        'Giriş yapmamış (misafir) kullanıcıların YouTube üzerinden sunucuya aktarabileceği maksimum video sayısı (Örn: 5). Sınır istemiyorsanız (sınırsız) 0 yazın.',
      private: false,
      default: '5'
    });

    registerSetting({
      name: 'default-channel-id',
      label: 'Varsayılan Video Kanalı ID (Opsiyonel)',
      type: 'input',
      description:
        'İndirilen videoların yükleneceği kanal ID numarası. Boş bırakılırsa sunucu yöneticisinin (Admin) ilk video kanalı otomatik seçilir.',
      private: false,
      default: ''
    });

    registerSetting({
      name: 'ytdlp-binary-path',
      label: 'yt-dlp Çalıştırılabilir Dosya Yolu (Opsiyonel)',
      type: 'input',
      description:
        'Özel yt-dlp dosya yolu (Örn: /usr/local/bin/yt-dlp). Boş bırakılırsa sistemde otomatik tespit edilir.',
      private: true,
      default: ''
    });
  }

  async function loadPluginSettings() {
    if (!settingsManager || typeof settingsManager.getSetting !== 'function') return;
    try {
      const val = await settingsManager.getSetting('guest-import-limit');
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const parsed = parseInt(String(val).trim(), 10);
        guestImportLimit = isNaN(parsed) || parsed < 0 ? 5 : parsed;
      } else {
        guestImportLimit = 5;
      }
    } catch (e) {}

    try {
      const chVal = await settingsManager.getSetting('default-channel-id');
      customChannelId = chVal ? String(chVal).trim() : '';
    } catch (e) {}

    try {
      const binVal = await settingsManager.getSetting('ytdlp-binary-path');
      customYtDlpPath = binVal ? String(binVal).trim() : '';
    } catch (e) {}
  }

  await loadPluginSettings();
  if (settingsManager && typeof settingsManager.onSettingsChange === 'function') {
    settingsManager.onSettingsChange(loadPluginSettings);
  }

  // Helper to run SQL queries via PeerTube's built-in Sequelize instance (works on ANY PeerTube server without bridge.js)
  async function dbQuery(sql, bindParams = []) {
    if (!peertubeHelpers || !peertubeHelpers.database || typeof peertubeHelpers.database.query !== 'function') {
      return [];
    }
    const res = await peertubeHelpers.database.query(sql, {
      bind: bindParams
    });
    if (Array.isArray(res) && Array.isArray(res[0])) {
      return res[0];
    }
    return Array.isArray(res) ? res : [];
  }

  // Helper to get local PeerTube HTTP connection details dynamically on any PeerTube instance
  function getLocalServerTarget() {
    let port = 9000;
    let hostHeader = 'localhost';
    try {
      if (peertubeHelpers && peertubeHelpers.config) {
        const listenCfg = peertubeHelpers.config.getServerListeningConfig();
        if (listenCfg && listenCfg.port) port = listenCfg.port;
        const webUrl = peertubeHelpers.config.getWebserverUrl();
        if (webUrl) {
          const parsed = new URL(webUrl);
          hostHeader = parsed.host;
        }
      }
    } catch (e) {}
    return { hostname: '127.0.0.1', port, hostHeader };
  }

  // Universal Admin OAuth Token Resolver (Zero hardcoded passwords - works on ANY PeerTube server via peertubeHelpers.database)
  let cachedAdminToken = null;
  let tokenExpiresAt = 0;

  async function getAdminToken() {
    if (cachedAdminToken && Date.now() < tokenExpiresAt) {
      return cachedAdminToken;
    }

    // 1. Check existing valid admin token in oAuthToken table
    try {
      const rows = await dbQuery(
        `SELECT t."accessToken"
         FROM "oAuthToken" t
         INNER JOIN "user" u ON u.id = t."userId"
         WHERE u.role = 0 AND t."accessTokenExpiresAt" > NOW() + INTERVAL '5 minutes'
         ORDER BY t."accessTokenExpiresAt" DESC
         LIMIT 1`
      );
      if (rows.length > 0 && rows[0].accessToken) {
        cachedAdminToken = rows[0].accessToken;
        tokenExpiresAt = Date.now() + 4 * 60 * 1000;
        return cachedAdminToken;
      }

      // 2. If no active admin token exists, mint one directly in oAuthToken for the administrator (role = 0)
      const admins = await dbQuery(`SELECT id FROM "user" WHERE role = 0 ORDER BY id ASC LIMIT 1`);
      const clients = await dbQuery(`SELECT id FROM "oAuthClient" ORDER BY id ASC LIMIT 1`);
      if (admins.length > 0 && clients.length > 0) {
        const accessToken = crypto.randomBytes(20).toString('hex');
        const refreshToken = crypto.randomBytes(20).toString('hex');
        await dbQuery(
          `INSERT INTO "oAuthToken" ("accessToken", "accessTokenExpiresAt", "refreshToken", "refreshTokenExpiresAt", "oAuthClientId", "userId", "createdAt", "updatedAt")
           VALUES ($1, NOW() + INTERVAL '7 days', $2, NOW() + INTERVAL '30 days', $3, $4, NOW(), NOW())`,
          [accessToken, refreshToken, clients[0].id, admins[0].id]
        );
        cachedAdminToken = accessToken;
        tokenExpiresAt = Date.now() + 30 * 60 * 1000;
        return cachedAdminToken;
      }
    } catch (err) {
      if (logger) logger.warn('[YakTube OnDemand] DB token lookup warning: ' + err.message);
    }

    throw new Error('Could not resolve or generate admin OAuth token');
  }

  // Universal Channel Resolver (Works on any PeerTube instance + smart category mapping)
  async function resolveTargetChannelId(title, explicitChannelId) {
    if (explicitChannelId) return String(explicitChannelId);
    if (customChannelId) return String(customChannelId);

    try {
      const channels = await dbQuery(
        `SELECT vc.id, vc.name, a."displayName"
         FROM "videoChannel" vc
         INNER JOIN "account" a ON vc."accountId" = a.id
         INNER JOIN "user" u ON a."userId" = u.id
         WHERE u.role = 0
         ORDER BY vc.id ASC`
      );

      if (channels.length > 0) {
        const t = String(title || '').toLowerCase();
        const findCh = keyword =>
          channels.find(
            c =>
              (c.name && c.name.toLowerCase().includes(keyword)) ||
              (c.displayName && c.displayName.toLowerCase().includes(keyword))
          );

        if (
          t.includes('podcast') ||
          t.includes('röportaj') ||
          t.includes('roportaj') ||
          t.includes('sohbet') ||
          t.includes('bölüm') ||
          t.includes('episode')
        ) {
          const podCh = findCh('podcast') || findCh('sohbet');
          if (podCh) return String(podCh.id);
        }

        if (
          t.includes('bitcoin') ||
          t.includes('kripto') ||
          t.includes('yazılım') ||
          t.includes('kodlama') ||
          t.includes('ders') ||
          t.includes('rehber') ||
          t.includes('tutorial') ||
          t.includes('teknoloji') ||
          t.includes('inceleme')
        ) {
          const techCh = findCh('tekno') || findCh('tech') || findCh('egitim');
          if (techCh) return String(techCh.id);
        }

        if (
          t.includes('müzik') ||
          t.includes('muzik') ||
          t.includes('music') ||
          t.includes('şarkı') ||
          t.includes('klip') ||
          t.includes('official') ||
          t.includes('feat') ||
          t.includes('remix') ||
          t.includes(' - ')
        ) {
          const musicCh = findCh('muzik') || findCh('müzik') || findCh('music');
          if (musicCh) return String(musicCh.id);
        }

        return String(channels[0].id);
      }
    } catch (e) {}

    return '1';
  }

  // Helper to check if request is from an authenticated PeerTube user
  async function isRequestAuthenticated(req, res, bodyAuthFlag) {
    if (bodyAuthFlag === true) return true;
    try {
      if (peertubeHelpers && peertubeHelpers.user && typeof peertubeHelpers.user.getAuthUser === 'function') {
        const u = await peertubeHelpers.user.getAuthUser(res);
        if (u) return true;
      }
    } catch (e) {}

    const authHeader = req.headers && req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const rows = await dbQuery(
            `SELECT id FROM "oAuthToken" WHERE "accessToken" = $1 AND "accessTokenExpiresAt" > NOW() LIMIT 1`,
            [token]
          );
          if (rows.length > 0) return true;
        } catch (e) {}
      }
    }
    return false;
  }

  // Helper to enrich YouTube results with existing local PeerTube videos via DB
  async function enrichResultsWithLocalStatus(results) {
    try {
      const imports = await dbQuery(
        `SELECT vi."targetUrl", v.id, v.uuid, v.name
         FROM "videoImport" vi
         INNER JOIN "video" v ON v.id = vi."videoId"
         WHERE vi."targetUrl" IS NOT NULL
         ORDER BY vi.id DESC
         LIMIT 200`
      );
      const localVideos = await dbQuery(
        `SELECT id, uuid, name
         FROM "video"
         WHERE remote = false AND state = 1
         ORDER BY id DESC
         LIMIT 200`
      );

      return results.map(item => {
        if (item.isLive) {
          return { ...item, isDownloaded: false };
        }

        const matchedImport = imports.find(imp => imp.targetUrl && item.id && imp.targetUrl.includes(item.id));
        if (matchedImport) {
          return {
            ...item,
            isDownloaded: true,
            localVideo: {
              id: matchedImport.id,
              uuid: matchedImport.uuid,
              name: matchedImport.name,
              url: '/videos/watch/' + matchedImport.uuid
            }
          };
        }

        const normalizedTitle = (item.title || '').toLowerCase().trim();
        const matchedLocal = localVideos.find(lv => {
          const lvName = (lv.name || '').toLowerCase().trim();
          return lvName === normalizedTitle || (lvName.length > 5 && normalizedTitle.includes(lvName));
        });

        if (matchedLocal) {
          return {
            ...item,
            isDownloaded: true,
            localVideo: {
              id: matchedLocal.id,
              uuid: matchedLocal.uuid,
              name: matchedLocal.name,
              url: '/videos/watch/' + matchedLocal.uuid
            }
          };
        }

        return { ...item, isDownloaded: false };
      });
    } catch (e) {
      return results;
    }
  }

  // 1. Quota Config Route
  router.get('/quota-config', async (_req, res) => {
    await loadPluginSettings();
    return res.json({ ok: true, guestImportLimit });
  });

  // 2. YouTube Search Route (aliases: /youtube-search and /search)
  async function handleYouTubeSearch(req, res) {
    await loadPluginSettings();
    const query = (req.query.q || '').trim();
    if (!query || query.length < 2) {
      return res.json({ results: [], guestImportLimit });
    }

    const cached = getCached(query);
    if (cached) {
      const enriched = await enrichResultsWithLocalStatus(cached);
      return res.json({ results: enriched, cached: true, guestImportLimit });
    }

    const ytdlpPath = resolveYtDlpPath(logger, customYtDlpPath);
    const args = ['ytsearch24:' + query, '--dump-single-json', '--flat-playlist', '--skip-download', '--no-warnings'];

    execFile(ytdlpPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }, async (error, stdout) => {
      if (error) {
        if (logger) logger.error('YouTube search error: ' + error.message);
        return res.status(500).json({ error: 'Search failed', details: error.message });
      }

      try {
        const rawStr = stdout.trim();
        const startIdx = rawStr.indexOf('{');
        const endIdx = rawStr.lastIndexOf('}');
        if (startIdx === -1 || endIdx === -1) {
          throw new Error('No JSON object found in output');
        }
        const json = JSON.parse(rawStr.substring(startIdx, endIdx + 1));
        const entries = json.entries || [];
        const rawResults = entries
          .filter(e => e && e.id)
          .map(e => {
            const duration = e.duration || 0;
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60);
            const isLive = e.is_live === true || e.live_status === 'is_live' || (!e.duration && e.was_live !== true);
            const durationFormatted = isLive
              ? 'CANLI'
              : (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
            let thumbnail =
              e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : '');
            if (!thumbnail && e.id) {
              thumbnail = `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`;
            }

            return {
              id: e.id,
              title: e.title,
              channel: e.uploader || e.channel || 'YouTube',
              duration,
              durationFormatted,
              isLive,
              url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
              thumbnail
            };
          });

        setCache(query, rawResults);
        const enrichedResults = await enrichResultsWithLocalStatus(rawResults);
        return res.json({ results: enrichedResults, cached: false, guestImportLimit });
      } catch (parseErr) {
        if (logger) logger.error('JSON parse error in search: ' + parseErr.message);
        return res.status(500).json({ error: 'Failed to parse search results' });
      }
    });
  }

  router.get('/youtube-search', handleYouTubeSearch);
  router.get('/search', handleYouTubeSearch);

  // 3. On-Demand Video Import Route (aliases: /ondemand-import and /import)
  async function handleOnDemandImport(req, res) {
    await loadPluginSettings();
    const { targetUrl, title, channelId, isAuthenticated, guestImportCount } = req.body || {};
    if (!targetUrl || (!targetUrl.includes('youtube.com') && !targetUrl.includes('youtu.be'))) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const isLoggedUser = await isRequestAuthenticated(req, res, isAuthenticated);
    if (!isLoggedUser && guestImportLimit > 0) {
      const clientCount = parseInt(String(guestImportCount || '0'), 10) || 0;
      if (clientCount >= guestImportLimit) {
        return res.status(429).json({
          ok: false,
          quotaExceeded: true,
          limit: guestImportLimit,
          error: 'Kota Doldu: Misafir video indirme sınırına ulaştınız. Lütfen giriş yapın.'
        });
      }
    }

    try {
      const token = await getAdminToken();
      const resolvedChannelId = await resolveTargetChannelId(title, channelId);
      const { hostname, port, hostHeader } = getLocalServerTarget();
      const postData = new URLSearchParams({
        targetUrl: targetUrl,
        channelId: resolvedChannelId,
        privacy: '1'
      }).toString();

      const importReq = http.request(
        {
          hostname,
          port,
          path: '/api/v1/videos/imports',
          method: 'POST',
          headers: {
            Host: hostHeader,
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        importRes => {
          let body = '';
          importRes.on('data', c => (body += c));
          importRes.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (data && data.video) {
                return res.json({
                  ok: true,
                  importId: data.id,
                  video: {
                    id: data.video.id,
                    uuid: data.video.uuid,
                    shortUUID: data.video.shortUUID,
                    name: data.video.name,
                    url: data.video.url
                  }
                });
              } else {
                return res.status(400).json({ error: 'Import initiation failed', details: data });
              }
            } catch (e) {
              return res.status(500).json({ error: 'Error parsing import response', raw: body });
            }
          });
        }
      );

      importReq.on('error', err => {
        return res.status(500).json({ error: 'HTTP error connecting to PeerTube API', details: err.message });
      });

      importReq.write(postData);
      importReq.end();
    } catch (err) {
      return res.status(500).json({ error: 'Admin authentication failed', details: err.message });
    }
  }

  router.post('/ondemand-import', handleOnDemandImport);
  router.post('/import', handleOnDemandImport);

  // 4. Video Import Status Polling Route
  router.get('/status/:id', async (req, res) => {
    const videoId = req.params.id;
    const { hostname, port, hostHeader } = getLocalServerTarget();
    const reqVideo = http.request(
      {
        hostname,
        port,
        path: '/api/v1/videos/' + encodeURIComponent(videoId),
        method: 'GET',
        headers: { Host: hostHeader }
      },
      resVideo => {
        let body = '';
        resVideo.on('data', c => (body += c));
        resVideo.on('end', () => {
          try {
            const video = JSON.parse(body);
            const isPublished = video.state && video.state.id === 1;
            const isTranscoding = video.state && video.state.id === 2;
            const isImporting = video.state && video.state.id === 3;
            const isFailed = video.state && video.state.id === 12;
            const hasFiles =
              (video.files && video.files.length > 0) ||
              (video.streamingPlaylists && video.streamingPlaylists.length > 0);

            return res.json({
              id: video.id,
              uuid: video.uuid,
              shortUUID: video.shortUUID,
              name: video.name,
              state: video.state,
              isPublished,
              isTranscoding,
              isImporting,
              isFailed,
              hasFiles,
              url: video.url,
              isLocal: video.isLocal
            });
          } catch (e) {
            return res.status(500).json({ error: 'Failed to parse video info' });
          }
        });
      }
    );

    reqVideo.on('error', e => res.status(500).json({ error: e.message }));
    reqVideo.end();
  });

  // 5. Live Stream HLS URL Extraction Route
  router.get('/live-stream-url', async (req, res) => {
    const target = (req.query.url || req.query.id || '').trim();
    if (!target) {
      return res.status(400).json({ error: 'Target URL is required' });
    }
    const ytdlpPath = resolveYtDlpPath(logger, customYtDlpPath);
    const fullUrl = target.startsWith('http') ? target : `https://www.youtube.com/watch?v=${target}`;
    execFile(ytdlpPath, ['-g', fullUrl], { timeout: 12000 }, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        return res
          .status(500)
          .json({ error: 'Could not extract live stream URL', details: err ? err.message : stderr });
      }
      const lines = stdout.trim().split(/\r?\n/);
      return res.json({
        ok: true,
        streamUrl: lines[0],
        isLive: true
      });
    });
  });

  // 6. Video YouTube Origin Detection Route
  router.get('/video-origin/:uuid', async (req, res) => {
    const uuid = (req.params.uuid || '').trim();
    if (!uuid) return res.status(400).json({ error: 'UUID required' });

    try {
      const rows = await dbQuery(
        `SELECT v.id, v.uuid, v.name, v.description, vi."targetUrl"
         FROM "video" v
         LEFT JOIN "videoImport" vi ON vi."videoId" = v.id
         WHERE v.uuid::text = $1 OR v."shortUUID" = $1 OR v.id::text = $1
         LIMIT 1`,
        [uuid]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Video not found' });
      }

      const row = rows[0];
      let youtubeId = null;

      if (row.targetUrl) {
        const match =
          row.targetUrl.match(/[?&]v=([^&]+)/) ||
          row.targetUrl.match(/youtu\.be\/([^?]+)/) ||
          row.targetUrl.match(/shorts\/([^?]+)/);
        if (match) youtubeId = match[1];
      }

      if (!youtubeId && row.description) {
        const match =
          row.description.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/) ||
          row.description.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
          row.description.match(/shorts\/([a-zA-Z0-9_-]{11})/);
        if (match) youtubeId = match[1];
      }

      return res.json({
        ok: true,
        hasYouTubeOrigin: !!youtubeId,
        youtubeId: youtubeId || null,
        targetUrl: row.targetUrl || null,
        title: row.name
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 7. YouTube Original Comments Route
  router.get('/youtube-comments', async (req, res) => {
    const videoId = (req.query.id || req.query.v || '').trim();
    const continuationToken = (req.query.token || '').trim();

    if (!videoId && !continuationToken) {
      return res.status(400).json({ error: 'Video ID or token is required' });
    }

    const baseContext = {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260220.00.00',
        hl: 'tr',
        gl: 'TR'
      }
    };

    try {
      let token = continuationToken;

      if (!token) {
        const initRes = await postInnerTubeJSON('https://www.youtube.com/youtubei/v1/next', {
          context: baseContext,
          videoId: videoId
        });

        const contents = initRes.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        const commentSection = contents.find(t => t.itemSectionRenderer?.targetId === 'comments-section');
        token =
          commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint
            ?.continuationCommand?.token;
      }

      if (!token) {
        return res.json({ ok: true, comments: [], nextToken: null, total: 0 });
      }

      const commentRes = await postInnerTubeJSON('https://www.youtube.com/youtubei/v1/next', {
        context: baseContext,
        continuation: token
      });

      const comments = [];
      const mutations = commentRes.frameworkUpdates?.entityBatchUpdate?.mutations || [];

      for (const m of mutations) {
        const payload = m.payload?.commentEntityPayload;
        if (payload) {
          const author = payload.author?.displayName || 'Kullanıcı';
          const authorThumb = payload.author?.avatar?.image?.sources?.[0]?.url || '';
          const content = payload.properties?.content?.content || '';
          const published = payload.properties?.publishedTime || '';
          const likeCount = payload.toolbar?.likeCountNotliked || '0';

          comments.push({
            id: payload.properties?.commentId,
            author,
            authorThumb,
            content,
            published,
            likeCount
          });
        }
      }

      let nextToken = null;
      const eps = commentRes.onResponseReceivedEndpoints || [];
      for (const ep of eps) {
        const items =
          ep.reloadContinuationItemsCommand?.continuationItems ||
          ep.appendContinuationItemsAction?.continuationItems ||
          [];
        for (const it of items) {
          if (it.continuationItemRenderer) {
            nextToken =
              it.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token ||
              it.continuationItemRenderer.button?.buttonRenderer?.command?.continuationCommand?.token;
          }
        }
      }

      return res.json({
        ok: true,
        comments,
        nextToken,
        count: comments.length
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch comments', details: err.message });
    }
  });

  // 8. User Search History Sync Route (Stores per-user history in plugin data directory on any PeerTube server)
  function getHistoryFilePath() {
    try {
      if (
        peertubeHelpers &&
        peertubeHelpers.plugin &&
        typeof peertubeHelpers.plugin.getDataDirectoryPath === 'function'
      ) {
        return path.join(peertubeHelpers.plugin.getDataDirectoryPath(), 'user-search-history.json');
      }
    } catch (e) {}
    return path.join(process.cwd(), 'user-search-history.json');
  }

  function readHistoryStore() {
    try {
      const fp = getHistoryFilePath();
      if (fs.existsSync(fp)) {
        return JSON.parse(fs.readFileSync(fp, 'utf8')) || {};
      }
    } catch (e) {}
    return {};
  }

  function writeHistoryStore(store) {
    try {
      const fp = getHistoryFilePath();
      fs.writeFileSync(fp, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {}
  }

  async function resolveHistoryUserKey(req, res) {
    try {
      if (peertubeHelpers && peertubeHelpers.user && typeof peertubeHelpers.user.getAuthUser === 'function') {
        const u = await peertubeHelpers.user.getAuthUser(res);
        if (u && (u.username || u.email || u.id)) {
          return String(u.username || u.email || u.id).toLowerCase();
        }
      }
    } catch (e) {}
    const hdrUser = (req.headers && (req.headers['x-user-username'] || req.headers['x-user-email'])) || '';
    return hdrUser ? String(hdrUser).trim().toLowerCase() : null;
  }

  router.all('/search-history', async (req, res) => {
    const userKey = await resolveHistoryUserKey(req, res);
    if (!userKey) {
      return res.json({ status: 'success', history: [] });
    }

    const store = readHistoryStore();
    const currentList = Array.isArray(store[userKey]) ? store[userKey] : [];

    if (req.method === 'GET') {
      return res.json({ status: 'success', history: currentList });
    }

    if (req.method === 'POST') {
      const q = ((req.body && req.body.query) || '').trim();
      if (q && q.length >= 2) {
        const filtered = currentList.filter(item => String(item).toLowerCase() !== q.toLowerCase());
        filtered.unshift(q);
        store[userKey] = filtered.slice(0, 12);
        writeHistoryStore(store);
      }
      return res.json({ status: 'success', history: store[userKey] || currentList });
    }

    if (req.method === 'DELETE') {
      delete store[userKey];
      writeHistoryStore(store);
      return res.json({ status: 'success', history: [] });
    }

    return res.json({ status: 'success', history: currentList });
  });
}

async function unregister() {}

module.exports = {
  register,
  unregister
};
