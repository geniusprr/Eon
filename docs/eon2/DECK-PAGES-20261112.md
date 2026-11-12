# Çoklu Deck ekranları — 12 Kasım 2026

## Davranış

Desktop ana sayfasındaki ekran seçicisinden Panel, Tuşlar ve kullanıcı ekranları açılır. Ekran ekleme, çoğaltma, adlandırma, sıralama, silme ve seçilen ekranın kart/kısayol düzenini değiştirme desteklenir. Her kullanıcı ekranı kendi kimliğini, adını, 12×6 kart yerleşimini ve altı hızlı kısayol seçimini taşır. Tuşlar görünümü tüm PC komutlarını açar.

Android yatay Deck aynı kayıtlı ekranları sıralı gösterir. Çok sayıda ekran için Ekranlar seçicisi doğrudan geçiş sağlar. Mevcut ana Panel ve otomatik Tuşlar sayfaları korunur.

Önceki model yalnızca tek panel yerleşimi saklıyor, Tuşlar sayfalarını komut sayısından üretiyordu. Mevcut PC otoritesi, atomik dosya kaydı, revizyon kontrolü ve izinli IPC/USB yolları yeni `pages` alanıyla genişletildi. Eski istemcinin `pages` göndermeden yaptığı kayıtlar yeni ekranları korur. Sabit ekran adedi sınırı yoktur; toplam düzen isteği/dosyası 8 MiB ile sınırlıdır. 300 ekranla kayıt, yeniden açma ve bağımsız snapshot kontrolü yapıldı.

## Bu görevde değiştirilen kaynaklar

- `shared/contracts.ts`: DeckPage ve isteğe bağlı ekran listesi.
- `electron/eon2/deck/DeckLayoutStore.ts`: ekran doğrulama, kalıcı kayıt ve eski istemcileri koruma.
- `electron/eon2/deck/DeckLayoutStore.test.ts`: çoklu ekranların kalıcılığı, izolasyonu ve geçersiz veri kontrolleri.
- `electron/eon2/transport/UsbPairingServer.test.ts`: genişleyen toplam düzen boyut sınırı kontrolü.
- `src/eon2/DeckMirror.tsx`: desktop ekran yönetimi ve seçili ekranın bağımsız düzenlenmesi.
- `src/eon2/deck-mirror.css`: ekran yönetimi, ad formu ve tüm tuşlar görünümü.
- `src/eon2/deckMirrorLayout.ts`: ortak ekran tipleri ve renderer doğrulaması.
- `src/eon2/deckMirrorLayout.test.ts`: ekran doğrulama ve snapshot izolasyonu.
- `mobil/app/src/eon2/kotlin/com/kapanis/mobil/eon2/ui/DeckLayoutModel.kt`: ekran listesi wire/cache modeli.
- `mobil/app/src/eon2/kotlin/com/kapanis/mobil/eon2/ui/LandscapeDeck.kt`: yeni ekranların pager görünümü ve ekran seçimi.

Çalışma alanındaki diğer değişiklikler korunmuştur.

## Doğrulama

- `npx tsc -b`: geçti (standart build adımında).
- `npx tsc -p tsconfig.electron.json --noEmit`: çıkış 0.
- `npx vite build --outDir C:/Users/Deha/AppData/Local/Temp/eon-deck-pages-desktop-build-20261112`: çıkış 0. Büyük bundle uyarısı var.
- `npx --no-install tsx --test electron/eon2/deck/DeckLayoutStore.test.ts src/eon2/deckMirrorLayout.test.ts electron/eon2/transport/UsbPairingServer.test.ts`: çıkış 0, 19/19 test geçti.
- Playwright ile gerçek tarayıcı ve yalıtılmış IPC fixture kullanıldı: ekle, adlandır, çoğalt, sırala, düzenleyiciyi aç/kapat, tüm tuşlara geç, ekran düzenini bağımsız kaydet, ekranlar arası geç ve sil. Ana Panelin ve diğer ekranın düzeni korundu; silme sonrası Panel seçildi. 1440×900 ekran görüntüsü incelendi (`C:/Users/Deha/AppData/Local/Temp/eon-pages-desktop.png`). Bu kontrol gerçek USB senkron kabulü değildir.
- Standart `npm run build` tekrarında önce bellek yetersizliği, sonra kullanılan `dist/eon.svg` üzerinde EBUSY alındı. Son Vite doğrulaması bu nedenle ayrı çıktı klasöründe yapıldı.
- Android ilk denemede Kotlin artımlı derleme yedeği hatası; sonraki denemede uygulama paketleme aşaması tamamlandı ancak tüm birim testleri legacy `RemoteCoordinateMapperTest.kt` içindeki artık derlenmeyen v1 referanslarında durdu. Son Android doğrulaması kaynakların sabit geçici kopyasında, `RemoteCoordinateMapperTest.kt` hariç tutularak çalıştırıldı; proje kaynak setleri değiştirilmedi. Bu kopyada `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --max-workers=1` çıkış 0 ile tamamlandı (51 görev, 6 dakika 8 saniye). Eon 2 birim testleri 9/9 geçti; Android lint geçti. Lint raporu: `C:/Users/Deha/AppData/Local/Temp/eon-deck-pages-android-snapshot-20261112/app/build/reports/lint-results-debug.html`. APK: `C:/Users/Deha/AppData/Local/Temp/eon-deck-pages-android-snapshot-20261112/app/build/outputs/apk/debug/app-debug.apk`.

Fiziksel telefonda ekran senkronizasyonu, çok yüksek ekran sayısında performans, TalkBack/font ölçeği ve yayın kabulü bu görevde doğrulanmadı. Kurulu uygulamalar otomatik güncellenmez; yeni desktop/Android sürümleri gerekir.
