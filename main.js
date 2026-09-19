const { execFile } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cachedYtDlpPath = null;
function resolveYtDlpPath(logger) {
  if (cachedYtDlpPath && (cachedYtDlpPath === 'yt-dlp' || fs.existsSync(cachedYtDlpPath))) {
    return cachedYtDlpPath;
  }

  // 1. Environment variable override
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    cachedYtDlpPath = process.env.YTDLP_PATH;
    return cachedYtDlpPath;
  }

  // 2. Cross-platform candidates
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        'D:\\yaktube_storage\\bin\\yt-dlp.exe',
        'C:\\laragon\\bin\\yt-dlp.exe',
        path.join(process.cwd(), 'bin', 'yt-dlp.exe'),
        'yt-dlp.exe'
      ]
    : [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        '/bin/yt-dlp',
        path.join(process.cwd(), 'bin', 'yt-dlp'),
        'yt-dlp'
      ];

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

let cachedChannels = null;
let channelsExpiresAt = 0;

async function getDefaultChannelId(category) {
  // Category mapping defaults
  const cat = String(category || '').toLowerCase();
  if (cat.includes('tekno') || cat.includes('tech') || cat.includes('egitim')) return '3299';
  if (cat.includes('podcast') || cat.includes('sohbet')) return '3298';
  if (cat.includes('genel') || cat.includes('haber')) return '1';
  if (cat.includes('muzik') || cat.includes('music')) return '1146';

  if (cachedChannels && Date.now() < channelsExpiresAt) {
    return cachedChannels.defaultId || '1146';
  }

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 9000,
        path: '/api/v1/accounts/yaktube/video-channels',
        method: 'GET',
        headers: { Host: 'yaktube.yakhub.com.tr' }
      },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && Array.isArray(data.data) && data.data.length > 0) {
              const musicCh = data.data.find(c => c.name && c.name.includes('muzik'));
              const defaultId = musicCh ? String(musicCh.id) : String(data.data[0].id);
              cachedChannels = { defaultId, list: data.data };
              channelsExpiresAt = Date.now() + 60 * 60 * 1000;
              return resolve(defaultId);
            }
          } catch (e) {}
          resolve('1146');
        });
      }
    );
    req.on('error', () => resolve('1146'));
    req.end();
  });
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

let cachedAdminToken = null;
let tokenExpiresAt = 0;

async function getAdminToken() {
  if (cachedAdminToken && Date.now() < tokenExpiresAt) {
    return cachedAdminToken;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 9000,
        path: '/api/v1/oauth-clients/local',
        method: 'GET',
        headers: { Host: 'yaktube.yakhub.com.tr' }
      },
      res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            const oauth = JSON.parse(body);
            const postData = new URLSearchParams({
              client_id: oauth.client_id,
              client_secret: oauth.client_secret,
              grant_type: 'password',
              username: 'yaktube',
              password: 'YakTubeAdmin2026!'
            }).toString();

            const tokenReq = http.request(
              {
                hostname: '127.0.0.1',
                port: 9000,
                path: '/api/v1/users/token',
                method: 'POST',
                headers: {
                  Host: 'yaktube.yakhub.com.tr',
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': Buffer.byteLength(postData)
                }
              },
              tokenRes => {
                let tokenBody = '';
                tokenRes.on('data', c => (tokenBody += c));
                tokenRes.on('end', () => {
                  try {
                    const tData = JSON.parse(tokenBody);
                    if (tData.access_token) {
                      cachedAdminToken = tData.access_token;
                      tokenExpiresAt = Date.now() + 3600 * 1000;
                      resolve(cachedAdminToken);
                    } else {
                      reject(new Error('No access_token: ' + tokenBody));
                    }
                  } catch (e) {
                    reject(e);
                  }
                });
              }
            );
            tokenReq.on('error', reject);
            tokenReq.write(postData);
            tokenReq.end();
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function register({ getRouter, peertubeHelpers, logger }) {
  const router = getRouter();
  const ytdlpPath = resolveYtDlpPath(logger);

  router.get('/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query || query.length < 2) {
      return res.json({ results: [] });
    }

    const cached = getCached(query);
    if (cached) {
      return res.json({ results: cached, cached: true });
    }

    const args = ['ytsearch6:' + query, '--dump-single-json', '--flat-playlist', '--skip-download', '--no-warnings'];

    execFile(ytdlpPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        if (logger) logger.error('YouTube search error: ' + error.message);
        return res.status(500).json({ error: 'Search failed', details: error.message });
      }

      try {
        const json = JSON.parse(stdout);
        const entries = json.entries || [];
        const results = entries
          .filter(e => e && e.id)
          .map(e => {
            const duration = e.duration || 0;
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60);
            const durationFormatted = (mins < 10 ? '0' + mins : mins) + ':' + (secs < 10 ? '0' + secs : secs);
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
              url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
              thumbnail
            };
          });

        setCache(query, results);
        return res.json({ results, cached: false });
      } catch (parseErr) {
        if (logger) logger.error('JSON parse error in search: ' + parseErr.message);
        return res.status(500).json({ error: 'Failed to parse search results' });
      }
    });
  });

  router.post('/import', async (req, res) => {
    const { targetUrl, channelId, category } = req.body;
    if (!targetUrl || (!targetUrl.includes('youtube.com') && !targetUrl.includes('youtu.be'))) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    try {
      const token = await getAdminToken();
      const resolvedChannelId = channelId ? String(channelId) : await getDefaultChannelId(category);
      const postData = new URLSearchParams({
        targetUrl: targetUrl,
        channelId: resolvedChannelId,
        privacy: '1'
      }).toString();

      const importReq = http.request(
        {
          hostname: '127.0.0.1',
          port: 9000,
          path: '/api/v1/videos/imports',
          method: 'POST',
          headers: {
            Host: 'yaktube.yakhub.com.tr',
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
  });

  router.get('/status/:id', async (req, res) => {
    const videoId = req.params.id;
    const reqVideo = http.request(
      {
        hostname: '127.0.0.1',
        port: 9000,
        path: '/api/v1/videos/' + encodeURIComponent(videoId),
        method: 'GET',
        headers: { Host: 'yaktube.yakhub.com.tr' }
      },
      resVideo => {
        let body = '';
        resVideo.on('data', c => (body += c));
        resVideo.on('end', () => {
          try {
            const video = JSON.parse(body);
            return res.json({
              id: video.id,
              uuid: video.uuid,
              shortUUID: video.shortUUID,
              name: video.name,
              state: video.state,
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
}

async function unregister() {}

module.exports = {
  register,
  unregister
};
