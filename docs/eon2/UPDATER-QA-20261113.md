# Updater doğrulaması — 13 Kasım 2026

Sürüm: `2.0.0-preview.2`, Android versionCode: `2`.

## Değişiklik ve neden

Eon 2 normal başlangıcı eski UpdateManager'ı başlatmıyordu. Eski updater indirme/restart modal pencereleri açıyor, yeni renderer'ın izinli IPC yüzeyinde güncelleme kanalı bulunmuyordu. Android sürüm kodu bütün yayınlarda 1 kaldığından daha yeni companion karşılaştırması yapılamıyordu.

Mevcut electron-updater/NSIS altyapısı, arka planda indirme ve yalnızca açık kullanıcı eylemiyle kurulum için düzenlendi. Eon 2 runtime, izinli durum/denetle/indir/kur IPC'sini ve event'ini başlatır. Başlık düğmesi güncelleme yokken görünmez; Ayarlar da aynı durumu gösterir. Android ve Windows companion yolu aynı GitHub release manifestini tüketir. USB kurulumu ayrıca native onay ister; bağımsız Android yolu Android paket kurucusunu kullanır.

## Çalıştırılan kontroller

- `npm run build`: TypeScript renderer/main + Vite üretim derlemesi çıkış 0. Son paketleme ayrıca aynı derlemeyi çalıştırır.
- `npm run test:eon2`: **110/110**, çıkış 0. Updater testleri hash/kimlik/boyut sınırları, bozuk APK, yeniden deneme, indirme deduplikasyonu, ayrı telefon onayı, sürüm karşılaştırması ve kurulum kapısını kapsar.
- `electron/eon2/updates/updates-smoke.cjs`: çıkış 0. Gerçek Electron/preload/UI; güncel sürümde düğmenin gizlenmesi, %42 ilerleme, başlıktan Ayarlar'a geçiş, native modal/iptal/kurulum eylemi, açık tema ve 720/900/1440/1920/3840 genişlikleri. Installer çağrısı mock; gerçek kurulum yapılmadı. Koyu/açık ekran görüntüleri `docs/eon2/qa-updates/` altında yerel olarak tutulur.
- Temiz ASCII yolundaki aynı Android kaynağında `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --max-workers=2 --console=plain`: çıkış 0, **15/15 birim testi**, lint **0 hata, 51 uyarı, 2 ipucu**. Önceki `:app:connectedDebugAndroidTest` komutu çıkış 0 verdi, fakat enstrümantasyon kaynak setinde test vakası yoktur; fiziksel updater UI/kurulum kabulü olarak sayılmaz.
- Android manifest testleri geçerli release kimliğini, paket/tag uyuşmazlığını, hash ve boyut sınırlarını denetler. USB cihazı `V2205` yetkili olarak görüldü; mevcut companion versionCode=1 idi. Bu oturumda telefondaki uygulama silinmedi ve gelecekteki daha yeni sürüme fiziksel OTA kurulumu iddia edilmez.
- Kullanıcının açık onayıyla mevcut companion keystore'u `EON_ANDROID_UPDATE_KEYSTORE_B64` GitHub repository secret'ına yazıldı; yalnızca secret adı/kayıt zamanı doğrulandı. Anahtar kaynaklara ve loglara eklenmedi.
- `npm run dist`: çıkış 0; Android ve tam scrcpy staging, NSIS paketleme, `eon-update.json` ve SHA256SUMS üretimi birlikte tamamlandı. Paketlenmiş app.asar sürümü `2.0.0-preview.2`; installer 157.476.332 bayt. APK 19.906.246 bayt; aapt paket kimliği/versionCode=2/versionName değerlerini doğruladı. Windows imza durumu `NotSigned`.

Yerel loglar: `builds/publish/update-build.log`, `update-tests-final.log`, `updates-smoke.log`, `updater-dist.log`. Android test XML/lint raporları `%TEMP%/EonUpdater-20261113-Android/app/build/` altında.

## Sınırlar

- İlk Eon 2 preview.1 başlangıcında updater olmadığı için preview.2'ye bir kez elle geçiş gerekir. Sonraki sürümler daha yüksek Android versionCode, aynı paket/imza ve tam güncelleme ekleriyle yayımlanmalıdır.
- Windows Authenticode imzası eklenmedi; companion geliştirme kimliği korunur. Kararlı/Play Store üretim kabulü iddia edilmez.
- Gerçek daha yeni Windows sürümünün indir/kapat/NSIS/yeniden aç döngüsü, fiziksel Android paket kurucusunun onayı, USB çıkar/tak sırasında kurulum, TalkBack/200% yazı ve işletim sistemi süreç öldürme matrisi ayrıca kabul edilmelidir.
- İndirme süreç içinde devam eder. İşletim sistemi süreci sonlandırırsa tamamlanan doğrulanmış APK tekrar kullanılır; yarım APK sonraki denemede yeniden indirilir. Byte seviyesinde kaldığı yerden devam vaat edilmez.
- Android lint'in uygulama bağlamı kullanan process singleton için StaticFieldLeak uyarısı ve mevcut diğer uyarıları bastırılmadı.
