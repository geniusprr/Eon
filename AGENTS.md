# Eon çalışma kuralları

## Desk / Deck platform tutarlılığı

- Telefonun Desk / Deck ekranında değişiklik yapıldığında masaüstündeki karşılığına da aynı değişiklik uygulanmalıdır; masaüstünden başlayan değişiklikler için de bu kural geçerlidir.
- Android uygulamasını (`mobil/app/src/eon2/kotlin/com/kapanis/mobil/eon2/ui/LandscapeDeck.kt`) ve masaüstü önizlemesini (`src/eon2/DeckMirror.tsx`, `src/eon2/deck-mirror.css`) birlikte inceleyin. Görünüm, boşluklar, widget davranışları ve düzenleme akışları platforma uygun ölçülerle tutarlı kalmalıdır.
- Desk / Deck içeriğinin üst boşluğu, ilgili platformdaki yatay kenar boşluğuyla aynı olmalıdır. Android ekran kesiti güvenli alanı ayrıca korunmalıdır.
- Doğrulamada her iki platformu da kontrol edin; çalıştırılamayan kontrolleri açıkça belirtin.
