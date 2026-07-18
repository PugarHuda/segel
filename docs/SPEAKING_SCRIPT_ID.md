# Segel — Naskah Bicara (Word-for-Word)

> Naskah yang benar-benar **diucapkan** saat presentasi, menyatu dengan deck di
> https://segel.vercel.app/deck (11 slide). Baca yang di dalam tanda kutip apa adanya;
> tulisan `[dalam kurung]` adalah **aba-aba** (kapan klik, kapan jeda), jangan diucapkan.
> Total ± **5–6 menit**. Setiap slide punya versi **Indonesia** (utama) dan **English**
> (kalau presentasi in English — pakai salah satu, konsisten).
>
> **Tempo:** pelan dan jelas > cepat. Beri jeda 1 detik setelah kalimat penting.
> **Kalau grogi:** yang wajib disampaikan cuma 3 hal — *(1) tawaran disegel, (2) harga
> dibuktikan bukan dipercaya, (3) yang kalah tak pernah terlihat.* Sisanya bonus.

---

## SLIDE 1 — Judul  ⏱️ 0:00–0:30
[Deck di slide 1. Tarik napas, pelan.]

> "Halo semuanya. Perkenalkan — **Segel**: meja OTC lelang tertutup di Stellar.
> [jeda] Lihat tabel di layar ini. Komitmennya publik dan mengikat — tapi nilai tawaran
> yang kalah? Itu **tidak pernah ditulis ke blockchain sama sekali**. Itulah inti proyek
> ini, dan dalam lima menit ke depan saya tunjukkan caranya."

> *(EN)* "Hi everyone. This is **Segel** — a sealed-bid OTC desk on Stellar. Look at this
> ledger: the commitments are public and binding, but the losing amounts were never
> written to the chain at all. That's the whole idea — let me show you how."

---

## SLIDE 2 — Masalah  ⏱️ 0:30–1:05
[Klik ke slide 2.]

> "Kenapa ini penting? Karena **meja OTC itu bocor**. Kalau ada transaksi besar — katakanlah
> sebuah fund mau beli token senilai jutaan dolar — begitu tawarannya terlihat, pasar
> langsung **mendahului** mereka. Harga bergerak melawan mereka sebelum transaksi selesai.
> [jeda]
> Jadi hari ini pilihannya cuma dua, dan dua-duanya buruk. Satu: pasang tawaran di bursa
> publik — semua orang lihat, langsung di-front-run. Dua: lewat broker di ruang chat —
> privat, tapi kita harus **percaya** broker itu jujur memilih pemenang dan harga.
> **Tidak ada pilihan ketiga.**"

> *(EN)* "Why does this matter? OTC desks leak. The moment a large trade's bids become
> visible, the market front-runs them — the price moves against them before the trade
> even fills. So today you either reveal everything on a public book, or you trust a
> broker in a chat room. There was no third option."

---

## SLIDE 3 — Solusi  ⏱️ 1:05–1:40
[Klik ke slide 3.]

> "Segel adalah pilihan ketiga itu. Tawaran **disegel** di balik sesuatu bernama komitmen
> Poseidon — jadi tak ada yang bocor saat menawar. Saat lelang ditutup, sebuah **bukti
> zero-knowledge** membuktikan siapa pemenangnya dan berapa harga yang adil — **harga
> Vickrey**, harga tertinggi kedua. [jeda] Dan tawaran yang kalah tetap tersembunyi
> **selamanya**. Penyelesaiannya pakai **USDC Circle sungguhan**, sebagai swap dua aset
> yang nyata."

> *(EN)* "Segel is that third option. Bids are sealed behind Poseidon commitments. When
> the auction closes, one zero-knowledge proof shows the winner and the fair Vickrey
> second-price — and losing bids stay hidden forever. It settles in Circle's real USDC as
> a two-asset swap."

---

## SLIDE 4 — ZK yang menyangga  ⏱️ 1:40–2:20
[Klik ke slide 4. Ini slide paling teknis — pelan.]

> "Dan zero-knowledge di sini bukan tempelan — **ia yang menyangga seluruh produk**. Ada
> dua sirkuit. Yang pertama membuktikan sebuah tawaran itu valid — ada dalam rentang,
> dananya cukup, penawarnya terdaftar, dan belum pernah menawar — **tanpa membuka
> angkanya**. Yang kedua membuktikan pemenang dan harga Vickrey-nya benar. [jeda]
> Dan yang paling penting: **keduanya diverifikasi langsung di dalam smart contract
> Stellar**, pakai fungsi bawaan BN254. Hilangkan ZK-nya, dan produk ini tidak bisa ada."

> *(EN)* "And the zero-knowledge here is load-bearing — it runs the whole product. Two
> circuits: one proves a bid is valid — in range, funded, allow-listed, not a duplicate —
> without revealing the amount. The other proves the winner and the Vickrey price. And
> crucially, both are verified **on-chain**, inside a Stellar contract, using the BN254
> host functions. Remove the ZK, and the product cannot exist."

---

## SLIDE 5 — Dibuktikan langsung  ⏱️ 2:20–2:50
[Klik ke slide 5.]

> "Dan kami tak minta Anda percaya begitu saja. Satu perintah: bukti asli **lolos** di
> verifier yang sudah ter-deploy. Ubah **satu angka saja** di dalamnya — dan bukti yang
> sama langsung **ditolak on-chain**. [jeda] Sesederhana itu: pernyataan palsu tak punya
> bukti yang valid."

> *(EN)* "And we don't ask you to take that on faith. One command: a real proof passes on
> the deployed verifier. Flip a single number, and that same proof is rejected on-chain. A
> false statement has no valid proof."

---

## SLIDE 6 — Cara kerja  ⏱️ 2:50–3:15
[Klik ke slide 6.]

> "Alurnya empat langkah, semuanya on-chain. Maker memposting permintaan. Penawar menyegel
> tawaran — dibuktikan di dalam browser mereka sendiri. Satu bukti penyelesaian mengungkap
> **hanya** pemenang dan harga. Lalu pembayaran, pengiriman, dan pengembalian dana terjadi
> **sekaligus, secara atomik**."

> *(EN)* "The flow is four on-chain steps. A maker posts a request. Bidders seal a bid,
> proven in their own browser. One settlement proof reveals only the winner and the price.
> Then payment, delivery, and refunds happen atomically."

---

## SLIDE 7 — Live di Stellar  ⏱️ 3:15–3:40
[Klik ke slide 7.]

> "Dan ini bukan konsep — sudah **ter-deploy dan berjalan** di Stellar testnet sekarang.
> Mejanya, plus kedua kontrak verifier, meng-escrow **USDC testnet Circle yang sungguhan**,
> dengan pembacaan oracle Reflector saat penyelesaian. Semua alamat kontraknya ada di layar
> dan bisa dicek di explorer."

> *(EN)* "And this isn't a concept — it's deployed and live on Stellar testnet right now.
> The desk plus both verifier contracts, escrowing Circle's real testnet USDC, with a
> Reflector oracle read at settlement. Every contract address is on screen."

---

## SLIDE 8 — Integrasi  ⏱️ 3:40–4:00
[Klik ke slide 8. Boleh cepat sedikit — ini daftar.]

> "Dan primitif Stellar-nya benar-benar **menyangga**, bukan sekadar disebut: fungsi host
> BN254, kustodi escrow Soroban, Poseidon on-chain yang identik dengan sirkuit, USDC
> sungguhan, swap dua aset, dan Direct-OTC yang dipaksakan oleh kontrak itu sendiri."

> *(EN)* "And the Stellar primitives are load-bearing, not name-checked: BN254 host
> functions, Soroban escrow custody, on-chain Poseidon identical to the circuit, real
> USDC, two-asset swaps, and directed OTC enforced by the contract itself."

---

## SLIDE 9 — Batasan jujur  ⏱️ 4:00–4:30
[Klik ke slide 9. Nada tenang & percaya diri — ini justru menambah kredibilitas.]

> "Dan batasannya kami sampaikan terus terang. Pihak penyelesai memang melihat tawaran
> untuk menghitung hasil — seperti juru lelang mana pun; Segel menyembunyikan yang kalah
> dari **publik dan rantai**, bukan dari penyelesai. Pengaman oracle-nya adalah pengaman
> salah-ketik, bukan anti-manipulasi. Daftar izin demo memakai kunci uji, bukan KYC asli.
> [jeda] Tapi **tidak ada yang menyangga produk yang dipalsukan** — semuanya nyata."

> *(EN)* "And we're honest about the limits. The settler does see the bids to compute the
> result, like any auctioneer — Segel hides the losers from the public and the chain, not
> from the settler. The oracle guard is a fat-finger check, not anti-manipulation. The demo
> allow-list is test keys, not real KYC. But nothing load-bearing is mocked."

---

## SLIDE 10 — DEMO  ⏱️ 4:30–5:30  ← BAGIAN PALING PENTING
[Klik ke slide 10. Di sini ada video demo. Putar videonya, ATAU buka
https://segel.vercel.app/app di tab lain dan demo langsung. Kalau demo langsung, ucapkan
sambil klik:]

> "Sekarang lihat langsung. [connect kunci demo] Saya sambungkan dompet demo.
> [buka Create] Siapa pun bisa memposting lelang — terbuka untuk semua, atau diarahkan ke
> satu counterparty saja. Saya posting yang ini... [klik Post] dan ini **transaksi on-chain
> sungguhan**.
> [buka sebuah RFQ, klik Bid, geser slider] Saat saya menawar, **browser saya** membuat
> bukti zero-knowledge-nya — tanpa mengirim angka tawaran ke mana pun. [klik seal, tunggu]
> Yang tercatat di rantai cuma komitmennya. [jeda]
> [buka Portfolio → Verify a disclosure] Dan ini bagian favorit saya: pemenang menawar
> 4.90 tapi bayar harga Vickrey 4.20 — jadi 4.90 **tidak ada** di rantai. Tapi ia tetap
> bisa membuktikannya ke auditor. Ubah satu angka... gagal. **Privat, tapi bisa
> dibuktikan.**"

[Kalau internet bermasalah: cukup putar video di slide 10, dan diamkan naskah demo di atas
sebagai narasi.]

---

## SLIDE 11 — Penutup  ⏱️ 5:30–6:00
[Klik ke slide 11. Pelan, mantap, tatap juri.]

> "Jadi, singkatnya: **tawaran tersegel, penyelesaian terbukti, yang kalah tak pernah
> terlihat.** Zero-knowledge nyata, uang nyata, pengiriman nyata — di Stellar. [jeda]
> Semuanya live dan bisa dicoba sendiri di segel.vercel.app. Terima kasih."

> *(EN)* "So, in short: bids sealed, settlement proven, losers never seen. Real
> zero-knowledge, real money, real delivery — on Stellar. It's all live at segel.vercel.app.
> Thank you."

[Diam. Senyum. Tunggu tepuk tangan / pertanyaan. Untuk Q&A, buka
`docs/PRESENTER_BRIEF_ID.md` bagian 10.]

---

## Kalau waktu cuma 3 menit (versi padat)
Lompati slide 5, 8. Ucapkan: **Slide 1** (hook) → **Slide 2** (masalah) → **Slide 3**
(solusi) → **Slide 4** (ZK menyangga) → **Slide 10** (demo) → **Slide 11** (penutup).
Enam kalimat inti + demo. Selesai.

## Checklist sebelum maju
- [ ] Buka tab: `/deck`, `/app`, dan explorer kontrak utama.
- [ ] Sudah connect kunci demo sekali (biar cepat saat demo).
- [ ] Cek internet; kalau ragu, siapkan video slide 10 sebagai cadangan.
- [ ] Baca ulang **Slide 9 (batasan)** dan **Brief bagian 10 (Q&A)** — itu titik rawan.
- [ ] Tarik napas. Tempo pelan. Yang penting cuma 3 hal (lihat atas).
