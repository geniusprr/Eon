# Eon güncellemeleri

Eon `2.0.0-preview.2` ile başlayan sürümlerde Windows ve Android, `geniusprr/Eon` GitHub Releases yayınlarını kullanır. Yeni bir uygulama sunucusu, LAN portu veya uzaktan komut yüzeyi açılmaz.

## Kullanıcı akışı

- Uygulama açılışında ve çalışırken dört saatte bir yayın denetlenir. Ayarlar → Güncellemeler → Denetle ile elle de başlatılabilir.
- Windows installer arka planda indirilir; başlık çubuğundaki küçük düğme yalnızca bilinen güncelleme olduğunda görünür. Düğme Ayarlar'daki Güncellemeler bölümünü açıp odaklar.
- Kullanıcı **Yeniden başlat ve kur** → **Kaydettim, kur** seçmeden kurulum başlamaz. Uygulamayı normal kapatmak indirilen sürümü otomatik kurmaz.
- USB ile bağlı, yetkilendirilmiş ve eski Eon companion sürümü kurulu telefon varsa APK arka planda hazırlanır. Masaüstü, telefon adı ve sürümünü belirterek **Daha sonra / Telefona kur** onayı ister. Reddetmek APK'yı silmez; Ayarlar'dan sonra da kurulabilir.
- Telefona ADB üzerinden kurulum yalnızca USB'de yapılır. Tailscale üzerinden ADB açılmaz. Telefon bağımsız olarak aynı yayını HTTPS ile indirebilir; Ayarlar → Güncellemeler → Yeni sürümü kur Android'in paket kurucusunu açar. Gerekirse Android, Eon için bu kaynaktan uygulama yükleme izni ister.
- APK boyutu ve SHA-256 özeti doğrulanır. Android'in kendi kurulum yolunda paket kimliği, sürüm kodu ve mevcut APK imzası da karşılaştırılır. USB kurulumunda Android paket yöneticisi imza uyumunu denetler. Hiçbir hata üzerine mevcut uygulama otomatik kaldırılmaz.
- Kesilen/bozuk APK hazır durumuna geçmez; yeniden denetleme ile yeniden indirilir. Tamamlanan doğrulanmış APK önbellekten tekrar kullanılabilir. İndirme uygulama sürecinde çalışır; işletim sistemi süreci sonlandırırsa sonraki açılışta tekrar denenir.

**İlk geçiş:** `preview.1` içindeki Eon 2 başlangıcı updater'ı çalıştırmıyordu. Bu nedenle `preview.2` installer/APK'sı bir defa elle kurulmalıdır. Sonraki uygun yayınlarda bu akış devreye girer. Güncelleme sonrası yerel veriler/eşleştirmeler korunur; önemli notları ayrıca yedeklemek önerilir.

## Yayın sözleşmesi

Windows, var olan `electron-updater` ve NSIS altyapısını kullanır. Normal kapatmada kurulum kapalıdır; eski sürüme otomatik dönüş kapalıdır. Ön sürüm uygulaması ön sürümleri izler; kararlı sürüm ön sürümleri almaz. GitHub sağlayıcısı kanal dosyasını ve gerektiğinde `latest.yml` dosyasını kullanır.

Companion manifesti yayın eki olarak `eon-update.json` adıyla bulunmalıdır:

```json
{
  "schemaVersion": 1,
  "version": "2.0.0-preview.2",
  "android": {
    "version": "2.0.0-preview.2",
    "versionCode": 2,
    "packageId": "com.kapanis.mobil.eon2.dev",
    "size": 12345678,
    "sha256": "APK_DOSYASININ_64_KARAKTER_SHA256_OZETI"
  }
}
```

Yukarıdaki boyut/özet temsili biçim açıklamasıdır. Gerçek manifesti elle yazmayın: `npm run dist`, Android staging metaverisini ve APK hash'ini doğrulayıp `build/write-update-manifest.mjs` ile üretir. APK adı `Eon-Android-preview.apk` olarak sabittir. İndirme adresi uygulamada bilinen repository + doğrulanmış tag + sabit dosya adından üretilir; manifest serbest indirme/çalıştırma adresi taşımaz.

Her yayında `package.json` sürümünü, Android `versionName` değerini aynı sürüme; Android `versionCode` değerini önceki yayından büyük bir sayıya yükseltin. `npm run dist` bunların uyuşmasını zorunlu kılar. Windows installer, blockmap, güncelleme YAML'ı, APK, `eon-update.json` ve `SHA256SUMS.txt` birlikte yüklenmelidir. Sadece source ZIP yayımlamak updater için yeterli değildir.

## İmza sürekliliği

Mevcut companion geliştirme kimliğidir. Sonraki APK'lar aynı imza anahtarıyla üretilmelidir; aksi halde Android mevcut verileri koruyan güncellemeyi reddeder. İmzayı değiştirmek için uygulamayı kaldırma veya veri silme otomasyonu yoktur.

Kullanıcının 13 Kasım 2026 onayıyla mevcut geliştirme imza anahtarı Eon deposundaki `EON_ANDROID_UPDATE_KEYSTORE_B64` GitHub secret'ına kaydedildi. Release iş akışı anahtarı yalnızca runner'ın Android debug keystore dosyasına yazar; içeriğini loglamaz. Secret eksikse farklı rastgele anahtarla APK yayımlamak yerine iş akışı durur. Secret/keystore içeriği kaynak kontrolüne eklenmez.

## Doğrulama kapsamı

Odaklı testler: eşzamanlı indirme koruması, yeniden deneme, kuruluma hazır olma koşulu, açık kurulum eylemi, ayrı telefon onayı, hash/kimlik/boyut reddi, kurulu sürüm karşılaştırması ve IPC sınırı. Electron UI smoke, başlık düğmesinin gizlenmesini, ilerlemeyi, Ayarlar'a geçişi, native onay diyaloğunu, iptali, beş pencere genişliğini ve açık temayı izole profilde denetler. Smoke içindeki installer çalıştırma çağrısı mock'tur; gerçek Windows kurulumunun kanıtı değildir.

Android birim testleri manifest kimliği/etiketi, paket, hash ve boyut doğrulamasını kapsar. Fiziksel cihazda gelecekteki daha yeni bir yayının uçtan uca kurulması ayrıca kabul edilmelidir. Windows Authenticode imzası, Android üretim imzası veya Play Store dağıtımı bu ön sürümün kapsamında tamamlanmış sayılmaz.
