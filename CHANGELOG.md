# Değişiklikler

## 2.0.0-preview.2 — 2026-11-13

- Windows ve Android için GitHub Releases tabanlı arka plan güncelleme akışı.
- Yalnızca güncelleme bulunduğunda görünen başlık çubuğu durumu ve Ayarlar → Güncellemeler.
- Windows'ta kullanıcı seçene kadar bekleyen kurulum; ayrı telefon onayıyla USB APK güncellemesi.
- Android'de doğrulanan APK ve sistem paket kurucusuyla kullanıcı onaylı kurulum.
- Yayın manifesti, artan Android sürüm kodu ve CI'da aynı companion imzasının korunması.

İlk preview.1 → preview.2 geçişi bir defa elle kurulum gerektirir. [Kullanım ve yayın sözleşmesi](docs/eon2/UPDATES.md).

## 2.0.0-preview.1 — 2026-11-13

Eon 2'nin ilk ön sürümü. Kararlı sürüm veya imzalı üretim dağıtımı değildir.

- Windows ve Android için ortak, çok ekranlı Deck ve düzenlenebilir Kısayollar ekranı.
- Eon Notes: SQLite revizyon geçmişi, Markdown çalışma alanı ve çakışma çözümü.
- OpenRouter bağlantısı, model seçimi ve uygulama araçlarıyla Eon AI.
- USB eşleştirme, cihaz izinleri, dosya aktarımı ve isteğe bağlı Tailscale HTTPS bağlantısı.
- scrcpy telefon ekranı ve oturum onaylı PC ekranı altyapısı.
- Yenilenen GitHub tanıtımı, altı güncel ekran görüntüsü ve Türkçe kullanım rehberi.

Windows kurulum paketi kod imzasızdır. Android companion geliştirme paketidir.
v1 Vault otomatik geçişi sunulmaz. Ayrıntılar: [yayın doğrulama kaydı](docs/eon2/RELEASE-20261113.md).

## 1.2.0 — 2026-09-26

- Uygulama genelinde Omni markası Eon olarak yenilendi.
- Tarayıcı URL normalizasyonu ve birden fazla arama motoru desteği geliştirildi.
- Etkinlik oluşturma ve yönetimi içeren yeni Takvim özelliği eklendi.

## 1.1.0 — 2026-08-20

- Mini OS Ana Sayfa & Özelleştirilebilir Widget'lar (YouTube Müzik, Hava Durumu, Başlık Çubuğu Mini Oynatıcı)
- Yerel Dosya Transferi (LocalSend protokolü entegrasyonu ve cihaz keşfi)
- Markdown & Vault Not Defteri (Çift yönlü bağlantılar [[wikilinks]], Canlı Önizleme / Okuma modu, Grafik Görünümü, Hızlı Arama)
- Gelişmiş Ayarlar ve Cihaz Eşleştirme Yönetimi
- Yeni Tipografi & Değişken Yazı Tipleri (Plus Jakarta Sans, Geist, Outfit, Bricolage Grotesque)

## 1.0.0 — 2026-08-19

- Windows kapatma ve yeniden başlatma sayacı
- Tek seferlik ve aralıklı sesli alarmlar
- Alarm erteleme, notlar ve kalıcı yerel scheduler
- Sistem tepsisi, Windows ile açılma ve tek uygulama örneği
- Electron splash, Acrylic cam arayüz ve Chromium tabanlı browser shell
- `WebContentsView` tab lifecycle, session restore, favicon, popup, permission, download ve media yönetimi
- RLS korumalı Supabase telefon kontrolü altyapısı
- NSIS kurulum paketi ve GitHub Actions yayın akışı
