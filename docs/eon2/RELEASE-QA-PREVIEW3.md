# Eon 2.0.0-preview.3 yayın adayı

13 Kasım 2026, Europe/Istanbul. Android versionCode: 3. Bu belge yayın onayı değildir.

- `npm test`: çıkış 0.
- `npm run test:eon2`: çıkış 0, 113 test geçti; USB kurulum ve güncelleme testleri dahil.
- `npm run build`: çıkış 0; Vite büyük parça uyarısı verdi.
- `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug --offline --max-workers=2 --console=plain`: proje yolunda çıkış 1; APK derlendi fakat test sınıfları çalıştırılamadı.
- Aynı Android kaynaklarının ASCII yoldaki temiz kopyasında `:app:testDebugUnitTest :app:lintDebug --offline --max-workers=2 --console=plain`: çıkış 0, 15 test geçti ve lint tamamlandı. İlk hatanın nedeni kesinleştirilmedi.
- Önceki staging APK ve yerel aday APK, `apksigner verify --print-certs` ile aynı geliştirme sertifikası SHA-256 özetini verdi.
- Cihaz `V2205` USB üzerinden yetkili görüldü. Sıfırdan otomatik kurulum ve otomatik güncelleme fiziksel cihazda doğrulanmadı.
- Windows Authenticode kod imzalama sertifikası yerel kullanıcı ve makine sertifika depolarında bulunmadı; GitHub repository secret listesinde de Windows imzalama anahtarı görünmedi. Bağımsız inceleme ve diğer yayın kabul kapıları tamamlanmadı.
- Ayrı bir geçici kaynak kopyasında `npm run dist`: Android staging başarılı; electron-builder bağımlılık paketleme aşamasında birkaç dakika ilerleme çıktısı vermediğinden işlem durduruldu (çıkış 1). Tam Windows installer ve yayın manifesti üretilmedi. Geçici kopya mevcut `node_modules` dizinine junction kullanıyordu; durmanın nedeni kesinleştirilmedi.
