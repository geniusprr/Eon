# Eon 2 kullanım rehberi

Bu rehber **v2.0.0-preview.1** içindir. [İndirme sayfası](https://github.com/geniusprr/Eon/releases/tag/v2.0.0-preview.1) · [Tanıtıma dön](../README.md)

## 1. Windows kurulumu

`Eon-Setup-2.0.0-preview.1.exe` dosyasını indir, kurulum dizinini seç ve Eon'u aç. Node.js, Android Studio veya ayrı scrcpy kurulumu son kullanıcı için gerekmez; gerekli cihaz araçları Windows paketine dahildir. Windows 10/11 x64 hedeflenir. Kurulum kod imzasız olduğundan SmartScreen uyarısı çıkabilir; yayın kaynağını ve `SHA256SUMS.txt` dosyasını kontrol et.

```powershell
Get-FileHash .\Eon-Setup-2.0.0-preview.1.exe -Algorithm SHA256
```

Telefon bağlamadan notlarını ve Dashboard'u kullanabilirsin. Eon AI için ayrıca internet ve OpenRouter yapılandırması gerekir.

## 2. Android kurulumu ve USB eşleştirme

1. Android 8.0 veya üstünde Ayarlar → Telefon hakkında → Derleme numarasına yedi kez dokun. Üreticiye göre menü adları değişebilir.
2. Geliştirici seçenekleri → USB hata ayıklama'yı aç.
3. Veri aktarabilen USB kablosu tak. Telefon kilidini aç ve bu bilgisayarın hata ayıklama isteğini onayla.
4. Windows Eon → **Cihazlar** bölümünü aç. Telefon listelenince **Eon'u kur** seçeneğini kullan. **APK kur**, kendin seçtiğin APK için ayrı dosya seçicisini açar.
5. Alternatif: release'teki `Eon-Android-preview.apk` dosyasını telefona indir ve dosyayı aç. Android isterse yalnızca kullandığın yükleyiciye bu kaynaktan kurulum izni ver.
6. Eon iki cihazda açıkken **Eşleştir**'i seç. İsteği karşı cihazda kabul et; yalnızca USB hata ayıklamasını onaylamak Eon eşleştirmesi yerine geçmez.
7. Cihazlar bölümündeki izinlerden kullanacağın not, dosya ve kontrol yetkilerini seç. Erişimi aynı bölümden iptal edebilirsin.

Companion geliştirme paketi `com.kapanis.mobil.eon2.dev` kimliğiyle kurulur. Önceki v1 Android uygulaması ayrı kalır. Aynı paket kimliğinde farklı imza nedeniyle güncelleme reddedilirse uygulamayı silmeden önce verilerini yedekle.

## 3. Dashboard ve Deck

Dashboard, telefonun yatay Deck düzeninin masaüstü karşılığıdır. Alt çubuktaki panel düzenleme düğmesini veya sağ tık menüsünü kullan. Kartları taşı, boyutlandır ve **Kaydet**'i seç; vazgeçmek için iptal et. Odaklanan kartlarda Shift + ok tuşları boyutlandırmayı destekler.

Ekran seçicisi ve önceki/sonraki düğmeleriyle paneller arasında geç. Telefonda yatay kaydırma da kullanılabilir. Dikey mobil ekrandaki yön işaretli Eon düğmesi Deck'i, Deck çubuğundaki Eon düğmesi dikey ekranı açar.

**Kısayollar**, tek ve dikey kaydırılabilir bir ekrandır. Düzenleyicide eylem seç, sırala veya kaldır. Bu liste diğer panellerdeki altı hızlı eylemden bağımsızdır. PC Kısayolları bölümünde eylemi oluşturup telefonda kullanımını aç; cihazın ilgili çalıştırma izninin de açık olması gerekir.

## 4. Eon Notes

Eon Notes'u aç, yeni not oluştur ve başlık/içerik gir. Markdown düzenleme ve önizleme araçlarını kullan. Geçmişten revizyonları incele; çakışma gösterildiğinde iki sürümü gözden geçirerek çöz. İki cihazda çevrimdışı düzenleme ve yeniden bağlanma senaryolarını önemli veriden önce örnek notlarla dene.

Eon 2 SQLite deposu, v1 Vault klasörünü otomatik içe aktarmaz. Ayarlar → Dışa aktar yalnızca uygulama ayarlarını taşır, not yedeği değildir. Tam yedek için Eon'u kapatıp uygulamanın kullanıcı veri dizinini, özellikle `eon-2` altındaki verileri, ayrı konuma kopyala; eski Vault klasörünü de koru. Ön sürümden v1'e dönüş Eon 2 notlarını otomatik dönüştürmez.

## 5. Eon AI

Eon AI → OpenRouter ayarlarını aç. **OpenRouter hesabıyla bağlan** seçeneğini veya API anahtarını kullan. Model listesinden seçim yap ya da geçerli model kimliğini gir. Mesajını yazıp gönder. Model listesi gelmezse bağlantını kontrol edip yenile.

İstekler OpenRouter ve seçilen sağlayıcıya gider; kullanım ücretleri hesabına bağlıdır. Özel veriyi göndermeden önce içeriği kontrol et. AI uygulama araçlarını kullanabilir; cihaz izinleri geçerlidir. API anahtarını ekran görüntülerinde veya hata bildirimlerinde paylaşma.

## 6. Dosya aktarımı

Önce eşleştirilmiş cihaz için dosya aktarımı iznini aç. **Dosya Aktarımı** bölümünde hedef cihazı seç, dosya ekle ve gönder. Gelen dosyaların klasörünü aynı bölümden seçebilir, tamamlanan dosyayı açabilir veya başka yere kaydedebilirsin. Birden fazla cihaz varsa doğru hedefi seçtiğini kontrol et. Aktarım izni açıkken her dosya için ayrıca kabul penceresi beklenmez.

## 7. Telefon ve PC ekranı

Android ekranını cihaz ekranı kontrollerinden başlat. scrcpy, USB hata ayıklaması yetkili Android cihazını kullanır. Oturumu bitirdiğinde durdur. Telefon üreticisinin ek kontrol kısıtlamaları olabilir.

Telefondan PC ekranı isteğinde Windows'ta oturum onayı gerekir. Görüntüleme ve kontrol ayrı yetkilerdir. Kilit ekranı, UAC güvenli masaüstü ve uyku gibi durumlar normal masaüstüyle aynı kabul edilmez; sınırsız erişim vaat edilmez.

## 8. Tailscale ile kablosuz bağlantı

İki cihazda Tailscale'i kur ve aynı tailnet'e bağlan. Önce USB eşleştirmesini tamamla. Windows Eon → Cihazlar / Ayarlar'dan Tailscale'i aç. HTTPS sertifikası için tailnet yapılandırmasının uygun olması gerekir. Uygulama HTTPS dinleyicisinin hazır olmadığını söylüyorsa kablosuz bağlantı kurulmuş sayılmaz; Tailscale çevrimiçi durumunu, DNS/sertifika ve ACL ayarlarını kontrol et. Port yönlendirme açma.

## 9. Görünüm ve başlangıç

Ayarlar'dan tema ile Cam / Sistem / Opak yüzey seç. **Windows ile aç** oturum başlangıcını yönetir. **İçe aktar / Dışa aktar** tema, başlangıç ve bağlantı tercihlerini JSON olarak taşır; notları veya eşleştirme sırlarını taşımaz.

## Sorun giderme

| Sorun | Kontrol |
| --- | --- |
| Telefon görünmüyor | Veri kablosu, USB portu, telefon kilidi, USB hata ayıklama ve Windows OEM sürücüsü |
| Telefonda bağlantıya izin ver | Telefon ekranındaki bilgisayar yetkilendirme isteğini onayla |
| USB var ama Eon bağlanmıyor | Companion'ı iki cihazda aç; uygulama eşleştirmesini tamamla |
| Eşleştirme sona erdi | USB bağlantısını doğrula ve yeni istek başlat |
| Eylem / aktarım reddediliyor | Cihazın kapsam izni ve eylemin telefonda kullanım ayarı |
| AI yanıt vermiyor | OpenRouter anahtarı, model kimliği, bakiye ve internet |
| Tailscale hazır değil | Aynı tailnet, çevrimiçi durum, HTTPS sertifikası ve ACL |
| Cihaz bağlantısı başlatılamadı | Başka Eon örneğini kapatıp yeniden aç; portu internete açma |

[Doğrulanan kontroller ve açık sınırlar](eon2/RELEASE-20261113.md). Hata bildirirken sürüm, işletim sistemi, bağlantı türü ve tekrar adımlarını ekle.
