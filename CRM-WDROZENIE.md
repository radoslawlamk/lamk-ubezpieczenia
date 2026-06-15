# LAMKUBEZPIECZENIA.pl CRM

## Moduły

- `server.mjs` - serwer HTTP, API, sesje i kontrola dostępu.
- `lib/security.mjs` - hashowanie haseł, szyfrowanie AES-256-GCM i TOTP/2FA.
- `lib/crm-store.mjs` - baza SQLite, migracje, zgłoszenia, polisy, historia i audyt.
- `admin.html`, `admin.css`, `admin.js` - responsywny panel CRM.
- `data/` - zaszyfrowana baza i lokalny klucz szyfrowania; katalog nie może być publiczny.

## Uruchomienie lokalne

```powershell
$env:ADMIN_USERNAME='radoslaw'
$env:ADMIN_PASSWORD='silne-haslo-minimum-14-znakow'
node server.mjs
```

Panel: `http://127.0.0.1:4173/admin.html`

## Publikacja

1. Uruchomić aplikację jako usługę Node.js 24+.
2. Ustawić zmienne na podstawie `.env.example`.
3. Umieścić aplikację za reverse proxy z ważnym certyfikatem TLS.
4. Przekazywać nagłówki `X-Forwarded-Proto` i `X-Forwarded-For`.
5. Ustawić `NODE_ENV=production` oraz `TRUST_PROXY=true`.
6. Wykonywać szyfrowane kopie katalogu `data/` i klucza szyfrowania.
7. Włączyć 2FA w zakładce Bezpieczeństwo.

Bez klucza `data/encryption.key` lub odpowiadającej mu zmiennej `DATA_ENCRYPTION_KEY` nie będzie możliwe odszyfrowanie zgłoszeń.

## Powiadomienia

Po skonfigurowaniu Resend e-mail zawiera wyłącznie informację o nowym zgłoszeniu. Dane klienta pozostają w szyfrowanej bazie i są dostępne po zalogowaniu do CRM.

Wysyłka polis oraz potwierdzeń usunięcia danych wymaga ustawienia `RESEND_API_KEY` i zweryfikowanego adresu `POLICY_EMAIL_FROM`. Pliki polis są przyjmowane wyłącznie jako PDF do 8 MB, szyfrowane przed zapisem i dostępne tylko dla zalogowanego administratora.

## Dalsze integracje

Integracje e-mail, SMS i API towarzystw należy dodawać jako osobne moduły usługowe. Operacje wykonane przez integracje powinny dopisywać wpis do historii kontaktu i dziennika audytowego.
