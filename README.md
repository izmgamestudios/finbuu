# 🏙 Finbuu

> **Fin**ance + **Bu**siness — a multiplayer startup & finance management game.

Web tabanlı, yandan görünümlü (Mario / Metal Slug tarzı) **multiplayer idle girişimcilik oyunu**.
Oyuncular 10 m² dükkandan coworking'e, sanal ofisten gökdelene uzanan bir caddede şirket kurar, ortak olur, çalışır, yatırım yapar.

A web-based, side-scrolling **multiplayer idle entrepreneurship game**. Found companies, co-found, get hired, invest, and grow from a 10 m² shop toward skyscrapers.

## ✨ Özellikler / Features (Sprint 1)
- **Modlar:** Solo (sen + NPC'ler), Multiplayer (oda linki + 4 haneli şifre), Online (🔒 kilitli, yakında)
- **Çalışma alanları:** Home office, sanal ofis, e-ofis, coworking (6 şirket paylaşır), 10/50/100 m² dükkanlar (kira paylaşımlı)
- **Ekonomi:** Kira, elektrik, maaş, yan haklar (ulaşım, sigorta, yemek), gelir, müşteri, yatırım, kâr payı
- **Kariyer:** Deneyim (XP), seviye, bilgi, başarı, performans — yan hak veren şirkette çalışmak performansı artırır
- **NPC botlar:** Müşteri, sponsor, yatırımcı, hırsız, dolandırıcı
- **Kılavuz binası**, seed data (şablon işletmeler, NPC şirketler, tutorial)
- **Fikir kutusu** (yazılı). Sesli/videolu fikir 🔒 Premium (bulut depolama ile)
- **i18n:** Türkçe + İngilizce (i18next), responsive (mobil alt menü + hamburger, masaüstü yan panel)
- **Admin dashboard:** Canlı KPI'lar, oda/oyuncu/şirket yönetimi, ekonomi ayarları, duyuru, NPC olayı tetikleme
- **Finans raporları:** Oyun takvimi (1 tur = 1 gün, 30 gün = 1 ay, 360 gün = 1 yıl), aylık / çeyreklik / yıllık; şirket, çalışan ve karşılaştırmalı raporlar; durum analizi (battı / riskli / stabil / büyüyor / yatırım alabilir / exit hazır), CSV & JSON export, tam oyun yedeği export/import
- **🔒 Premium / sonraki sprintler (bulanık gösterilir):** Ideathon, Hackathon, Game Jam, Bootcamp, hızlandırıcılar, KOSGEB, TÜBİTAK, melek yatırımcı, Seed, Seri A/B, kitlesel fonlama, halka arz, apartman, gökdelen, pazar araştırması, rakip analizi

## 🚀 Kurulum / Setup
```bash
npm install
cp .env.example .env            # ADMIN_TOKEN değerini değiştir
ADMIN_TOKEN=uzun-rastgele-bir-sifre npm start
```
- Oyun / Game: http://localhost:3000
- Admin: http://localhost:3000/admin.html

> `ADMIN_TOKEN` en az 12 karakter olmalıdır; yoksa sunucu başlamaz.
> Sürekli çalışması için: `pm2 start server.js --name finbuu`

## 🗂 Proje Yapısı / Structure
```
server.js              # Game server, economy tick, NPC events, admin socket + HTTP API
reports.js             # Game calendar, finance ledger, analysis, CSV export
public/index.html      # Game client (canvas + i18next, responsive)
public/admin.html      # Admin dashboard (Chart.js)
public/locales/*.json  # tr / en translations
```

## 🧱 Mimari Notlar / Architecture Notes
- State **bellekte** tutulur (veritabanı bilinçli olarak sonraki faza bırakıldı). Admin panelindeki "Tüm Oyun Yedeği" ile JSON yedek alınıp geri yüklenebilir.
- Sunucu tüm metinleri **çeviri anahtarı** olarak gönderir; aynı odada farklı dillerde oynanabilir.
- Admin yetkisi: `ADMIN_TOKEN` (timing-safe karşılaştırma, 5 hatalı denemede 15 dk kilit).

## 🗺 Yol Haritası / Roadmap
- [ ] Kalıcı veritabanı (PocketBase veya Supabase)
- [ ] Sesli/videolu fikirler için bulut depolama (ör. Cloudflare R2) — Premium
- [ ] Online mod (herkese açık sunucular)
- [ ] Ideathon, Hackathon, Game Jam, Bootcamp etkinlikleri
- [ ] Yatırım turları, hibeler, halka arz, apartman & gökdelen

## 🤝 Katkı / Contributing
Bkz. [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 Lisans / License
MIT © Hüseyin Bayer / IZM Game Studios
