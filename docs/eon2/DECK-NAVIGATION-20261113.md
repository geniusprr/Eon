# Deck gezintisi ve Kısayollar — 13 Kasım 2026

Dikey mobil ekranda sabit alt boşluk kaydırma alanını kısaltıyordu. Sekme çubuğu artık içerikten bağımsız yerleşiyor; son öğenin erişilebilir kalması için gereken boşluk listenin sonuna ekleniyor. Alt gölge koyu temada siyah, açık temada beyaz. Ayarlar başlıkta; ortadaki yön işaretli Eon düğmesi yatay Deck’i, Deck çubuğunun solundaki Eon düğmesi dikey ekranı açıyor.

Deck ekranları Android’de yatay kaydırma, oklar ve ekran seçicisiyle açılıyor. Komut sayısına göre üretilen Tuşlar sayfalarının yerini tek, dikey kaydırılan Kısayollar ekranı aldı. Seçim ve sıralama Android ve masaüstünde aynı Deck revizyonunda kaydediliyor. Bu düzen, diğer ekranlardaki altı hızlı tuştan bağımsız. Boş liste ve varsayılan liste birbirinden ayrı; önceki istemciler düzeni kaydederken yeni alanı koruyor. Mevcut komut izinleri geçerli.

13 Kasım 2026, 00:36–00:43 TRT doğrulaması:

- Temiz masaüstü kopyasında `npm run build` ve `electron/eon2/deck-mirror-smoke.cjs` çıkış 0. 22 tuşlu liste, kaydırma, dört/beş sütun, sıralama ve kaldırmanın kaydı, açık tema ve beş pencere boyutunda Deck sınırları kontrol edildi. Çalışma alanında son React ve Electron TypeScript kontrolleri çıkış 0.
- Deck düzeni, renderer ve imzalı USB testleri 20/20; not protokolü, SQLite, ADB, scrcpy ve USB doğrulama grubu 31/31. İkinci grup, Kısayollar sırasının imzalı USB isteğiyle kaydedilip okunmasını da doğruladı.
- Temiz Android kopyasında `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:connectedDebugAndroidTest --offline --max-workers=2` çıkış 0. Birim testleri 12/12; lint 0 hata, 49 uyarı. Enstrümantasyon kaynak setinde test vakası bulunmuyor.
- `com.kapanis.mobil.eon2.dev` APK’sı Vivo V2205, Android 14 üzerine kuruldu. Koyu temada çubuğun arkasından geçen içerik, başlıktaki Ayarlar, iki yönde ekran değişimi, Deck kaydırması, ekran seçicisi ve Kısayollar düzenleyicisinin açılıp iptal edilmesi cihazda görüldü.

Android açık teması fiziksel cihazda doğrulanmadı. Fiziksel testte mevcut PC düzeni değiştirilmedi; telefon ve masaüstü arasında canlı kaydetme, kare süresi ölçümü ve erişilebilirlik matrisi ayrıca doğrulanmalı. Üretim paketi dağıtılmadı.
