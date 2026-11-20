# Finbuu Yol Haritası — "Fikir Geliştirme ve Değer Önerisi"

Slogan: **Fikir Geliştirme ve Değer Önerisi** (EN: *Idea Development & Value Proposition*). Başlıkta ve sayfa başlığında gösterilir.

Her sprint küçük, test edilebilir ve tek başına yayınlanabilir. Sıra, **zaman-pazara-çıkış** ve teknik bağımlılıklara göre seçildi.

| Sprint | Kapsam | Durum |
|---|---|---|
| **5** | Slogan, Shift ile koşma, mobil joystick'te 2 kademe (yürü / koş), tema (sistem · açık · koyu) | ✅ Tamam |
| **6 — Sohbet & sosyal** | Yakınlık konuşması ("Ahmet'ten Ayşe'ye mesaj") herkese açık sohbete düşer · mobilde mavi "Gir" yanında yeşil "Konuş" (masaüstünde T) · kafa üstü konuşma baloncuğu · hızlı emoji · açılır/kapanır paneller (başlığa tıkla, ▤ yan panel, ▾ üst göstergeler) | ✅ Tamam |
| **7 — Zaman & finans kontrolleri** | Oyun hızı 0.5x/1x/2x/3x (oda sahibi değiştirir, odaya özel) · yatırım ve kâr payı çekmede 1–100 çubuk + elle rakam · pazarlama bütçe çubuğu (10–100, 50 = standart) · gün bazlı timeline (Cadde Olayları) · öneri çubuğunda ◀ önceki, sayaç, küçült | ✅ Tamam |
| **8a — Ürünler & sihirbaz** | Şirket başına en fazla 8 ürün/hizmet (ad, liste fiyatı, %0–90 indirim) · satışta ürün seçimi · sihirbaz: ⚡ Hızlı (2 adım), 🧭 Standart (4), 🔬 Ayrıntılı (7: ek ürün, indirim, özet) | ✅ Tamam |
| **8b — Vergiler & giderler** | Yıl sonu (360. gün) kademeli gelir vergisi (2026 dilimleri) · damga vergisi (kira binde 9,48, bordro binde 7,59) · muhasebeci seviyesi (yok +%15 ceza / temel / pro −%7) · dükkânda elektrik, su, doğalgaz, internet faturaları (sabit %60 + değişken %40, doğalgaz mevsimsel) ve kapatmanın satışa etkisi | ✅ Tamam |
| **9 — Reklam sistemi** | Billboard, otobüs durağı, otobüs giydirme, mobil meta reklam, bina duvarı/çatı · görsel URL veya metin (font boyutu, renk) · admin ve şirket sahibi yönetir · **her reklam yayına girmeden admin onayından geçer** | ⬜ |
| **10 — Araç** | Galeriden sıfır/ikinci el araç · bina kapısında sabit park, otopark · kiralık aracın kalan süresi (üst bar) | ⬜ |
| **11 — Harita & şehirler** | Minimap (M tuşu, mobilde harita ikonu) · Türkiye haritasından şehir seçimi (bazıları Premium/"pek yakında") · otobüs terminali, şehirler arası seyahat (maliyet + süre), özel/kiralık araçla seyahat · aynı odada farklı şehirler | ⬜ |
| **12 — Ev** | Kılavuzun solunda ev · kişisel harcamalar · ev içi: kişisel faturalar, hobi, kendini geliştirme | ⬜ |
| **13 — Çok oyunculu iç sahne** | Aynı binaya giren oyuncular iç sahnede birbirini görür · takım arkadaşını yanına çağır / yanına git · açık odalar listesi (şifre ile giriş) · AFK ve offline devam (tarayıcı tarafında saklanır) | ⬜ |
| **14 — Satış roleplay** | İşyeri içinde müşteriyle soru-cevap · olumlu/olumsuz yanıt · satışın tamamlanması, yarım kalması veya artması | ⬜ |
| **15 — Başlangıç & yardım** | İlk girişte atlanabilir tutorial · chatbot · yardım penceresi · oyun içi ayrıntılı arama (işletme, üye, görev, özellik) | ⬜ |
| **16 — Premium yönetimi** | Admin Premium'u aç/kapa, şehir ve özellik kilitlerini yönet | ⬜ |
| **17 — Mini SaaS** | ERP/CRM/KPI aracı · takvim yönetimi · Gantt şeması | ⬜ |
| **18 — Sesli sohbet** *(en sonda, Premium · şimdilik "pek yakında")* | Bina boyu mesafede yakın sesli sohbet (mikrofona basınca kubbe, mute/ses ayarı) · sesli mesaj baloncuğu (oynat/duraklat/durdur) · fon müziği ve efektler | 🔒 Pek yakında |
| **19 — Sesli/görüntülü toplantı** *(en sonda, Premium · şimdilik "pek yakında")* | Başka şehirdeki firma/NPC/oyuncuyla sesli veya videolu görüşme · anlaşma kesinleşirse yüz yüze görüşme randevusu roleplay'i | 🔒 Pek yakında |

## Sprint 7 notları
- Hız oda bazlıdır: bir oda 3x, diğeri 1x çalışabilir. Gün süresi `tickSeconds / hız`. Hız değişince saat sıçramaz.
- Oda sahibi = odaya ilk giren oyuncu; ayrılırsa sıradaki oyuncuya geçer. Admin için `adminSetSpeed` olayı hazır (arayüzü Sprint 16'da).
- Kâr payı çekme artık kasadan fazla olamaz; eski "%20" davranışı, tutar verilmeyen çağrılarda (Öneri/Tamam, `/cek`) aynen duruyor.
- Muhasebe ve İT güvenlik seviyeli/sabit işlemlerdir, çubuk gerektirmez. Çubuk, tutarı serbest olan her işleme (yatırım, kâr payı, pazarlama) eklendi.

## Sprint 8a notları
- `c.price` birincil ürünün liste fiyatı olarak kaldı; Öneri, raporlar ve sunum eskisi gibi çalışır. Ürünler `c.products` içinde.
- Pasif (çalışan) satışlarda indirim talebi artırır (esneklik 1.5), her ek ürün pazarı %5 genişletir; yani %10–30 indirim hafif kazançlıdır, %40+ zarar yazar. Elle satışta ve alışta indirimli fiyat ödenir.
- Ürün ekleme/düzenleme/silme yalnızca kurucular içindir; son ürün silinemez.

## Sprint 8b notları
- Vergi oranları `economy.js` içinde, 2026 TR verisine göre; gelir vergisi dilimleri (190.000 / 400.000 / 1,5 M / 5,3 M ₺) ve muhasebe ücretleri **tahmini** işaretli (arayüzde `*`) ve resmî kaynaktan doğrulanmalı.
- Vergi yıl sonunda, o yılın net kârı (11 kapanmış ay + son gün) üzerinden ödenir; gelir vergisi kendi matrahından düşülmez. Zarar devri (önceki yıl zararı) yok.
- NPC şirketleri vergi, damga, muhasebe ve fatura kalemlerinden muaftır; böylece cadde dengesi değişmedi.
- Fatura kalemleri yalnızca oyuncu dükkânlarında. Kapatmanın etkisi: elektrik −%60 satış, internet −%15, su −%5, doğalgaz (kışın) −%10.
- Gider dökümü raporlara eklendi (vergi, fatura, damga, muhasebe; CSV sütunları dahil). Bunlar toplam `expenses` içinde bir alt kırılımdır.

## Kararlar
- **Veri saklama:** Şimdilik tarayıcıda (localStorage/çerez) yönetilir. SQLite/PostgreSQL daha sonra bağlanacak; bunun için durum okuma/yazma tek bir katmandan geçmeli (depolama arayüzü), böylece geçiş tek yerde yapılır.
- **Sesli ve görüntülü iletişim** en sona bırakıldı; arayüzde "Premium · pek yakında" olarak kilitli gösterilir.
- **Reklamlar** yayına girmeden admin onayı ister.

## Teknik notlar ve riskler
- **Sesli/görüntülü iletişim (Sprint 18–19):** WebRTC gerekir. Çok oyunculu odalarda mesh bağlantı ~6–8 kişiden sonra zorlaşır, TURN sunucusu (NAT arkası kullanıcılar için) ek maliyet ve kurulum demektir. İlk sürüm sadece yakın mesafedeki 2–6 kişi için olmalı. Video görüşme ayrı bir sprint ve büyük olasılıkla harici servis (LiveKit vb.) gerektirir.
- **Reklam yönetimi (Sprint 9):** Kullanıcıların girdiği görsel URL'leri ve metinler kötüye kullanım riski taşır. Karar: her reklam admin onayından geçer. Ayrıca URL yalnızca `https` görsel olmalı, boyut sınırı konmalı.
- **Gerçek zamanlı oyun hızı (Sprint 7):** Hız oda genelinde tek olmalı (sunucu saati). Sadece oda sahibi veya admin değiştirebilsin, aksi halde oyuncular birbirinin saatini bozar.
- **Şehirler arası seyahat (Sprint 11):** Her şehir ayrı bir cadde olduğundan, sunucu durumu (oyuncu konumu, şirket, NPC) şehir bazlı bölünmeli. Önce 2–3 şehirle başla.
- **Offline/AFK devam (Sprint 13):** Veriler tarayıcıda saklandığı sürece oyuncu başka cihazdan devam edemez ve sunucu yeniden başlayınca oda durumu kaybolur. Bu bilinçli bir MVP kararı; veritabanı bağlanınca düzelir.
