# Finbuu Yol Haritası — "Fikir Geliştirme ve Değer Önerisi"

Slogan: **Fikir Geliştirme ve Değer Önerisi** (EN: *Idea Development & Value Proposition*). Başlıkta ve sayfa başlığında gösterilir.

Her sprint küçük, test edilebilir ve tek başına yayınlanabilir. Sıra, **zaman-pazara-çıkış** ve teknik bağımlılıklara göre seçildi.

| Sprint | Kapsam | Durum |
|---|---|---|
| **5** | Slogan, Shift ile koşma, mobil joystick'te 2 kademe (yürü / koş), tema (sistem · açık · koyu) | ✅ Tamam |
| **6 — Sohbet & sosyal** | Yakınlık konuşması (X'ten Y'ye) ortak sohbete düşsün · mobilde mavi "Gir" yanında yeşil "Konuş" · kafa üstü konuşma baloncuğu · hızlı emoji · açılır/kapanır sağ/sol/üst/alt paneller | ⬜ |
| **7 — Zaman & finans kontrolleri** | Oyun hızı 0.5x/1x/2x/3x · kâr payı yatır/çek ve tüm finans işlemlerinde 1–100 çubuk + elle rakam · Tamam/Sonraki alt menüsünün geliştirilmesi · timeline | ⬜ |
| **8 — Şirket kurma & giderler** | Birden çok ürün/hizmet · ürün bazlı indirim · hızlı (2/4 adım) ve ayrıntılı (6–8 adım) sihirbaz · gelir vergisi, damga vergisi, muhasebe · dükkânda elektrik/su/doğalgaz/internet, sabit ve değişken giderler | ⬜ |
| **9 — Reklam sistemi** | Billboard, otobüs durağı, otobüs giydirme, mobil meta reklam, bina duvarı/çatı · görsel URL veya metin (font boyutu, renk) · admin ve şirket sahibi yönetir | ⬜ |
| **10 — Araç** | Galeriden sıfır/ikinci el araç · bina kapısında sabit park, otopark · kiralık aracın kalan süresi (üst bar) | ⬜ |
| **11 — Harita & şehirler** | Minimap (M tuşu, mobilde harita ikonu) · Türkiye haritasından şehir seçimi (bazıları Premium/"pek yakında") · otobüs terminali, şehirler arası seyahat (maliyet + süre), özel/kiralık araçla seyahat · aynı odada farklı şehirler | ⬜ |
| **12 — Ev** | Kılavuzun solunda ev · kişisel harcamalar · ev içi: kişisel faturalar, hobi, kendini geliştirme | ⬜ |
| **13 — Çok oyunculu sahne** | Aynı binaya giren oyuncular iç sahnede birbirini görür · takım arkadaşını yanına çağır / yanına git · açık odalar listesi (şifre ile giriş) · AFK ve offline devam | ⬜ |
| **14 — Satış roleplay** | İşyeri içinde müşteriyle soru-cevap · olumlu/olumsuz yanıt · satışın tamamlanması, yarım kalması veya artması | ⬜ |
| **15 — Ses** | Bina boyu mesafede yakın sesli sohbet (mikrofona basınca çevrede yarı saydam kubbe, kubbedekiler duyar, mute/ses ayarı) · sesli mesaj baloncuğu (oynat/duraklat/durdur) · fon müziği ve efektler | ⬜ |
| **16 — Uzak toplantı** | Başka şehirdeki firma/NPC/oyuncuyla sesli veya videolu görüşme · anlaşma kesinleşirse yüz yüze görüşme randevusu roleplay'i | ⬜ |
| **17 — Premium yönetimi** | Admin Premium'u aç/kapa, şehir ve özellik kilitlerini yönet | ⬜ |
| **18 — Başlangıç & yardım** | İlk girişte atlanabilir tutorial · chatbot · yardım penceresi · oyun içi ayrıntılı arama (işletme, üye, görev, özellik) | ⬜ |
| **19 — Mini SaaS** | ERP/CRM/KPI aracı · takvim yönetimi · Gantt şeması | ⬜ |

## Teknik notlar ve riskler
- **Sesli/görüntülü iletişim (Sprint 15–16):** WebRTC gerekir. Çok oyunculu odalarda mesh bağlantı ~6–8 kişiden sonra zorlaşır, TURN sunucusu (NAT arkası kullanıcılar için) ek maliyet ve kurulum demektir. İlk sürüm sadece yakın mesafedeki 2–6 kişi için olmalı. Video görüşme ayrı bir sprint ve büyük olasılıkla harici servis (LiveKit vb.) gerektirir.
- **Reklam yönetimi (Sprint 9):** Kullanıcıların girdiği görsel URL'leri ve metinler **kötüye kullanım** riski taşır. Admin onayı, URL'nin yalnızca `https` görsel olması ve boyut/telif denetimi eklenmeli.
- **Gerçek zamanlı oyun hızı (Sprint 7):** Hız oda genelinde tek olmalı (sunucu saati). Sadece oda sahibi veya admin değiştirebilsin, aksi halde oyuncular birbirinin saatini bozar.
- **Şehirler arası seyahat (Sprint 11):** Her şehir ayrı bir cadde olduğundan, sunucu durumu (oyuncu konumu, şirket, NPC) şehir bazlı bölünmeli. Önce 2–3 şehirle başla.
- **Offline/AFK devam (Sprint 13):** Sunucu, oyuncu çıkınca durumu saklayıp "çevrimdışı hesaplama" ile ilerletmeli. Veriler şu an bellekte; kalıcı depolamaya (SQLite/PostgreSQL) geçmeden güvenilir olmaz. Bu sprintten önce bir kalıcılık sprinti gerekebilir.
