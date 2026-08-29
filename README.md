# PeerTube Plugin: On-Demand Search & Smart Recommendations (`peertube-plugin-yaktube-ondemand`)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![PeerTube Engine](https://img.shields.io/badge/PeerTube-%3E%3D5.0.0-orange.svg)](https://joinpeertube.org)
[![Accessibility: 100%](https://img.shields.io/badge/Accessibility-WCAG%202.1%20AA-green.svg)](https://yaktube.yakhub.com.tr)

**English** | [Türkçe](#türkçe)

`peertube-plugin-yaktube-ondemand` enhances any [PeerTube](https://joinpeertube.org) instance with **live YouTube on-demand search**, **one-click import & instant watch**, **hybrid related video recommendations**, and **comprehensive screen reader accessibility (TalkBack / NVDA)**.

---

## 🌟 Key Features

- **⚡ Live Web & YouTube On-Demand Search:** Seamlessly search YouTube directly within your instance search bar. If the video is already on your instance, it plays immediately; otherwise, users can import it in 1 click.
- **🔥 Hybrid Smart Recommendations:** Intelligently discovers related content across local federated videos first, supplemented with relevant live discoveries.
- **♿ Full Screen Reader Accessibility (A11y):**
  - Dynamic result counters with live polite announcements (`aria-live`).
  - Accessible keyboard navigation modal (`?` shortcut).
  - Auto-labeled player controls, buttons, and thumbnails.
- **💬 Dynamic Live YouTube Comments:** View original YouTube community comments under imported videos on demand.
- **🌐 Dynamic Multi-Instance Branding:** Automatically adapts to any instance name (e.g., _YakTube_, _Framatube_, _TubeLibre_).

---

## 📦 Installation

### Option 1: Via PeerTube Admin Interface (Recommended)

1. In your PeerTube administration dashboard, navigate to: **Administration > Plugins / Themes**.
2. Search for `peertube-plugin-yaktube-ondemand`.
3. Click **Install**.

### Option 2: Via Command Line

```bash
cd /var/www/peertube/peertube-latest
NODE_ENV=production npm run plugin:install -- --plugin-path peertube-plugin-yaktube-ondemand
```

---

<a name="türkçe"></a>

## 🇹🇷 Türkçe Açıklama

`peertube-plugin-yaktube-ondemand`, PeerTube sunucuları için geliştirilmiş **Canlı YouTube Arama, Tek Tıkla İndir & İzle ve Akıllı Hibrit Öneri** eklentisidir.

### Özellikler

- **⚡ Canlı Arama ve İndir-İzle:** Arama çubuğuna yazılan konuyu YouTube üzerinde tarar, sunucuda mevcutsa hemen oynatır, değilse tek tıkla arka planda sunucuya indirip başlatır.
- **🔥 Akıllı Hibrit Önerilen Videolar:** İzlenen videonun sanatçı ve konusunu ayıklayarak Fediverse kütüphanesindeki ve webdeki en alakalı 20+ videoyu listeler.
- **♿ %100 Ekran Okuyucu Desteği:** TalkBack, NVDA ve Jaws kullanıcıları için dinamik sesli sayaç, kısayol yardım penceresi ve erişilebilir kontroller.
- **💬 Orijinal YouTube Yorumları:** İçe aktarılan videoların orijinal topluluk yorumlarını izleme sayfasında anlık gösterir.

---

## 📄 License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

Developed with ❤️ by **Enes Yakıştır** and the **YakNet** Community.
