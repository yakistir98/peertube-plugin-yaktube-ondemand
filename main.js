const { execFile } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cachedYtDlpPath = null;
let cachedYtDlpCustomSetting = null;
let autoDownloadPromise = null;

function isExecutableFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 1024) return false;
    if (process.platform !== 'win32') {
      try {
        fs.accessSync(filePath, fs.constants.X_OK);
      } catch (_) {
        try {
          fs.chmodSync(filePath, 0o755);
        } catch (__) {}
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function discoverDynamicCandidatePaths(peertubeHelpers) {
  const isWin = process.platform === 'win32';
  const binNames = isWin ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp', 'yt-dlp_linux', 'yt-dlp_macos'];
  const searchDirs = new Set();

  function addWithParents(startDir, maxUp = 4) {
    if (!startDir || typeof startDir !== 'string') return;
    let cur = path.resolve(startDir);
    for (let i = 0; i <= maxUp; i++) {
      searchDirs.add(cur);
      searchDirs.add(path.join(cur, 'bin'));
      searchDirs.add(path.join(cur, 'storage', 'bin'));
      const parent = path.dirname(cur);
      if (!parent || parent === cur) break;
      cur = parent;
    }
  }

  // 1. PeerTube plugin data directory & its parent storage directory (e.g. /var/www/peertube/storage/bin/yt-dlp or /data/bin/yt-dlp)
  try {
    if (
      peertubeHelpers &&
      peertubeHelpers.plugin &&
      typeof peertubeHelpers.plugin.getDataDirectoryPath === 'function'
    ) {
      addWithParents(peertubeHelpers.plugin.getDataDirectoryPath(), 4);
    }
  } catch (e) {}

  // 2. Plugin installation directory (__dirname) & working directory (process.cwd())
  addWithParents(__dirname, 4);
  addWithParents(process.cwd(), 3);

  // 3. System PATH environment variable directories (pure Node.js `which` / `where` equivalent)
  const pathEnv = process.env.PATH || process.env.Path || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    const cleanDir = dir.trim();
    if (cleanDir) searchDirs.add(cleanDir);
  }

  // 4. Common Linux, Docker, macOS, and Windows binary locations
  if (isWin) {
    searchDirs.add('D:\\yaktube_storage\\bin');
    searchDirs.add('C:\\yaktube_storage\\bin');
    searchDirs.add('C:\\laragon\\bin');
    searchDirs.add('C:\\ProgramData\\chocolatey\\bin');
    if (process.env.LOCALAPPDATA) {
      searchDirs.add(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    }
    if (process.env.USERPROFILE) {
      searchDirs.add(path.join(process.env.USERPROFILE, 'scoop', 'shims'));
      searchDirs.add(path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'));
    }
  } else {
    searchDirs.add('/var/www/peertube/storage/bin');
    searchDirs.add('/var/lib/peertube/storage/bin');
    searchDirs.add('/data/bin');
    searchDirs.add('/usr/local/bin');
    searchDirs.add('/usr/bin');
    searchDirs.add('/bin');
    searchDirs.add('/snap/bin');
    searchDirs.add('/opt/homebrew/bin');
    searchDirs.add('/home/peertube/.local/bin');
    try {
      const home = os.homedir();
      if (home) searchDirs.add(path.join(home, '.local', 'bin'));
    } catch (e) {}
  }

  const candidates = [];
  for (const dir of searchDirs) {
    for (const bName of binNames) {
      candidates.push(path.join(dir, bName));
    }
  }
  return candidates;
}

function resolveYtDlpPath(logger, customPath, peertubeHelpers) {
  const cleanCustom = customPath ? String(customPath).trim() : '';
  if (cleanCustom && isExecutableFile(cleanCustom)) {
    if (cachedYtDlpPath !== cleanCustom) {
      cachedYtDlpPath = cleanCustom;
      cachedYtDlpCustomSetting = cleanCustom;
      if (logger) logger.info(`[YakTube OnDemand] Using custom configured yt-dlp binary at: ${cachedYtDlpPath}`);
    }
    return cachedYtDlpPath;
  }

  if (cachedYtDlpPath && cachedYtDlpCustomSetting === cleanCustom && isExecutableFile(cachedYtDlpPath)) {
    return cachedYtDlpPath;
  }

  if (process.env.YTDLP_PATH && isExecutableFile(process.env.YTDLP_PATH)) {
    cachedYtDlpPath = process.env.YTDLP_PATH;
    cachedYtDlpCustomSetting = cleanCustom;
    if (logger) logger.info(`[YakTube OnDemand] Using YTDLP_PATH binary at: ${cachedYtDlpPath}`);
    return cachedYtDlpPath;
  }

  const candidates = discoverDynamicCandidatePaths(peertubeHelpers);
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      cachedYtDlpPath = candidate;
      cachedYtDlpCustomSetting = cleanCustom;
      if (logger)
        logger.info(`[YakTube OnDemand] Auto-detected yt-dlp binary (${process.platform}) at: ${cachedYtDlpPath}`);
      return cachedYtDlpPath;
    }
  }

  // Trigger background auto-download if not found on disk yet
  ensureYtDlpBinaryDownloaded(logger, peertubeHelpers).catch(() => {});

  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function downloadFileFollowRedirects(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'YakTube-OnDemand-Plugin/1.7 (PeerTube)'
        },
        timeout: 60000
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(downloadFileFollowRedirects(nextUrl, destPath, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} when downloading yt-dlp`));
        }
        const tmpPath = `${destPath}.tmp-${process.pid}`;
        const fileStream = fs.createWriteStream(tmpPath, { mode: 0o755 });
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              if (process.platform !== 'win32') {
                fs.chmodSync(tmpPath, 0o755);
              }
              fs.renameSync(tmpPath, destPath);
              resolve(destPath);
            } catch (err) {
              reject(err);
            }
          });
        });
        fileStream.on('error', err => {
          try {
            fs.unlinkSync(tmpPath);
          } catch (_) {}
          reject(err);
        });
      }
    );
    req.on('error', reject);
  });
}

async function ensureYtDlpBinaryDownloaded(logger, peertubeHelpers) {
  if (autoDownloadPromise) return autoDownloadPromise;
  autoDownloadPromise = (async () => {
    try {
      const isWin = process.platform === 'win32';
      const isMac = process.platform === 'darwin';
      const assetName = isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : 'yt-dlp';
      const targetFileName = isWin ? 'yt-dlp.exe' : 'yt-dlp';

      let targetDir = path.join(__dirname, 'bin');
      try {
        if (
          peertubeHelpers &&
          peertubeHelpers.plugin &&
          typeof peertubeHelpers.plugin.getDataDirectoryPath === 'function'
        ) {
          targetDir = path.join(peertubeHelpers.plugin.getDataDirectoryPath(), 'bin');
        }
      } catch (e) {}

      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, targetFileName);
      if (isExecutableFile(targetPath)) {
        cachedYtDlpPath = targetPath;
        return targetPath;
      }

      const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
      if (logger) {
        logger.info(`[YakTube OnDemand] yt-dlp not found on system; auto-downloading ${assetName} to ${targetPath}...`);
      }
      await downloadFileFollowRedirects(downloadUrl, targetPath);
      if (isExecutableFile(targetPath)) {
        cachedYtDlpPath = targetPath;
        if (logger) logger.info(`[YakTube OnDemand] Successfully auto-installed yt-dlp at: ${targetPath}`);
        return targetPath;
      }
    } catch (e) {
      if (logger) logger.warn(`[YakTube OnDemand] Auto-download of yt-dlp warning: ${e.message}`);
    } finally {
      autoDownloadPromise = null;
    }
    return null;
  })();
  return autoDownloadPromise;
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

let pruneIntervalTimer = null;

const DEFAULT_BLOCKED_KEYWORDS = [
  'porn',
  'porno',
  'sex',
  'seksi',
  'sexy',
  'strip',
  'striptease',
  'bikini',
  'lingerie',
  'see-through',
  'sheer',
  'babydoll',
  'gravure',
  'bra',
  'plus-size bra',
  'try on',
  'try-on',
  'underwear',
  'panties',
  'thong',
  'cleavage',
  'twerk',
  'cameltoe',
  'nude',
  'nudes',
  'nudist',
  'erotik',
  'erotic',
  'erotizm',
  'çıplak',
  'ciplak',
  'soyunma',
  'soyun',
  'sikiş',
  'sikis',
  'amcık',
  'amcik',
  'yarak',
  'yarrak',
  'penis',
  'vagina',
  'vajina',
  'mastürbasyon',
  'masturbasyon',
  'adult',
  '+18',
  'nsfw',
  'xxx',
  'xvideos',
  'onlyfans',
  'sissy',
  'seduce',
  'seduces',
  'seducing',
  'seductress',
  'milf',
  'deepthroat',
  'blowjob',
  'anal',
  'hentai',
  'boob',
  'boobs',
  'uyuşturucu',
  'uyusturucu',
  'esrar',
  'kokain',
  'eroin',
  'bonzai',
  'bahis',
  'kumar',
  'bet',
  'casino'
];

function isContentBlocked(text, list = DEFAULT_BLOCKED_KEYWORDS) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase().replace(/['\"\-_\/\\.,;:\(\)\[\]#!\?]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);

  for (const item of list) {
    const target = item.trim().toLowerCase();
    if (!target) continue;
    if (target.includes(' ')) {
      if (clean.includes(target)) return true;
    } else {
      if (words.includes(target)) return true;
    }
  }
  return false;
}

async function register({ registerHook, getRouter, registerSetting, settingsManager, peertubeHelpers, logger }) {
  const router = getRouter();

  let guestImportLimit = 5;
  let maxDiskUsagePercent = 85;
  let yaknetSsoEnabled = true;
  let smartPrefetchMode = 'auto-when-no-local';
  let federatedRecommendationsMode = 'smart-relevant';
  let customChannelId = '';
  let customYtDlpPath = '';
  let safeSearchEnabled = true;
  let blockedKeywordsList = [...DEFAULT_BLOCKED_KEYWORDS];

  // YakTube Bildirim Filtresi & SafeSearch Video Listesi Filtresi
  if (typeof registerHook === 'function') {
    registerHook({
      target: 'filter:notifier.notification.enabled.result',
      handler: async (result, { notification }) => {
        if (notification && (notification.type === 7 || notification.type === 'my-video-import-success')) {
          return {
            webNotificationEnabled: false,
            emailNotificationEnabled: false
          };
        }
        return result;
      }
    });

    const filterVideoListResult = async result => {
      if (!safeSearchEnabled || !result || !Array.isArray(result.data)) return result;
      const beforeLen = result.data.length;
      result.data = result.data.filter(v => !v || !isContentBlocked(v.name || '', blockedKeywordsList));
      const diff = beforeLen - result.data.length;
      if (diff > 0 && typeof result.total === 'number') {
        result.total = Math.max(0, result.total - diff);
      }
      return result;
    };

    registerHook({
      target: 'filter:api.videos.list.result',
      handler: filterVideoListResult
    });

    registerHook({
      target: 'filter:api.overviews.videos.list.result',
      handler: filterVideoListResult
    });

    if (logger) logger.info('[YakTube OnDemand] Registered notification filter & SafeSearch video list hooks.');
  }

  if (typeof registerSetting === 'function') {
    registerSetting({
      name: 'enable-yaknet-sso',
      label: 'YakNet SSO ve Merkezi Hesap Entegrasyonu',
      type: 'select',
      options: [
        { label: 'Açık (Resmi YakNet Giriş & Hesap Entegrasyonu)', value: 'true' },
        { label: 'Kapalı (Standart Bağımsız PeerTube Girişi)', value: 'false' }
      ],
      description:
        'YakNet SSO ile tek tıkla oturum açma, YakNet hesap kartı ve merkezi arama geçmişi eşitlemesini etkinleştirir. Bu özelliği kullanmak için peertube-plugin-auth-yaknet eklentisinin de kurulu olması önerilir. Kapatıldığında platform standart bağımsız PeerTube hesap sistemiyle çalışır.',
      private: false,
      default: 'true'
    });

    registerSetting({
      name: 'smart-prefetch-mode',
      label: 'Akıllı Arka Plan Öneri Hazırlama (Smart Pre-Fetch)',
      type: 'select',
      options: [
        {
          label: 'Otomatik (Önerilen — Yerel benzer video yoksa en alakalı 1. öneriyi arka planda hazırla)',
          value: 'auto-when-no-local'
        },
        {
          label: 'Her Zaman (İzlenen her videoda en alakalı 1. YouTube önerisini arka planda hazırla)',
          value: 'always'
        },
        {
          label: 'Kapalı (Sadece kullanıcı İndir ve İzle butonuna tıkladığında aktar)',
          value: 'disabled'
        }
      ],
      description:
        'İzleyici bir videoyu en az 25 saniye izlediğinde, sunucuda o konuyla ilgili yerel video yoksa en alakalı 1. YouTube önerisini arka planda sessizce hazırlar. Böylece video bittiğinde alakasız videolar yerine doğrudan ilgili içerik kesintisiz oynatılır. Sunucu kaynaklarını korumak isteyen yöneticiler bu ayarı kapatabilir.',
      private: false,
      default: 'auto-when-no-local'
    });

    registerSetting({
      name: 'federated-recommendations-mode',
      label: 'Fediverse (Diğer PeerTube Sunucuları) Öneri Görünümü',
      type: 'select',
      options: [
        {
          label:
            'Akıllı Alaka Süzgeci (Önerilen — Konuyla ve geçmişle alakalı Fediverse videolarını 🌐 rozetiyle önerilere dahil et, diğerlerini açılır buton altında tut)',
          value: 'smart-relevant'
        },
        {
          label:
            'Tam Açık (Akıllı önerilerin altında PeerTube standart Fediverse öneri listesini de her zaman açık bırak)',
          value: 'show-all'
        },
        {
          label: 'Kapalı (Önerilerde yalnızca bu sunucudaki yerel videoları ve YouTube sonuçlarını göster)',
          value: 'disabled'
        }
      ],
      description:
        'İzleme sayfasındaki önerilerde Fediverse (diğer PeerTube sunucularından gelen federe videolar) içeriklerinin nasıl sunulacağını belirler. Varsayılan "Akıllı Alaka Süzgeci" modu Fediverse videolarını engellemez; izlenen videoyla, dille veya kullanıcı geçmişiyle alakalı olan Fediverse videolarını "🌐 Fediverse\'de İzle" rozetiyle doğrudan önerilere dahil eder, alakasız/yabancı yayınları ise isteğe bağlı "🌐 Fediverse Ağındaki Diğer Videoları Göster" çekmecesi altında toplar.',
      private: false,
      default: 'smart-relevant'
    });

    registerSetting({
      name: 'safe-search-enabled',
      label: 'Güvenli Okul & Aile Araması (SafeSearch)',
      type: 'select',
      options: [
        { label: 'Açık (Önerilen - Katı Çocuk ve Aile Filtresi)', value: 'true' },
        { label: 'Kapalı (Filtresiz)', value: 'false' }
      ],
      description: 'Açık olduğunda arama sonuçlarında katı çocuk ve aile güvenliği filtresi uygulanır.',
      private: false,
      default: 'true'
    });

    registerSetting({
      name: 'blocked-keywords',
      label: 'Yasaklı / Filtrelenecek Kelimeler (Çocuk & Aile Güvenliği)',
      type: 'input-textarea',
      description:
        'Arama ve video aktarma işlemlerinde filtrelenecek anahtar kelimeler listesi. Virgülle veya alt alta yazabilirsiniz. Bu kelimeleri içeren aramalar engellenir ve uygunsuz videolar sisteme aktarılamaz.',
      private: false,
      default: DEFAULT_BLOCKED_KEYWORDS.join(', ')
    });

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
      name: 'max-disk-usage-percent',
      label: 'Otomatik Disk Temizleme Sınırı (%)',
      type: 'input',
      description:
        'Sunucu diski bu doluluk yüzdesine (Örn: 85) ulaştığında, en eski ve en az izlenen videolar otomatik olarak silinerek yer açılır. Otomatik silmeyi kapatmak için 0 yazın.',
      private: false,
      default: '85'
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

    registerSetting({
      name: 'home-categories',
      label: 'Ana Sayfa Kategori Çipleri (YouTube Tarzı)',
      type: 'input-textarea',
      description:
        'Ana sayfada video ızgarasının üstünde gösterilecek kategori butonlarını düzenleyin, silin veya yenilerini ekleyin. Virgülle veya alt alta yazabilirsiniz (Örn: Tümü, Müzik, Oyun, Canlı, Rap yapma, Evcil hayvanlar, Komedi skeç gösterileri, Doğa, Futbol, Son yüklenenler, İzlenenler, Yeni öneriler).',
      private: false,
      default:
        'Tümü, Müzik, Oyun, Canlı, Rap yapma, Evcil hayvanlar, Komedi skeç gösterileri, Doğa, Futbol, Son yüklenenler, İzlenenler, Yeni öneriler'
    });
  }

  let rawHomeCategories =
    'Tümü, Müzik, Oyun, Canlı, Rap yapma, Evcil hayvanlar, Komedi skeç gösterileri, Doğa, Futbol, Son yüklenenler, İzlenenler, Yeni öneriler';
  let parsedHomeCategories = [];

  function parseHomeCategories(str) {
    if (!str || typeof str !== 'string' || str.trim() === '') {
      str =
        'Tümü, Müzik, Oyun, Canlı, Rap yapma, Evcil hayvanlar, Komedi skeç gösterileri, Doğa, Futbol, Son yüklenenler, İzlenenler, Yeni öneriler';
    }
    const lines = str
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const result = [];

    const categoryMap = {
      müzik: 1,
      music: 1,
      film: 2,
      filmler: 2,
      films: 2,
      sinema: 2,
      cinema: 2,
      araçlar: 3,
      otomotiv: 3,
      arabalar: 3,
      vehicles: 3,
      cars: 3,
      sanat: 4,
      art: 4,
      spor: 5,
      sports: 5,
      futbol: 5,
      football: 5,
      seyahat: 6,
      gezi: 6,
      travel: 6,
      travels: 6,
      doğa: 6,
      doga: 6,
      oyun: 7,
      oyunlar: 7,
      gaming: 7,
      games: 7,
      insanlar: 8,
      blog: 8,
      vlog: 8,
      people: 8,
      komedi: 9,
      mizah: 9,
      comedy: 9,
      funny: 9,
      'komedi skeç gösterileri': 9,
      'komedi skeç': 9,
      'komedi skeçleri': 9,
      skeç: 9,
      eğlence: 10,
      eglence: 10,
      entertainment: 10,
      haberler: 11,
      haber: 11,
      gündem: 11,
      siyaset: 11,
      politika: 11,
      news: 11,
      'nasıl yapılır': 12,
      'pratik bilgiler': 12,
      'how to': 12,
      howto: 12,
      eğitim: 13,
      egitim: 13,
      ders: 13,
      education: 13,
      aktivizm: 14,
      activism: 14,
      bilim: 15,
      teknoloji: 15,
      'bilim ve teknoloji': 15,
      'bilim & teknoloji': 15,
      science: 15,
      technology: 15,
      yazılım: 15,
      hayvanlar: 16,
      'evcil hayvanlar': 16,
      evcil: 16,
      animals: 16,
      pets: 16,
      çocuklar: 17,
      çocuk: 17,
      kids: 17,
      yemek: 18,
      mutfak: 18,
      food: 18,
      cooking: 18
    };

    for (const item of lines) {
      const lower = item.toLocaleLowerCase('tr').replace(/i\u0307/g, 'i');
      if (lower === 'tümü' || lower === 'all' || lower === 'hepsi') {
        result.push({
          label: item,
          key: 'all',
          url: '/videos/browse'
        });
        continue;
      }

      if (item.includes(':')) {
        const parts = item.split(':');
        const label = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        if (/^\d+$/.test(val)) {
          result.push({
            label,
            key: 'cat_' + val,
            url: `/videos/browse?categoryOneOf=${val}`
          });
        } else if (val === 'live' || val === 'isLive') {
          result.push({
            label,
            key: 'live',
            url: '/videos/browse?isLive=true'
          });
        } else if (val.startsWith('sort=')) {
          const sVal = val.split('=')[1];
          const cleanKey = sVal.replace(/^-/, '');
          result.push({
            label,
            key: 'sort_' + cleanKey,
            url: `/videos/browse?${val}`
          });
        } else if (val.startsWith('search=')) {
          result.push({
            label,
            key: 'search_' + val.split('=')[1],
            url: `/search?search=${encodeURIComponent(val.split('=')[1])}`
          });
        } else {
          result.push({
            label,
            key: 'search_' + val,
            url: `/search?search=${encodeURIComponent(val)}`
          });
        }
        continue;
      }

      if (lower === 'canlı' || lower === 'canlı yayın' || lower === 'canlı yayınlar' || lower === 'live') {
        result.push({
          label: item,
          key: 'live',
          url: '/videos/browse?isLive=true'
        });
      } else if (lower === 'son yüklenenler' || lower === 'son yuklenenler' || lower === 'en yeniler') {
        result.push({
          label: item,
          key: 'sort_publishedAt',
          url: '/videos/browse?sort=-publishedAt'
        });
      } else if (
        lower === 'izlenenler' ||
        lower === 'en çok izlenenler' ||
        lower === 'en cok izlenenler' ||
        lower === 'popüler' ||
        lower === 'populer'
      ) {
        result.push({
          label: item,
          key: 'sort_views',
          url: '/videos/browse?sort=-views'
        });
      } else if (
        lower === 'yeni öneriler' ||
        lower === 'yeni oneriler' ||
        lower === 'öneriler' ||
        lower === 'oneriler' ||
        lower === 'trendler' ||
        lower === 'popülerler'
      ) {
        result.push({
          label: item,
          key: 'sort_hot',
          url: '/videos/browse?sort=-hot'
        });
      } else if (lower === 'rap yapma' || lower === 'rap') {
        result.push({
          label: item,
          key: 'search_rap',
          url: '/search?search=rap'
        });
      } else if (lower === 'mixler' || lower === "mix'ler" || lower === 'mix') {
        result.push({
          label: item,
          key: 'search_mix',
          url: '/search?search=mix'
        });
      } else if (lower === 'podcastler' || lower === "podcast'ler" || lower === 'podcast') {
        result.push({
          label: item,
          key: 'search_podcast',
          url: '/search?search=podcast'
        });
      } else if (categoryMap[lower] !== undefined) {
        const catId = categoryMap[lower];
        result.push({
          label: item,
          key: 'cat_' + catId,
          url: `/videos/browse?categoryOneOf=${catId}`
        });
      } else {
        result.push({
          label: item,
          key: 'search_' + lower.replace(/[^a-z0-9_-]/gi, '_'),
          url: `/search?search=${encodeURIComponent(item)}`
        });
      }
    }

    return result;
  }
  parsedHomeCategories = parseHomeCategories(rawHomeCategories);

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
      const diskVal = await settingsManager.getSetting('max-disk-usage-percent');
      if (diskVal !== undefined && diskVal !== null && String(diskVal).trim() !== '') {
        const parsedDisk = parseInt(String(diskVal).trim(), 10);
        maxDiskUsagePercent = isNaN(parsedDisk) || parsedDisk < 0 ? 85 : Math.min(99, parsedDisk);
      } else {
        maxDiskUsagePercent = 85;
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

    try {
      const catsVal = await settingsManager.getSetting('home-categories');
      if (catsVal !== undefined && catsVal !== null && String(catsVal).trim() !== '') {
        rawHomeCategories = String(catsVal).trim();
      } else {
        rawHomeCategories =
          'Tümü, Müzik, Oyun, Canlı, Rap yapma, Evcil hayvanlar, Komedi skeç gösterileri, Doğa, Futbol, Son yüklenenler, İzlenenler, Yeni öneriler';
      }
      parsedHomeCategories = parseHomeCategories(rawHomeCategories);
    } catch (e) {}

    try {
      const ssoVal = await settingsManager.getSetting('enable-yaknet-sso');
      if (ssoVal !== undefined && ssoVal !== null) {
        yaknetSsoEnabled = String(ssoVal).trim() !== 'false';
      } else {
        yaknetSsoEnabled = true;
      }
    } catch (e) {}

    try {
      const pfVal = await settingsManager.getSetting('smart-prefetch-mode');
      if (pfVal && ['auto-when-no-local', 'always', 'disabled'].includes(String(pfVal).trim())) {
        smartPrefetchMode = String(pfVal).trim();
      } else {
        smartPrefetchMode = 'auto-when-no-local';
      }
    } catch (e) {}

    try {
      const fedVal = await settingsManager.getSetting('federated-recommendations-mode');
      if (fedVal && ['smart-relevant', 'show-all', 'disabled'].includes(String(fedVal).trim())) {
        federatedRecommendationsMode = String(fedVal).trim();
      } else {
        federatedRecommendationsMode = 'smart-relevant';
      }
    } catch (e) {}

    try {
      const safeVal = await settingsManager.getSetting('safe-search-enabled');
      if (safeVal !== undefined && safeVal !== null) {
        safeSearchEnabled = String(safeVal).trim() !== 'false';
      }
    } catch (e) {}

    try {
      const wordsVal = await settingsManager.getSetting('blocked-keywords');
      if (wordsVal && typeof wordsVal === 'string' && wordsVal.trim() !== '') {
        const list = wordsVal
          .split(/[\n,]+/)
          .map(w => w.trim().toLowerCase())
          .filter(Boolean);
        if (list.length > 0) {
          blockedKeywordsList = Array.from(new Set([...DEFAULT_BLOCKED_KEYWORDS, ...list]));
        }
      } else {
        blockedKeywordsList = [...DEFAULT_BLOCKED_KEYWORDS];
      }
    } catch (e) {}
  }

  await loadPluginSettings();
  if (settingsManager && typeof settingsManager.onSettingsChange === 'function') {
    settingsManager.onSettingsChange(loadPluginSettings);
  }
  resolveYtDlpPath(logger, customYtDlpPath, peertubeHelpers);

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

  function normalizeTitleForMatch(str) {
    if (!str) return '';
    return String(str)
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/\s*[\(\[](official|video|music|audio|clip|4k|hd|lyrics|sözleri|visualizer)[^\)\]]*[\)\]]/gi, '')
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('tr');
  }

  // Helper to enrich YouTube results with existing local PeerTube videos via DB
  async function enrichResultsWithLocalStatus(results) {
    try {
      const imports = await dbQuery(
        `SELECT vi."targetUrl", v.id, v.uuid, v.name
         FROM "videoImport" vi
         INNER JOIN "video" v ON v.id = vi."videoId"
         WHERE vi."targetUrl" IS NOT NULL
           AND v.state = 1
           AND (vi.state IS NULL OR vi.state != 3)
         ORDER BY vi.id DESC`
      );
      const localVideos = await dbQuery(
        `SELECT id, uuid, name
         FROM "video"
         WHERE remote = false AND state = 1
         ORDER BY id DESC`
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

        const rawItemTitle = (item.title || '').toLowerCase().trim();
        const normItemTitle = normalizeTitleForMatch(item.title);

        const matchedLocal = localVideos.find(lv => {
          const rawLv = (lv.name || '').toLowerCase().trim();
          if (rawLv === rawItemTitle) return true;
          const normLv = normalizeTitleForMatch(lv.name);
          return (
            normLv &&
            (normLv === normItemTitle ||
              (normLv.length > 5 && (normItemTitle.includes(normLv) || normLv.includes(normItemTitle))))
          );
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

  // Universal Disk Storage & Auto-Pruner (Works on ANY PeerTube server without bridge.js)
  const MIN_FREE_GB = 25;
  const MIN_VIDEO_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function getStorageCheckPath() {
    try {
      if (
        peertubeHelpers &&
        peertubeHelpers.plugin &&
        typeof peertubeHelpers.plugin.getDataDirectoryPath === 'function'
      ) {
        let dir = peertubeHelpers.plugin.getDataDirectoryPath();
        while (dir && dir !== path.dirname(dir)) {
          if (fs.existsSync(dir)) return dir;
          dir = path.dirname(dir);
        }
      }
    } catch (e) {}
    if (process.platform === 'win32' && fs.existsSync('D:\\yaktube_storage')) {
      return 'D:\\';
    }
    return process.cwd();
  }

  async function getStorageStats() {
    await loadPluginSettings();
    const checkPath = getStorageCheckPath();
    return new Promise((resolve, reject) => {
      fs.statfs(checkPath, (err, stats) => {
        if (err) return reject(err);
        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes = stats.bfree * stats.bsize;
        const usedBytes = totalBytes - freeBytes;
        const totalGB = totalBytes / (1024 * 1024 * 1024);
        const freeGB = freeBytes / (1024 * 1024 * 1024);
        const usedGB = usedBytes / (1024 * 1024 * 1024);
        const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
        const isLowSpace = maxDiskUsagePercent > 0 && (usedPercent >= maxDiskUsagePercent || freeGB < MIN_FREE_GB);
        resolve({
          totalBytes,
          freeBytes,
          usedBytes,
          totalGB: Number(totalGB.toFixed(2)),
          freeGB: Number(freeGB.toFixed(2)),
          usedGB: Number(usedGB.toFixed(2)),
          usedPercent: Number(usedPercent.toFixed(1)),
          maxDiskUsagePercent,
          isLowSpace
        });
      });
    });
  }

  async function checkAndPruneStorage() {
    try {
      let stats = await getStorageStats();
      if (maxDiskUsagePercent <= 0) {
        return { pruned: 0, freedGB: 0, status: 'Auto-pruning disabled (max-disk-usage-percent = 0)' };
      }
      if (!stats.isLowSpace) {
        return {
          pruned: 0,
          freedGB: 0,
          status: `Disk space healthy (${stats.freeGB} GB free, ${stats.usedPercent}% used, limit: ${maxDiskUsagePercent}%)`
        };
      }

      const targetPercent = Math.max(10, maxDiskUsagePercent - 10);
      if (logger) {
        logger.info(
          `[YakTube Auto-Pruner] Low disk space detected! Used: ${stats.usedPercent}% (Limit: ${maxDiskUsagePercent}%), Free: ${stats.freeGB} GB. Starting cleanup...`
        );
      }

      const token = await getAdminToken();
      const { hostname, port, hostHeader } = getLocalServerTarget();
      const vids = await dbQuery(
        `SELECT id, uuid, name, views, "createdAt"
         FROM "video"
         WHERE remote = false
         ORDER BY views ASC, "createdAt" ASC
         LIMIT 100`
      );

      const now = Date.now();
      let prunedCount = 0;

      for (const vid of vids) {
        const createdAt = new Date(vid.createdAt).getTime();
        if (now - createdAt < MIN_VIDEO_AGE_MS) {
          continue;
        }

        if (logger) {
          logger.info(`[YakTube Auto-Pruner] Pruning unused video: "${vid.name}" (ID: ${vid.id}, Views: ${vid.views})`);
        }

        await new Promise(resolve => {
          const delReq = http.request(
            {
              hostname,
              port,
              path: '/api/v1/videos/' + vid.id,
              method: 'DELETE',
              headers: {
                Host: hostHeader,
                Authorization: 'Bearer ' + token
              }
            },
            delRes => {
              delRes.on('data', () => {});
              delRes.on('end', resolve);
            }
          );
          delReq.on('error', resolve);
          delReq.end();
        });

        prunedCount++;
        stats = await getStorageStats();
        if (stats.usedPercent <= targetPercent && stats.freeGB >= MIN_FREE_GB) {
          if (logger) {
            logger.info(
              `[YakTube Auto-Pruner] Target disk space reached (${stats.usedPercent}% used). Pruning completed.`
            );
          }
          break;
        }
      }

      return { pruned: prunedCount, status: 'Pruning completed', currentStats: stats };
    } catch (err) {
      if (logger) logger.error('[YakTube Auto-Pruner] Error during prune check: ' + err.message);
      return { error: err.message };
    }
  }

  if (pruneIntervalTimer) clearInterval(pruneIntervalTimer);
  pruneIntervalTimer = setInterval(
    () => {
      checkAndPruneStorage().catch(() => {});
    },
    4 * 60 * 60 * 1000
  );

  // 1. Quota, Categories & Storage Config Routes
  router.get('/quota-config', async (_req, res) => {
    await loadPluginSettings();
    return res.json({
      ok: true,
      yaknetSsoEnabled,
      smartPrefetchMode,
      federatedRecommendationsMode,
      guestImportLimit,
      maxDiskUsagePercent,
      safeSearchEnabled,
      blockedKeywords: blockedKeywordsList,
      categories: parsedHomeCategories
    });
  });

  router.get('/categories-config', async (_req, res) => {
    await loadPluginSettings();
    return res.json({
      ok: true,
      raw: rawHomeCategories,
      categories: parsedHomeCategories
    });
  });

  router.get('/storage-status', async (_req, res) => {
    try {
      const stats = await getStorageStats();
      return res.json({
        ok: true,
        stats,
        policy: {
          maxUsagePercent: maxDiskUsagePercent,
          targetUsagePercent: maxDiskUsagePercent > 0 ? Math.max(10, maxDiskUsagePercent - 10) : 0,
          minFreeGB: MIN_FREE_GB,
          gracePeriodDays: 7
        }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  router.post('/prune-check', async (_req, res) => {
    const result = await checkAndPruneStorage();
    return res.json(result);
  });

  // Reusable YouTube Raw Search Helper (with Cache & SafeSearch)
  function searchYouTubeRaw(query, maxCount = 24) {
    return new Promise((resolve, reject) => {
      const cleanQ = (query || '').trim();
      if (!cleanQ || cleanQ.length < 2) return resolve({ results: [], cached: false });
      if (safeSearchEnabled && isContentBlocked(cleanQ, blockedKeywordsList)) {
        return resolve({ results: [], cached: false, blocked: true });
      }

      const cacheKey = `${cleanQ.toLocaleLowerCase('tr')}__${maxCount}`;
      const cached = getCached(cacheKey) || (maxCount <= 24 ? getCached(cleanQ) : null);
      if (cached) {
        const filteredCached = safeSearchEnabled
          ? cached.filter(e => !isContentBlocked(e.title, blockedKeywordsList))
          : cached;
        return resolve({ results: filteredCached.slice(0, maxCount), cached: true });
      }

      const ytdlpPath = resolveYtDlpPath(logger, customYtDlpPath, peertubeHelpers);
      const args = [
        `ytsearch${maxCount}:${cleanQ}`,
        '--dump-single-json',
        '--flat-playlist',
        '--skip-download',
        '--no-warnings'
      ];

      execFile(ytdlpPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }, (error, stdout) => {
        if (error) {
          return reject(error);
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
          let rawResults = entries
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

          if (safeSearchEnabled) {
            rawResults = rawResults.filter(e => !isContentBlocked(e.title, blockedKeywordsList));
          }

          setCache(cacheKey, rawResults);
          if (maxCount >= 18) setCache(cleanQ, rawResults);
          return resolve({ results: rawResults, cached: false });
        } catch (parseErr) {
          return reject(parseErr);
        }
      });
    });
  }

  function isCrawlerBotRequest(req) {
    const ua = String((req && req.headers && req.headers['user-agent']) || '').toLowerCase();
    if (!ua) return false;
    return /applebot|reflectionbot|googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|facebookexternalhit|twitterbot|discordbot|telegrambot|whatsapp|linkedinbot|headlesschrome/i.test(
      ua
    );
  }

  function extractYouTubeIdFromUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const m =
      urlStr.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ||
      urlStr.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) ||
      urlStr.match(/shorts\/([a-zA-Z0-9_-]{11})/) ||
      urlStr.match(/embed\/([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function translateImportErrorMessage(rawErrStr) {
    const s = String(rawErrStr || '').toLowerCase();
    if (
      s.includes('confirm your age') ||
      s.includes('age-restricted') ||
      s.includes('age_restriction') ||
      s.includes('inappropriate for some users')
    ) {
      return 'Bu video YouTube tarafından +18 yaş kısıtlamalı (oturum açma zorunlu) olarak işaretlendiği için sunucuya aktarılamamaktadır.';
    }
    if (s.includes('live streaming') || s.includes('is_live') || s.includes('live event')) {
      return 'Canlı yayınlar video dosyası olarak indirilemez. Lütfen Canlı Yayını İzle modunu kullanın.';
    }
    if (
      s.includes('private video') ||
      s.includes('video unavailable') ||
      s.includes('has been removed') ||
      s.includes('not available in your country')
    ) {
      return "Bu video YouTube'da gizli, silinmiş veya erişime kapalı durumda olduğu için aktarılamadı.";
    }
    if (s.includes('confirm you’re not a bot') || s.includes('confirm you are not a bot') || s.includes(' 429 ')) {
      return 'YouTube geçici yoğunluk sınırı nedeniyle bağlantıyı kısıtladı. Lütfen birkaç saniye sonra tekrar deneyin.';
    }
    return "Bu video şu anda YouTube'dan aktarılamadı. Lütfen tekrar deneyin veya başka bir video seçin.";
  }

  const inFlightImportPromises = new Map();

  // 2. YouTube Search Route (aliases: /youtube-search and /search)
  async function handleYouTubeSearch(req, res) {
    await loadPluginSettings();
    if (isCrawlerBotRequest(req)) {
      return res.json({ results: [], cached: true, botIgnored: true, guestImportLimit });
    }
    const query = (req.query.q || '').trim();
    if (!query || query.length < 2) {
      return res.json({ results: [], guestImportLimit });
    }

    if (safeSearchEnabled && isContentBlocked(query, blockedKeywordsList)) {
      return res.json({
        results: [],
        blocked: true,
        guestImportLimit,
        message:
          'Bu arama terimi veya içerik, Çocuk ve Aile Güvenliği (Child & Family Safety) politikaları gereğince filtrelenmiştir.'
      });
    }

    try {
      const { results: rawResults, cached } = await searchYouTubeRaw(query, 24);
      const enrichedResults = await enrichResultsWithLocalStatus(rawResults);
      return res.json({ results: enrichedResults, cached, guestImportLimit });
    } catch (err) {
      if (logger) logger.error('YouTube search error: ' + err.message);
      return res.status(500).json({ error: 'Search failed', details: err.message });
    }
  }

  router.get('/youtube-search', handleYouTubeSearch);
  router.get('/search', handleYouTubeSearch);

  // 2.5. YouTube-Style Smart Recommendation & Personalized Up-Next Engine
  const RECOMMENDATION_STOP_WORDS = new Set([
    'official',
    'video',
    'klip',
    'music',
    'audio',
    'lyrics',
    'lyric',
    'sözleri',
    'sozleri',
    'şarkı',
    'sarki',
    'hd',
    '4k',
    '1080p',
    'full',
    'izle',
    'yeni',
    'bölüm',
    'bolum',
    've',
    'ile',
    'için',
    'icin',
    'bir',
    'bu',
    'da',
    'de',
    'mi',
    'mu',
    'the',
    'and',
    'for',
    'with',
    'from',
    'feat',
    'ft',
    'prod',
    'remix',
    'version',
    'canlı',
    'canli',
    'performans',
    'konser',
    'yaktube',
    'youtube'
  ]);

  function extractRecommendationKeywords(text) {
    const norm = normalizeTitleForMatch(text);
    if (!norm) return [];
    return norm
      .split(/\s+/)
      .map(w => w.replace(/i\u0307/g, 'i'))
      .filter(w => w.length >= 3 && !RECOMMENDATION_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  }

  function formatDurationLabel(seconds) {
    const dur = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    return (mins < 10 ? '0' + mins : String(mins)) + ':' + (secs < 10 ? '0' + secs : String(secs));
  }

  const GENERIC_CHANNEL_AND_TAG_NAMES = new Set([
    'yaktube',
    'root',
    'admin',
    'youtube',
    'varsayilan',
    'varsayılan',
    'muzik kanali',
    'müzik kanalı',
    'muzik_kanali',
    'genel medya',
    'yaktube genel medya',
    'yaktube muzik',
    'yaktube müzik',
    'video',
    'shorts',
    'viral',
    'yeni',
    'turkce',
    'türkçe',
    'muzik',
    'müzik',
    'musik',
    'muziek',
    'music',
    'film',
    'dizi',
    'haber',
    'komik',
    'eglence',
    'eğlence',
    'bildirimler',
    'notifications'
  ]);

  function normalizeCoreVideoTitle(text) {
    if (!text) return '';
    return normalizeTitleForMatch(
      String(text)
        .replace(/[\(\[].*?[\)\]]/g, ' ')
        .replace(
          /\b(official\s*music\s*video|official\s*video|official\s*audio|video\s*klip|klip|hd|4k|1080p|lyric\s*video|lyrics|audio|şarkı\s*sözleri|sarki\s*sozleri|full\s*izle|yaktube)\b/gi,
          ' '
        )
    );
  }

  function isGenericChannelOrTag(name) {
    const norm = normalizeTitleForMatch(name);
    if (!norm || norm.length < 3) return true;
    if (GENERIC_CHANNEL_AND_TAG_NAMES.has(norm)) return true;
    if (/^yaktube\b/i.test(norm) || /\bkanali$/i.test(norm) || /\bkanalı$/i.test(norm)) return true;
    return false;
  }

  router.get('/smart-recommendations', async (req, res) => {
    await loadPluginSettings();
    if (isCrawlerBotRequest(req)) {
      return res.json({
        ok: true,
        results: [],
        hasLocalMatch: false,
        botIgnored: true,
        smartPrefetchMode,
        guestImportLimit
      });
    }
    const rawUuid = (req.query.uuid || '').trim();
    const rawTitle = (req.query.title || '').trim();
    const rawChannel = (req.query.channel || '').trim();
    const rawYtChannel = (req.query.ytChannel || '').trim();
    const rawHistory = (req.query.history || '').trim();
    const rawWatched = (req.query.watched || '').trim();

    const cleanRawTitle = /^(bildirimler|notifications|yaktube|peertube|yükleniyor|loading)$/i.test(rawTitle)
      ? ''
      : rawTitle;

    if (!cleanRawTitle && !rawUuid) {
      return res.json({
        ok: true,
        results: [],
        hasLocalMatch: false,
        smartPrefetchMode,
        guestImportLimit
      });
    }

    const resolvedUuid = rawUuid ? shortToUuid(rawUuid) : '';
    let currentVideoRow = null;
    let currentVideoTags = [];

    if (resolvedUuid) {
      try {
        const currentRows = await dbQuery(
          `SELECT v.id, v.uuid, v.name, v.category, v."channelId", vi."targetUrl"
           FROM "video" v
           LEFT JOIN "videoImport" vi ON vi."videoId" = v.id
           WHERE v.uuid::text = $1 OR v.id::text = $2
           LIMIT 1`,
          [resolvedUuid, rawUuid]
        );
        if (currentRows.length > 0) {
          currentVideoRow = currentRows[0];
          const tagRows = await dbQuery(
            `SELECT t.name
             FROM "videoTag" vt
             INNER JOIN "tag" t ON t.id = vt."tagId"
             WHERE vt."videoId" = $1
             ORDER BY vt.id ASC
             LIMIT 8`,
            [currentVideoRow.id]
          );
          currentVideoTags = tagRows.map(r => String(r.name || '').trim()).filter(Boolean);
        }
      } catch (e) {}
    }

    const effectiveTitle = cleanRawTitle || (currentVideoRow && currentVideoRow.name) || '';
    if (!effectiveTitle) {
      return res.json({
        ok: true,
        results: [],
        hasLocalMatch: false,
        smartPrefetchMode,
        guestImportLimit
      });
    }

    const normCurrentTitle = normalizeTitleForMatch(effectiveTitle);
    const coreCurrentTitle = normalizeCoreVideoTitle(effectiveTitle);
    const currentCategory = currentVideoRow && currentVideoRow.category ? Number(currentVideoRow.category) : null;

    let currentYtId = null;
    if (currentVideoRow && currentVideoRow.targetUrl) {
      const m =
        currentVideoRow.targetUrl.match(/[?&]v=([^&]+)/) ||
        currentVideoRow.targetUrl.match(/youtu\.be\/([^?]+)/) ||
        currentVideoRow.targetUrl.match(/shorts\/([^?]+)/);
      if (m) currentYtId = m[1];
    }

    // Build strict exclusion sets for the current video AND recently watched videos (prevents A <-> B autoplay loops)
    const excludedUuids = new Set();
    const excludedYtIds = new Set();
    const excludedNormTitles = new Set();
    const excludedCoreTitles = new Set();

    if (resolvedUuid) excludedUuids.add(resolvedUuid.toLowerCase());
    if (rawUuid) excludedUuids.add(rawUuid.toLowerCase());
    if (currentYtId) excludedYtIds.add(currentYtId);
    if (normCurrentTitle) excludedNormTitles.add(normCurrentTitle);
    if (coreCurrentTitle && coreCurrentTitle.length >= 4) excludedCoreTitles.add(coreCurrentTitle);

    if (rawWatched) {
      const watchedParts = rawWatched
        .split('|')
        .map(s => String(s || '').trim())
        .filter(Boolean);
      for (const wp of watchedParts) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(wp)) {
          excludedUuids.add(wp.toLowerCase());
        } else if (/^[a-zA-Z0-9_-]{22}$/.test(wp)) {
          const fullU = shortToUuid(wp);
          excludedUuids.add(wp.toLowerCase());
          if (fullU) excludedUuids.add(fullU.toLowerCase());
        } else if (/^[a-zA-Z0-9_-]{11}$/.test(wp) && !/\s/.test(wp)) {
          excludedYtIds.add(wp);
        } else {
          const nTitle = normalizeTitleForMatch(wp);
          const cTitle = normalizeCoreVideoTitle(wp);
          if (nTitle && nTitle.length >= 4) excludedNormTitles.add(nTitle);
          if (cTitle && cTitle.length >= 4) excludedCoreTitles.add(cTitle);
        }
      }
    }

    function isCurrentVideoMatch(uuid, ytId, title) {
      if (uuid && (uuid.toLowerCase() === resolvedUuid.toLowerCase() || uuid.toLowerCase() === rawUuid.toLowerCase())) {
        return true;
      }
      if (currentYtId && ytId && ytId === currentYtId) return true;
      const nT = normalizeTitleForMatch(title);
      const cT = normalizeCoreVideoTitle(title);
      if (nT && nT === normCurrentTitle) return true;
      if (cT && coreCurrentTitle && cT.length >= 5 && cT === coreCurrentTitle) return true;
      return false;
    }

    function isAlreadyWatchedVideo(uuid, ytId, title) {
      if (uuid && excludedUuids.has(String(uuid).toLowerCase())) return true;
      if (ytId && excludedYtIds.has(String(ytId))) return true;
      const nT = normalizeTitleForMatch(title);
      const cT = normalizeCoreVideoTitle(title);
      if (nT && excludedNormTitles.has(nT)) return true;
      if (cT && cT.length >= 5 && excludedCoreTitles.has(cT)) return true;
      return false;
    }

    // Identify Creator / YouTube Channel / Artist from multiple signals
    let artistPart = '';
    const dashParts = effectiveTitle.split(/\s+[\-\u2010-\u2015]\s+/);
    const pipeParts = effectiveTitle.split(/\s+\|\s+/);
    const handleMatch = effectiveTitle.match(/@([a-zA-Z0-9_.\u00C0-\u017F]{3,30})/);

    if (dashParts.length >= 2 && dashParts[0].trim().length >= 3 && dashParts[0].trim().length <= 42) {
      artistPart = dashParts[0]
        .replace(/[\(\[].*?[\)\]]/g, '')
        .replace(/YakTube/gi, '')
        .trim();
    } else if (
      pipeParts.length >= 2 &&
      pipeParts[pipeParts.length - 1].trim().length >= 3 &&
      pipeParts[pipeParts.length - 1].trim().length <= 40
    ) {
      artistPart = pipeParts[pipeParts.length - 1]
        .replace(/[\(\[].*?[\)\]]/g, '')
        .replace(/^@/, '')
        .trim();
    } else if (handleMatch && handleMatch[1]) {
      artistPart = handleMatch[1].trim();
    }

    let channelCreatorName = '';
    if (rawYtChannel && !isGenericChannelOrTag(rawYtChannel)) {
      channelCreatorName = rawYtChannel.trim();
    } else {
      const firstMeaningfulTag = currentVideoTags.find(t => !isGenericChannelOrTag(t));
      if (firstMeaningfulTag) {
        channelCreatorName = firstMeaningfulTag;
      } else if (rawChannel && !isGenericChannelOrTag(rawChannel)) {
        channelCreatorName = rawChannel.trim();
      }
    }

    if (!artistPart && channelCreatorName) {
      artistPart = channelCreatorName;
    }

    const artistNorm = normalizeTitleForMatch(artistPart);
    const channelCreatorNorm = normalizeTitleForMatch(channelCreatorName);
    const currentTagNorms = currentVideoTags
      .filter(t => !isGenericChannelOrTag(t))
      .map(t => normalizeTitleForMatch(t))
      .filter(t => t.length >= 3);

    const currentKeywords = Array.from(
      new Set([
        ...extractRecommendationKeywords(effectiveTitle),
        ...currentVideoTags.flatMap(t => extractRecommendationKeywords(t))
      ])
    );

    // Build clean primary search query for YouTube
    const cleanTopic = effectiveTitle
      .replace(/YakTube/gi, '')
      .replace(/[\(\[].*?[\)\]]/g, '')
      .replace(/official\s*video|video\s*klip|klip|hd|4k|lyric\s*video|audio|şarkı\s*sözleri|sarki\s*sozleri/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const topicWords = cleanTopic.split(/\s+/).filter(w => w.length >= 2);
    let primaryQuery = topicWords.slice(0, 5).join(' ') || cleanTopic || effectiveTitle;
    if (
      channelCreatorName &&
      topicWords.length <= 3 &&
      !normalizeTitleForMatch(primaryQuery).includes(channelCreatorNorm)
    ) {
      primaryQuery = `${primaryQuery} ${channelCreatorName}`.trim();
    }

    // Build dedicated Creator / Same-Channel query so other videos from the same YouTube channel are fetched
    let creatorQuery = '';
    const candidateCreators = [channelCreatorName, artistPart].filter(c => c && !isGenericChannelOrTag(c));
    for (const cand of candidateCreators) {
      const normCand = normalizeTitleForMatch(cand);
      if (normCand && normCand.length >= 3 && normCand !== normalizeTitleForMatch(primaryQuery)) {
        creatorQuery = cand;
        break;
      }
    }
    if (!creatorQuery && candidateCreators.length > 0) {
      creatorQuery = candidateCreators[0];
    }

    // Parse user watch & search history terms (filtering out UI labels and placeholders)
    let historyTerms = [];
    if (rawHistory) {
      try {
        const parsed = rawHistory.startsWith('[') ? JSON.parse(rawHistory) : rawHistory.split('|');
        if (Array.isArray(parsed)) {
          const defaultIgnore = new Set([
            'tarkan',
            'barış manço',
            'baris manco',
            'yapay zeka',
            'canlı haber',
            'canli haber',
            'bildirimler',
            'notifications',
            'yaktube',
            'peertube'
          ]);
          const cleaned = parsed
            .map(t => String(t || '').trim())
            .filter(
              t =>
                t.length >= 3 &&
                !/^(bildirimler|notifications|yaktube|peertube|anasayfa)$/i.test(t) &&
                (!safeSearchEnabled || !isContentBlocked(t, blockedKeywordsList))
            );
          const nonDefaults = cleaned.filter(t => !defaultIgnore.has(t.toLocaleLowerCase('tr')));
          historyTerms = (nonDefaults.length > 0 ? nonDefaults : cleaned).slice(0, 10);
        }
      } catch (e) {}
    }

    const historyKeywords = Array.from(
      new Set(historyTerms.flatMap(t => extractRecommendationKeywords(t)).filter(w => w.length >= 3))
    );

    // Pick up to 2 distinct secondary queries from user watch/search history
    const historyQueries = [];
    const normPrimary = normalizeTitleForMatch(primaryQuery);
    const normCreator = normalizeTitleForMatch(creatorQuery);
    for (const hTerm of historyTerms) {
      const normH = normalizeTitleForMatch(hTerm);
      if (
        normH &&
        normH.length >= 3 &&
        normH !== normPrimary &&
        normH !== normCreator &&
        !normPrimary.includes(normH) &&
        !normH.includes(normPrimary) &&
        !historyQueries.some(existing => normalizeTitleForMatch(existing) === normH)
      ) {
        const cleanedHTerm = hTerm
          .replace(/[\(\[].*?[\)\]]/g, '')
          .split(/\s+/)
          .slice(0, 4)
          .join(' ')
          .trim();
        if (cleanedHTerm.length >= 3) {
          historyQueries.push(cleanedHTerm);
          if (historyQueries.length >= 2) break;
        }
      }
    }

    // 1. Score Local YakTube Videos from PostgreSQL (including their stored YouTube channel/tags)
    const scoredLocalItems = [];
    const watchedFallbackItems = [];
    let hasDirectLocalMatch = false;

    try {
      const localRows = await dbQuery(
        `SELECT DISTINCT ON (v.id)
           v.id, v.uuid, v.name, v.category, v.duration, v.views, v."createdAt",
           t.filename AS "thumbFilename",
           vi."targetUrl" AS "importUrl",
           (
             SELECT tg.name
             FROM "videoTag" vt2
             INNER JOIN "tag" tg ON tg.id = vt2."tagId"
             WHERE vt2."videoId" = v.id
             ORDER BY vt2.id ASC
             LIMIT 1
           ) AS "primaryTag"
         FROM "video" v
         LEFT JOIN "thumbnail" t ON t."videoId" = v.id
         LEFT JOIN "videoImport" vi ON vi."videoId" = v.id
         WHERE v.remote = false AND v.state = 1
         ORDER BY v.id DESC, t.type ASC
         LIMIT 250`
      );

      for (const lv of localRows) {
        if (!lv || !lv.name) continue;
        if (currentVideoRow && Number(lv.id) === Number(currentVideoRow.id)) continue;
        if (safeSearchEnabled && isContentBlocked(lv.name, blockedKeywordsList)) continue;

        let lvYtId = null;
        if (lv.importUrl) {
          const m =
            lv.importUrl.match(/[?&]v=([^&]+)/) ||
            lv.importUrl.match(/youtu\.be\/([^?]+)/) ||
            lv.importUrl.match(/shorts\/([^?]+)/);
          if (m) lvYtId = m[1];
        }

        // Never recommend the exact video currently playing
        if (isCurrentVideoMatch(lv.uuid, lvYtId, lv.name)) continue;

        const normLv = normalizeTitleForMatch(lv.name);
        if (!normLv) continue;
        const lvTagNorm = normalizeTitleForMatch(lv.primaryTag || '');
        const lvChannelDisplay =
          lv.primaryTag && !isGenericChannelOrTag(lv.primaryTag) ? lv.primaryTag : 'YakTube Kütüphanesi';

        let rawScore = 0;
        let reasonBadge = '';
        let sourceBucket = 'topic';

        // Same YouTube channel / creator / artist match
        const isSameArtist =
          artistNorm && artistNorm.length >= 3 && (normLv.includes(artistNorm) || lvTagNorm === artistNorm);
        const isSameChannel =
          (channelCreatorNorm &&
            channelCreatorNorm.length >= 3 &&
            (normLv.includes(channelCreatorNorm) || lvTagNorm === channelCreatorNorm)) ||
          (lvTagNorm && currentTagNorms.includes(lvTagNorm));

        if (isSameChannel || isSameArtist) {
          rawScore += 75;
          reasonBadge =
            lv.primaryTag && !isGenericChannelOrTag(lv.primaryTag)
              ? `📺 Aynı Kanaldan • ${lv.primaryTag}`
              : '📺 Aynı Kanaldan / Sanatçı';
          sourceBucket = 'channel';
        }

        // Keyword overlap with current video
        const lvKeywords = extractRecommendationKeywords(lv.name);
        let kwOverlap = 0;
        for (const kw of currentKeywords) {
          if (lvKeywords.includes(kw) || (kw.length >= 4 && normLv.includes(kw))) {
            kwOverlap++;
          }
        }
        if (kwOverlap > 0) {
          rawScore += kwOverlap * 28;
          if (!reasonBadge) reasonBadge = '🔥 Benzer İçerik';
        }

        // User watch/search history match
        let histOverlap = 0;
        for (const hkw of historyKeywords) {
          if (
            lvKeywords.includes(hkw) ||
            (hkw.length >= 4 && normLv.includes(hkw)) ||
            (lvTagNorm && lvTagNorm.includes(hkw))
          ) {
            histOverlap++;
          }
        }
        if (histOverlap > 0) {
          rawScore += Math.min(48, histOverlap * 24);
          if (!reasonBadge) {
            reasonBadge = '🎯 İzleme Geçmişinize Göre';
            sourceBucket = 'history';
          }
        }

        // Same category match (only if category is known)
        if (currentCategory && lv.category && Number(lv.category) === currentCategory) {
          rawScore += 20;
          if (!reasonBadge) reasonBadge = '📂 Aynı Kategoriden';
        }

        // Strictly exclude completely unrelated videos (score < 20)
        if (rawScore < 20) continue;

        const alreadyWatched = isAlreadyWatchedVideo(lv.uuid, lvYtId, lv.name);
        if (!alreadyWatched && rawScore >= 40) {
          hasDirectLocalMatch = true;
        }

        const finalScore = rawScore >= 40 ? rawScore + 35 : 54 + Math.min(10, Math.floor((lv.views || 0) / 10));
        const thumbUrl = lv.thumbFilename
          ? `/lazy-static/thumbnails/${lv.thumbFilename}`
          : lvYtId
            ? `https://i.ytimg.com/vi/${lvYtId}/hqdefault.jpg`
            : '/client/assets/images/default-thumbnail.jpg';

        const candidateObj = {
          id: lvYtId || `local-${lv.uuid}`,
          title: lv.name,
          channel: lvChannelDisplay,
          duration: lv.duration || 0,
          durationFormatted: formatDurationLabel(lv.duration || 0),
          isLive: false,
          isDownloaded: true,
          isFederated: false,
          sourceType: sourceBucket,
          reasonBadge: reasonBadge ? `✅ ${reasonBadge.replace(/^[🔥🎯📂]\s*/, '')}` : "✅ YakTube'da İzle",
          relevanceScore: finalScore,
          url: lv.importUrl || `/videos/watch/${lv.uuid}`,
          thumbnail: thumbUrl,
          localVideo: {
            id: lv.id,
            uuid: lv.uuid,
            name: lv.name,
            url: `/videos/watch/${lv.uuid}`
          }
        };

        if (alreadyWatched) {
          watchedFallbackItems.push({
            ...candidateObj,
            relevanceScore: Math.max(10, finalScore - 80),
            reasonBadge: '🔄 Tekrar İzle'
          });
        } else {
          scoredLocalItems.push(candidateObj);
        }
      }
    } catch (e) {
      if (logger) logger.warn('[YakTube SmartRec] Local DB query warning: ' + e.message);
    }

    // 1.5. Score Relevant Fediverse (Remote PeerTube) Videos when federatedRecommendationsMode !== 'disabled'
    if (federatedRecommendationsMode !== 'disabled') {
      try {
        const searchPatterns = Array.from(
          new Set(
            [
              ...(artistNorm && artistNorm.length >= 3 ? [artistNorm] : []),
              ...(channelCreatorNorm && channelCreatorNorm.length >= 3 ? [channelCreatorNorm] : []),
              ...currentKeywords,
              ...historyKeywords
            ]
              .filter(k => k && k.length >= 3)
              .slice(0, 8)
              .map(k => `%${k}%`)
          )
        );

        if (searchPatterns.length > 0) {
          const fedRows = await dbQuery(
            `SELECT DISTINCT ON (v.id)
               v.id, v.uuid, v.name, v.category, v.language, v.duration, v.views, v."isLive", v.nsfw,
               t.filename AS "thumbFilename"
             FROM "video" v
             LEFT JOIN "thumbnail" t ON t."videoId" = v.id
             WHERE v.remote = true
               AND v.state = 1
               AND v.privacy = 1
               AND v.nsfw = false
               AND (v.name ILIKE ANY($1) OR v.language = 'tr')
             ORDER BY v.id DESC, t.type ASC
             LIMIT 80`,
            [searchPatterns]
          );

          for (const fv of fedRows) {
            if (!fv || !fv.name) continue;
            if (isCurrentVideoMatch(fv.uuid, null, fv.name)) continue;
            if (isAlreadyWatchedVideo(fv.uuid, null, fv.name)) continue;
            if (safeSearchEnabled && (fv.nsfw || isContentBlocked(fv.name, blockedKeywordsList))) continue;

            const normFv = normalizeTitleForMatch(fv.name);
            if (!normFv) continue;

            let fedScore = 0;
            let fedBadge = '';

            if (artistNorm && artistNorm.length >= 3 && normFv.includes(artistNorm)) {
              fedScore += 65;
              fedBadge = '🌐 Fediverse • Aynı Sanatçı';
            }

            const fvKeywords = extractRecommendationKeywords(fv.name);
            let kwOverlap = 0;
            for (const kw of currentKeywords) {
              if (fvKeywords.includes(kw) || (kw.length >= 4 && normFv.includes(kw))) {
                kwOverlap++;
              }
            }
            if (kwOverlap > 0) {
              fedScore += kwOverlap * 30;
              if (!fedBadge) fedBadge = '🌐 Fediverse • Benzer İçerik';
            }

            let histOverlap = 0;
            for (const hkw of historyKeywords) {
              if (fvKeywords.includes(hkw) || (hkw.length >= 4 && normFv.includes(hkw))) {
                histOverlap++;
              }
            }
            if (histOverlap > 0) {
              fedScore += Math.min(48, histOverlap * 24);
              if (!fedBadge) fedBadge = '🌐 Fediverse • İzleme Geçmişinize Göre';
            }

            if (
              currentCategory &&
              fv.category &&
              Number(fv.category) === currentCategory &&
              String(fv.language || '').toLowerCase() === 'tr'
            ) {
              fedScore += 22;
              if (!fedBadge) fedBadge = '🌐 Fediverse • Aynı Kategori';
            }

            // Require strong relevance (score >= 28) so random foreign webcams never slip in
            if (fedScore < 28) continue;

            const thumbUrl = fv.thumbFilename
              ? `/lazy-static/thumbnails/${fv.thumbFilename}`
              : '/client/assets/images/default-thumbnail.jpg';

            scoredLocalItems.push({
              id: `fed-${fv.uuid}`,
              title: fv.name,
              channel: 'Fediverse Ağı',
              duration: fv.duration || 0,
              durationFormatted: fv.isLive ? 'CANLI' : formatDurationLabel(fv.duration || 0),
              isLive: Boolean(fv.isLive),
              isDownloaded: true,
              isFederated: true,
              sourceType: 'federated',
              reasonBadge: fedBadge || "🌐 Fediverse'de İzle",
              relevanceScore: fedScore + 20,
              url: `/videos/watch/${fv.uuid}`,
              thumbnail: thumbUrl,
              localVideo: {
                id: fv.id,
                uuid: fv.uuid,
                name: fv.name,
                url: `/videos/watch/${fv.uuid}`
              }
            });
          }
        }
      } catch (e) {
        if (logger) logger.warn('[YakTube SmartRec] Federated DB query warning: ' + e.message);
      }
    }

    // 2. Query YouTube On-Demand for:
    //    (a) Current Video Topic
    //    (b) Same YouTube Channel / Creator (so other videos from the same channel appear!)
    //    (c) User Watch & Search History (up to 2 distinct interest queries)
    let primaryYtResults = [];
    let creatorYtResults = [];
    let historyYtResults = [];

    try {
      const pTask = searchYouTubeRaw(primaryQuery, 16).catch(() => ({ results: [] }));
      const cTask =
        creatorQuery &&
        normalizeTitleForMatch(creatorQuery) !== normalizeTitleForMatch(primaryQuery) &&
        (!safeSearchEnabled || !isContentBlocked(creatorQuery, blockedKeywordsList))
          ? searchYouTubeRaw(creatorQuery, 10).catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] });

      const hTasks = historyQueries
        .filter(hq => !safeSearchEnabled || !isContentBlocked(hq, blockedKeywordsList))
        .map(hq => searchYouTubeRaw(hq, 8).catch(() => ({ results: [] })));

      const [primaryRes, creatorRes, ...histResList] = await Promise.all([pTask, cTask, ...hTasks]);
      primaryYtResults = await enrichResultsWithLocalStatus((primaryRes && primaryRes.results) || []);
      if (creatorRes && creatorRes.results && creatorRes.results.length > 0) {
        creatorYtResults = await enrichResultsWithLocalStatus(creatorRes.results);
      }
      const combinedHistRaw = histResList.flatMap(r => (r && r.results) || []);
      if (combinedHistRaw.length > 0) {
        historyYtResults = await enrichResultsWithLocalStatus(combinedHistRaw);
      }
    } catch (e) {}

    const scoredYtItems = [];

    function matchesSameChannelOrCreator(item) {
      const normItemTitle = normalizeTitleForMatch(item.title || '');
      const normItemChan = normalizeTitleForMatch(item.channel || '');
      if (
        channelCreatorNorm &&
        channelCreatorNorm.length >= 3 &&
        (normItemChan.includes(channelCreatorNorm) ||
          channelCreatorNorm.includes(normItemChan) ||
          normItemTitle.includes(channelCreatorNorm))
      ) {
        if (normItemChan.length >= 3 || normItemTitle.includes(channelCreatorNorm)) return true;
      }
      if (
        artistNorm &&
        artistNorm.length >= 3 &&
        (normItemChan.includes(artistNorm) || normItemTitle.includes(artistNorm))
      ) {
        return true;
      }
      return false;
    }

    // Score same-channel / creator YouTube results
    creatorYtResults.forEach((item, idx) => {
      if (!item || !item.id || !item.title) return;
      const localUuid = item.localVideo && item.localVideo.uuid ? item.localVideo.uuid : null;
      if (isCurrentVideoMatch(localUuid, item.id, item.title)) return;
      if (isAlreadyWatchedVideo(localUuid, item.id, item.title)) return;

      let score = Math.max(66, 88 - idx * 2);
      const chanLabel = item.channel || creatorQuery;
      let badge = chanLabel ? `📺 Aynı Kanaldan • ${chanLabel}` : '📺 Aynı Kanaldan';

      if (item.isDownloaded && item.localVideo) {
        score += 25;
        hasDirectLocalMatch = true;
        badge = `✅ Aynı Kanaldan • ${chanLabel}`;
      }

      scoredYtItems.push({
        ...item,
        reasonBadge: badge,
        relevanceScore: score,
        sourceType: 'channel'
      });
    });

    // Score primary topic YouTube results
    primaryYtResults.forEach((item, idx) => {
      if (!item || !item.id || !item.title) return;
      const localUuid = item.localVideo && item.localVideo.uuid ? item.localVideo.uuid : null;
      if (isCurrentVideoMatch(localUuid, item.id, item.title)) return;
      if (isAlreadyWatchedVideo(localUuid, item.id, item.title)) return;

      let score = Math.max(55, 78 - idx * 1.5);
      let badge = '🔥 Benzer İçerik';
      let sType = 'topic';

      if (matchesSameChannelOrCreator(item)) {
        score += 16;
        badge = item.channel ? `📺 Aynı Kanaldan • ${item.channel}` : '📺 Aynı Kanaldan / Sanatçı';
        sType = 'channel';
      }

      const itemKws = extractRecommendationKeywords(item.title);
      let histHits = 0;
      for (const hkw of historyKeywords) {
        if (itemKws.includes(hkw)) histHits++;
      }
      if (histHits > 0) {
        score += 8;
      }

      if (item.isDownloaded && item.localVideo) {
        score += 25;
        hasDirectLocalMatch = true;
        badge = sType === 'channel' ? `✅ Aynı Kanaldan • ${item.channel || ''}`.trim() : "✅ YakTube'da İzle";
      }

      scoredYtItems.push({
        ...item,
        reasonBadge: badge,
        relevanceScore: score,
        sourceType: sType
      });
    });

    // Score personalized watch/search history YouTube results
    historyYtResults.forEach((item, idx) => {
      if (!item || !item.id || !item.title) return;
      const localUuid = item.localVideo && item.localVideo.uuid ? item.localVideo.uuid : null;
      if (isCurrentVideoMatch(localUuid, item.id, item.title)) return;
      if (isAlreadyWatchedVideo(localUuid, item.id, item.title)) return;

      let score = Math.max(54, 74 - idx * 1.8);
      let badge = '🎯 İzleme Geçmişinize Göre';

      if (item.isDownloaded && item.localVideo) {
        score += 22;
        badge = '✅ İzleme Geçmişinize Göre';
      }

      scoredYtItems.push({
        ...item,
        reasonBadge: badge,
        relevanceScore: score,
        sourceType: 'history'
      });
    });

    // 3. Merge, Deduplicate & Interleave (Channel + Topic + Watch History, just like YouTube)
    const combined = [...scoredLocalItems, ...scoredYtItems];
    combined.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

    const dedupedPool = [];
    const seenIds = new Set();
    const seenUuids = new Set();
    const seenNormTitles = new Set();
    const seenCoreTitles = new Set();

    for (const item of combined) {
      const normT = normalizeTitleForMatch(item.title);
      const coreT = normalizeCoreVideoTitle(item.title);
      if (!normT || normT === normCurrentTitle) continue;
      if (coreT && coreCurrentTitle && coreT.length >= 5 && coreT === coreCurrentTitle) continue;
      if (item.id && seenIds.has(item.id)) continue;
      if (item.localVideo && item.localVideo.uuid && seenUuids.has(item.localVideo.uuid)) continue;
      if (seenNormTitles.has(normT)) continue;
      if (coreT && coreT.length >= 5 && seenCoreTitles.has(coreT)) continue;

      if (item.id) seenIds.add(item.id);
      if (item.localVideo && item.localVideo.uuid) seenUuids.add(item.localVideo.uuid);
      seenNormTitles.add(normT);
      if (coreT && coreT.length >= 5) seenCoreTitles.add(coreT);

      dedupedPool.push(item);
    }

    // Ensure a rich YouTube-like mix in the top results:
    // - #1 is the highest-scoring unwatched Same-Channel or Topic match (for seamless Autoplay)
    // - Interleave Same-Channel ('channel'), Topic ('topic'), and Watch History ('history') items
    const channelBucket = dedupedPool.filter(i => i.sourceType === 'channel');
    const historyBucket = dedupedPool.filter(i => i.sourceType === 'history');
    const topicBucket = dedupedPool.filter(i => i.sourceType !== 'channel' && i.sourceType !== 'history');

    const finalResults = [];
    const pickedSet = new Set();
    function pushUnique(candidate) {
      if (!candidate || pickedSet.has(candidate)) return false;
      pickedSet.add(candidate);
      finalResults.push(candidate);
      return true;
    }

    // Slot #1 (Up Next Autoplay): Best Same-Channel or Topic video
    if (
      channelBucket.length > 0 &&
      (!topicBucket[0] || channelBucket[0].relevanceScore >= topicBucket[0].relevanceScore - 10)
    ) {
      pushUnique(channelBucket[0]);
    } else if (topicBucket.length > 0) {
      pushUnique(topicBucket[0]);
    }

    // Interleave remaining top candidates so the user sees Same-Channel, Topic, and History videos together
    let cIdx = 0;
    let tIdx = 0;
    let hIdx = 0;
    while (
      finalResults.length < 24 &&
      (cIdx < channelBucket.length || tIdx < topicBucket.length || hIdx < historyBucket.length)
    ) {
      if (cIdx < channelBucket.length) pushUnique(channelBucket[cIdx++]);
      if (tIdx < topicBucket.length) pushUnique(topicBucket[tIdx++]);
      if (tIdx < topicBucket.length) pushUnique(topicBucket[tIdx++]);
      if (hIdx < historyBucket.length) pushUnique(historyBucket[hIdx++]);
    }

    // Only if there are almost no unwatched results (< 4), append watched fallbacks at the very bottom (never #1)
    if (finalResults.length < 4 && watchedFallbackItems.length > 0) {
      for (const wf of watchedFallbackItems) {
        if (finalResults.length >= 8) break;
        const normT = normalizeTitleForMatch(wf.title);
        if (!seenNormTitles.has(normT)) {
          seenNormTitles.add(normT);
          finalResults.push(wf);
        }
      }
    }

    // Identify #1 undownloaded match for optional background smart pre-fetch
    const topPrefetchCandidate =
      finalResults.find(
        it =>
          !it.isDownloaded &&
          !it.isLive &&
          it.url &&
          (it.url.includes('youtube.com') || it.url.includes('youtu.be')) &&
          (!it.duration || it.duration <= 900) // Only pre-fetch videos <= 15 mins to respect server storage/bandwidth
      ) || null;

    return res.json({
      ok: true,
      query: primaryQuery,
      creatorQuery: creatorQuery || null,
      historyQuery: historyQueries[0] || null,
      historyQueries,
      hasLocalMatch: hasDirectLocalMatch,
      smartPrefetchMode,
      federatedRecommendationsMode,
      topPrefetchCandidate: topPrefetchCandidate
        ? {
            id: topPrefetchCandidate.id,
            title: topPrefetchCandidate.title,
            url: topPrefetchCandidate.url,
            channel: topPrefetchCandidate.channel
          }
        : null,
      guestImportLimit,
      results: finalResults
    });
  });

  // 3. On-Demand Video Import Route (aliases: /ondemand-import and /import)
  async function handleOnDemandImport(req, res) {
    await loadPluginSettings();
    if (isCrawlerBotRequest(req)) {
      return res.status(403).json({ ok: false, error: 'Automated bot requests are not allowed to import videos.' });
    }
    const { targetUrl, title, channelId, isAuthenticated, guestImportCount } = req.body || {};
    if (!targetUrl || (!targetUrl.includes('youtube.com') && !targetUrl.includes('youtu.be'))) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const ytId = extractYouTubeIdFromUrl(targetUrl);
    const normalizedTargetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : targetUrl.trim();
    const dedupeKey = ytId || normalizedTargetUrl;

    if (
      safeSearchEnabled &&
      (isContentBlocked(title, blockedKeywordsList) || isContentBlocked(normalizedTargetUrl, blockedKeywordsList))
    ) {
      return res.status(403).json({
        ok: false,
        blocked: true,
        error:
          "Bu video içeriği, Çocuk ve Aile Güvenliği (Child & Family Safety) politikaları gereğince YakTube'a aktarılamaz."
      });
    }

    // 1. Check DB for already published, currently importing, or previously failed records for this YouTube video
    try {
      const searchPattern = ytId ? `%${ytId}%` : normalizedTargetUrl;
      const existingRows = await dbQuery(
        `SELECT vi.id AS "importId", vi.state AS "importState",
                v.id, v.uuid, v.name, v.state AS "videoState", v."updatedAt"
         FROM "videoImport" vi
         INNER JOIN "video" v ON v.id = vi."videoId"
         WHERE vi."targetUrl" LIKE $1
         ORDER BY vi.id DESC`,
        [searchPattern]
      );

      const publishedRow = existingRows.find(r => Number(r.videoState) === 1);
      if (publishedRow) {
        return res.json({
          ok: true,
          alreadyImported: true,
          importId: publishedRow.importId,
          video: {
            id: publishedRow.id,
            uuid: publishedRow.uuid,
            name: publishedRow.name,
            url: '/videos/watch/' + publishedRow.uuid
          }
        });
      }

      const activeRow = existingRows.find(r => {
        const vState = Number(r.videoState);
        const iState = Number(r.importState);
        const ageMs = r.updatedAt ? Date.now() - new Date(r.updatedAt).getTime() : 0;
        return (vState === 2 || vState === 3) && iState !== 3 && iState !== 4 && ageMs < 10 * 60 * 1000;
      });
      if (activeRow) {
        return res.json({
          ok: true,
          inProgress: true,
          importId: activeRow.importId,
          video: {
            id: activeRow.id,
            uuid: activeRow.uuid,
            name: activeRow.name,
            url: '/videos/watch/' + activeRow.uuid
          }
        });
      }

      // Clean up any failed (v.state = 12 / vi.state = 3) or stale (>15 min in state 3) rows before re-importing
      const staleOrFailedRows = existingRows.filter(r => {
        const vState = Number(r.videoState);
        const iState = Number(r.importState);
        const ageMs = r.updatedAt ? Date.now() - new Date(r.updatedAt).getTime() : 0;
        return vState === 12 || iState === 3 || (vState === 3 && ageMs >= 15 * 60 * 1000);
      });
      if (staleOrFailedRows.length > 0) {
        const badImportIds = staleOrFailedRows.map(r => r.importId).filter(Boolean);
        const badVideoIds = staleOrFailedRows.map(r => r.id).filter(Boolean);
        if (badImportIds.length > 0) {
          await dbQuery(`DELETE FROM "videoImport" WHERE id = ANY($1::int[])`, [badImportIds]);
        }
        if (badVideoIds.length > 0) {
          await dbQuery(
            `DELETE FROM "video" v
             WHERE v.id = ANY($1::int[])
               AND v.state IN (3, 12)
               AND NOT EXISTS (SELECT 1 FROM "videoFile" vf WHERE vf."videoId" = v.id)
               AND NOT EXISTS (SELECT 1 FROM "videoStreamingPlaylist" vsp WHERE vsp."videoId" = v.id)`,
            [badVideoIds]
          );
        }
      }
    } catch (dbCheckErr) {}

    // 2. If another request is already initiating an import for this exact video right now, await it
    if (inFlightImportPromises.has(dedupeKey)) {
      try {
        const sharedResult = await inFlightImportPromises.get(dedupeKey);
        return res.status(sharedResult.status).json(sharedResult.payload);
      } catch (sharedErr) {
        return res.status(500).json({ error: sharedErr.message });
      }
    }

    const isLoggedUser = await isRequestAuthenticated(req, res, isAuthenticated);
    if (!isLoggedUser && guestImportLimit > 0) {
      const clientCount = parseInt(String(guestImportCount || '0'), 10) || 0;
      if (clientCount >= guestImportLimit) {
        return res.status(429).json({
          ok: false,
          quotaExceeded: true,
          limit: guestImportLimit,
          error:
            'Kota Doldu: Misafir video indirme sınırına ulaştınız. Sınırsız video aktarımı, yorum yapabilme ve diğer tüm ayrıcalıklar için lütfen giriş yapın.'
        });
      }
    }

    // Non-blocking background check to prune old videos if disk usage exceeds maxDiskUsagePercent
    checkAndPruneStorage().catch(() => {});

    const importPromise = (async () => {
      const token = await getAdminToken();
      const resolvedChannelId = await resolveTargetChannelId(title, channelId);
      const { hostname, port, hostHeader } = getLocalServerTarget();
      const postData = new URLSearchParams({
        targetUrl: normalizedTargetUrl,
        channelId: resolvedChannelId,
        privacy: '1'
      }).toString();

      return await new Promise((resolve, reject) => {
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
                  return resolve({
                    status: 200,
                    payload: {
                      ok: true,
                      importId: data.id,
                      video: {
                        id: data.video.id,
                        uuid: data.video.uuid,
                        shortUUID: data.video.shortUUID,
                        name: data.video.name,
                        url: data.video.url
                      }
                    }
                  });
                } else {
                  const friendlyMsg = translateImportErrorMessage(body);
                  return resolve({
                    status: 400,
                    payload: {
                      ok: false,
                      error: friendlyMsg,
                      userMessage: friendlyMsg,
                      details: data
                    }
                  });
                }
              } catch (e) {
                const friendlyMsg = translateImportErrorMessage(body);
                return resolve({
                  status: 500,
                  payload: {
                    ok: false,
                    error: friendlyMsg,
                    userMessage: friendlyMsg,
                    raw: body
                  }
                });
              }
            });
          }
        );

        importReq.on('error', err => {
          reject(err);
        });

        importReq.write(postData);
        importReq.end();
      });
    })();

    inFlightImportPromises.set(dedupeKey, importPromise);
    try {
      const outcome = await importPromise;
      return res.status(outcome.status).json(outcome.payload);
    } catch (err) {
      return res.status(500).json({ error: 'Admin authentication or HTTP connection failed', details: err.message });
    } finally {
      inFlightImportPromises.delete(dedupeKey);
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
        resVideo.on('end', async () => {
          try {
            const video = JSON.parse(body);
            const isPublished = video.state && video.state.id === 1;
            const isTranscoding = video.state && video.state.id === 2;
            const isImporting = video.state && video.state.id === 3;
            const isFailed = video.state && video.state.id === 12;
            const hasFiles =
              (video.files && video.files.length > 0) ||
              (video.streamingPlaylists && video.streamingPlaylists.length > 0);

            let errorMessage = null;
            if (isFailed && video.id) {
              try {
                const errRows = await dbQuery(
                  `SELECT id, error FROM "videoImport" WHERE "videoId" = $1 ORDER BY id DESC LIMIT 1`,
                  [video.id]
                );
                const rawErr = errRows.length > 0 ? errRows[0].error : '';
                errorMessage = translateImportErrorMessage(rawErr);
                // Auto-cleanup failed import and orphan state=12 video so it never pollutes search or library
                await dbQuery(`DELETE FROM "videoImport" WHERE "videoId" = $1 AND state = 3`, [video.id]);
                if (!hasFiles) {
                  await dbQuery(
                    `DELETE FROM "video" v
                     WHERE v.id = $1
                       AND v.state = 12
                       AND NOT EXISTS (SELECT 1 FROM "videoFile" vf WHERE vf."videoId" = v.id)
                       AND NOT EXISTS (SELECT 1 FROM "videoStreamingPlaylist" vsp WHERE vsp."videoId" = v.id)`,
                    [video.id]
                  );
                }
              } catch (cleanErr) {}
            }

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
              errorMessage,
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
  const BASE58_ALPHABET = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  function shortToUuid(shortStr) {
    if (!shortStr || typeof shortStr !== 'string' || shortStr.length < 20 || shortStr.length > 24) return shortStr;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shortStr)) return shortStr;
    try {
      let num = 0n;
      for (let i = 0; i < shortStr.length; i++) {
        const idx = BASE58_ALPHABET.indexOf(shortStr[i]);
        if (idx === -1) return shortStr;
        num = num * 58n + BigInt(idx);
      }
      const hex = num.toString(16).padStart(32, '0');
      if (hex.length !== 32) return shortStr;
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    } catch (e) {
      return shortStr;
    }
  }

  router.get('/video-origin/:uuid', async (req, res) => {
    const rawParam = (req.params.uuid || '').trim();
    if (!rawParam) return res.status(400).json({ error: 'UUID required' });
    const resolvedUuid = shortToUuid(rawParam);

    try {
      const rows = await dbQuery(
        `SELECT v.id, v.uuid, v.name, v.description, vi."targetUrl"
         FROM "video" v
         LEFT JOIN "videoImport" vi ON vi."videoId" = v.id
         WHERE v.uuid::text = $1 OR v.id::text = $2
         LIMIT 1`,
        [resolvedUuid, rawParam]
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
        store[userKey] = filtered.slice(0, 20);
        writeHistoryStore(store);
      }
      return res.json({ status: 'success', history: store[userKey] || currentList });
    }

    if (req.method === 'DELETE') {
      const target = ((req.body && req.body.query) || (req.query && req.query.query) || '').trim();
      if (target) {
        const filtered = currentList.filter(item => String(item).toLowerCase() !== target.toLowerCase());
        store[userKey] = filtered;
        writeHistoryStore(store);
        return res.json({ status: 'success', history: filtered });
      }
      delete store[userKey];
      writeHistoryStore(store);
      return res.json({ status: 'success', history: [] });
    }

    return res.json({ status: 'success', history: currentList });
  });
}

async function unregister() {
  if (pruneIntervalTimer) {
    clearInterval(pruneIntervalTimer);
    pruneIntervalTimer = null;
  }
}

module.exports = {
  register,
  unregister
};
