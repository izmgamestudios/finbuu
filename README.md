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
### Sprint 2
- **Karakter & hareket:** Her oyuncunun avatarı var. Masaüstü: A/D veya ←/→ ile yürü, tıkla-git, W/↑ ile binaya gir. Mobil: sol altta joystick, sağ altta "Gir" butonu, binaya dokun.
- **Yandan görünüm cadde:** Paralaks silüet, bulutlar, ağaç ve lambalar. Binaların zemin katı kesit (iç mekan, tezgah, raf, masa, çalışanlar); camda, balkonda ve terasta NPC'ler; caddede dolaşan NPC'ler; olaylarda (müşteri, yatırımcı, hırsız…) binaya yürüyen NPC.
- **Finansa göre bina yüksekliği:** Kasa büyüdükçe bina kat kazanır (250c → 1 kat, her ikiye katlanmada +1, en fazla 6), zarar edince küçülür. Çatıda 💰 kasa ve ▲▼ trend.
- **Sistem önerisi:** Her panelde ⭐ varsayılan seçenek. Üstte "✓ Tamam / ⏭ Sonraki / ▶▶ Otomatik" çubuğu; Enter = onayla, N = sonraki. Otomatik modda karakter hedef binaya yürür ve öneriyi uygular.
- **HUD & finans paneli:** Üstte para, kasa (sonraki kata ilerleme), müşteri, çalışan, bugün ve bu ay gelir/gider, seviye barları. Yan panelde anlık + aylık KPI'lar, kasa çizgisi, günlük ve aylık gelir/gider grafikleri, tablo görünümü. Bina panelinde mini finans şeridi ve kasa sparkline.

### Sprint 3
- **Performans (30-50+ oyuncu):** State yayını birleştirildi (oda büyüdükçe 5/sn → 1.25/sn), snapshot küçültüldü (finans geçmişi istek üzerine `finHistory`), konumlar 100 ms'lik toplu paketlerle (`posBatch`), WebSocket sıkıştırması (`perMessageDeflate`). Yük testi: 100 eşzamanlı istemci, ~%15 CPU, p95 ping 1 ms.
- **Durum paneli (F3):** FPS, kare süresi, ping, oyuncu, NPC, sync/sn, state boyutu, kalite. Otomatik kalite: FPS < 40 olunca NPC sayısı ve dekoratif figürler azalır.
- **Şirket içi sahne:** Binaya girince zoom-in geçişi; aynı yandan 2D dilde bina kesiti. Katlar: Satış + Finans → Muhasebe + Pazarlama (500c) → İK + IT (1000c) → Ar-Ge + Yönetim (Premium). W/↑ kat çık, S/↓ kat in / dışarı çık, E departmanı aç.
- **Departman aksiyonları:** Pazarlama kampanyası (+%30 satış, 7 gün), IT güvenlik (siber hasar −%25/seviye), İK NPC çalışan (pasif gelir), muhasebe gelir-gider tablosu.
- **Cadde sıralaması (Space / Ctrl / 🏆):** Kasa, aylık kâr, satış, çalışana göre; binalarda #sıra rozeti.
- **NPC diyalogları + kimlik kartı:** Tanış, ürün sat, işe al, iş başvurusu (İK uzmanı NPC), danışmanlık al. Sunucu NPC başına günlük limit uygular.
- **20 şablon + "Diğer":** Kendi ürün/hizmetini, sektörünü ve fiyatını tanımla; 4 adımlı kurma sihirbazı.
- **Sunum (izleme) modu:** Admin "🎤 Sunum Odası" açar. Katılımcılar yürümez; öneri çubuğu, sohbet komutları (`/sat`, `/kur`, `/yatir 100`…), anketler ve sihirbazla oynar. Admin: kamera (otomatik tur / şirket / serbest), sohbet kilidi, işlem durdurma, susturma, mesaj silme, anket.
- **Odalar:** 6 haneli rakam oda kodu; oda kurarken 4-6 haneli şifre belirlenebilir.

- **🔒 Premium / sonraki sprintler (bulanık gösterilir):** Ideathon, Hackathon, Game Jam, Bootcamp, hızlandırıcılar, KOSGEB, TÜBİTAK, melek yatırımcı, Seed, Seri A/B, kitlesel fonlama, halka arz, apartman, gökdelen, pazar araştırması, rakip analizi

## 🚀 Kurulum / Setup
```bash
npm install
cp .env.example .env            # ADMIN_TOKEN değerini değiştir
npm start                       # .env otomatik yüklenir (Node >= 20.12)
# veya / or: ADMIN_TOKEN=uzun-rastgele-bir-sifre npm start
```
- Oyun / Game: http://localhost:3000
- Admin: http://localhost:3000/admin.html

> `ADMIN_TOKEN` en az 12 karakter olmalıdır; yoksa sunucu başlamaz.
> Sürekli çalışması için: `pm2 start server.js --name finbuu`

## 🗂 Proje Yapısı / Structure
```
server.js              # Game server, economy tick, NPC events, admin socket + HTTP API
reports.js             # Game calendar, finance ledger, analysis, CSV export
public/index.html      # Game client shell (HUD, advisor bar, finance panel)
public/js/world.js     # Street renderer: buildings, interiors, people, ambient NPCs
public/js/advisor.js   # Suggestion engine (OK / Next / Auto)
public/js/app.js       # Input (keys, click, joystick), camera, socket, charts
public/css/game.css    # Calm light/dark theme
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
