# Katkı Rehberi / Contributing

Teşekkürler! / Thank you for contributing!

1. Repo'yu fork'la ve `feature/kisa-aciklama` adında bir branch aç.
2. Değişiklikleri küçük ve test edilebilir tut (bir PR = bir konu).
3. Yeni metin eklerken **hem** `public/locales/tr.json` **hem** `public/locales/en.json` dosyasına aynı anahtarı ekle. Sunucu asla düz metin göndermez, sadece çeviri anahtarı gönderir.
4. Kullanıcı girdilerini sunucuda doğrula (`clean()`, `num()` yardımcıları). İstemcide `innerHTML` yerine `textContent` kullan.
5. Asla gizli anahtar (token, şifre) commit'leme. `.env` dosyası `.gitignore` içinde.
6. PR açıklamasında ne değiştiğini ve nasıl test ettiğini yaz.

Code style: 2 spaces, single quotes, no semicolon-free tricks, keep functions small.
