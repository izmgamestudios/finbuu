# Finbuu — Açık Kaynak Teknoloji Pazarı

Girişimci Caddesi (girisimcaddesi.ortakofis.org) için 65 açık kaynak aracın oyun kataloğu.

## İçerik
| Dosya | Açıklama |
|---|---|
| `data/open-source-tools.json` | 13 kategori, 65 araç: lisans, repo, website, docs, community, support, 3 adımlı kullanım, oyun etkisi |
| `game/toolsCatalog.js` | Node.js + Socket.io modülü: `tools:list`, `tools:install`, `tools:uninstall`, etki hesaplama, aylık hosting gideri |
| `scripts/build_catalog.py` | JSON'u yeniden üreten kaynak script (araç eklemek için burayı düzenle) |

## Kurulum (server.js)
```js
// server.js
const { registerToolSocketHandlers, getMonthlyHostingCost, getCompanyEffects } = require('./game/toolsCatalog');

io.on('connection', (socket) => {
  registerToolSocketHandlers(io, socket, {
    getCompany: (s) => state.companies.get(s.data.companyId) || null,
    roomOf: (s) => s.data.roomId || null,
  });
});

// Mevcut aylık tick içinde:
// company.coins -= getMonthlyHostingCost(company);
// const fx = getCompanyEffects(company); // fx.customerRetention, fx.conversionRate ...
```

## Oyun mantığı
- Lisans = 0 coin, ama `setupCost` (kurulum emeği) + `monthlyHostingCost` (sunucu) gerçek giderdir.
- `tier` 1–4 → `unlockLevel` 1/3/6/10.
- Aynı stat'a binen etkiler %35 ile sınırlı.
- `licenseType`: `osi` | `fair-code` | `source-available` → UI'da rozet olarak göster (n8n, Directus, Dify, Open WebUI).

## Doğrulama
- 60 GitHub repo `git ls-remote` ile doğrulandı (2026-11-20).
- Blender, GIMP, Krita, Inkscape, GitLab kendi Git sunucularında; resmi adresler kullanıldı.
