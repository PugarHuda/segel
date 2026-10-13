# Segel — Panduan Presenter (Lengkap)

> Dibuat untuk yang **mempresentasikan** proyek ini (bukan yang membangun). Tujuannya:
> kamu paham konsepnya, tahu apa yang harus diucapkan, dan siap menjawab pertanyaan juri.
> Baca bagian 0–5 sampai paham; bagian 7 dipakai saat demo; bagian 9–10 wajib dihafal
> garis besarnya karena juri **pasti** menyentuh itu.
>
> - 🌐 Live desk: https://segel.vercel.app/app
> - 🖥️ Deck (presentasi): https://segel.vercel.app/deck
> - 💻 Repo: https://github.com/PugarHuda/segel
> - ⛓️ Jaringan: Stellar **testnet** (Soroban)

---

## 0. TL;DR — kalau cuma sempat baca satu paragraf

Segel adalah **meja OTC (over-the-counter) dengan lelang tertutup di Stellar**. Orang
menawar untuk membeli aset dalam jumlah besar, tapi **nilai tawarannya disegel**
(disembunyikan secara kriptografi). Saat lelang ditutup, sebuah **bukti zero-knowledge**
membuktikan siapa pemenangnya dan berapa harga yang adil — **tanpa pernah membuka
tawaran yang kalah**. Semua diverifikasi langsung di dalam smart contract Stellar.
Intinya: *harga yang adil dibuktikan, bukan dipercaya; tawaran yang kalah hilang selamanya.*

---

## 1. Elevator pitch (30 detik) — hafalkan, ini pembuka

> "Meja OTC itu bocor. Begitu tawaran transaksi besar terlihat, pasar langsung
> mendahului kita — harga bergerak melawan kita sebelum transaksi selesai. Jadi hari ini
> penemuan harga untuk transaksi besar bersembunyi di ruang chat yang harus kita percaya.
> **Segel** adalah meja OTC lelang tertutup di Stellar: tawaran **disegel**, harga yang
> adil **dibuktikan secara zero-knowledge**, dan tawaran yang kalah **tak pernah
> terungkap** — sementara seluruh penyelesaian tetap bisa diverifikasi di Stellar."

Versi Inggris (kalau presentasi in English):
> "OTC desks leak. The moment a large trade's bids are visible, the market front-runs
> you. Segel is a sealed-bid OTC desk on Stellar: bids are sealed, the fair clearing price
> is proven in zero-knowledge, and the losing bids are never revealed — while the whole
> settlement stays verifiable on Stellar."

---

## 2. Masalah yang diselesaikan (kenapa ini penting)

**OTC = over-the-counter**: transaksi besar yang dilakukan langsung antar pihak, di luar
bursa publik (misalnya sebuah fund mau beli/jual token senilai jutaan dolar sekaligus).

Masalahnya ada dua, dan keduanya buruk:
1. **Kalau tawaran terlihat (bursa publik / order book):** pasar melihat ada order besar
   dan langsung **front-run** — memindahkan harga melawan kita sebelum order selesai.
2. **Kalau lewat broker / ruang chat:** tawaran memang privat, tapi kita harus
   **memercayai** broker itu untuk memilih pemenang dan harga secara jujur. Tidak ada
   bukti kalau dia curang.

Sampai sekarang **tak ada pilihan ketiga**: menjalankan lelang tertutup yang adil,
on-chain, tanpa membocorkan tawaran DAN tanpa memercayai operator. Segel adalah pilihan
ketiga itu.

**Analogi sederhana** (boleh dipakai ke juri): bayangkan lelang di mana semua orang
memasukkan tawaran ke dalam amplop tertutup. Segel memastikan (a) tak ada yang bisa
mengintip amplop, (b) pemenang dan harga dihitung dengan benar dan **dibuktikan secara
matematis**, dan (c) amplop yang kalah **dibakar tanpa pernah dibuka**.

---

## 3. Solusi Segel (apa yang dibangun)

Sebuah smart contract di Stellar (Soroban) + dua sirkuit zero-knowledge + antarmuka web.
Alurnya:
1. **Maker** memposting **RFQ** (Request For Quote): pasangan aset, rentang ukuran, tenggat.
2. **Penawar** mengirim tawaran yang **disegel** — hanya "sidik jari" kriptografinya
   (komitmen) yang tercatat on-chain, bukan angkanya.
3. **Penyelesaian**: satu bukti ZK membuktikan pemenang + harga kliring **Vickrey**
   (harga tertinggi kedua) benar, lalu pembayaran + pengiriman + pengembalian dana
   terjadi **secara atomik** (sekaligus, tak bisa setengah jalan).
4. **Tawaran yang kalah tetap tersembunyi selamanya** — tidak di storage, event, maupun
   calldata.

Fitur tambahan yang membuatnya nyata:
- **Delivery-vs-Payment (DvP)**: swap dua aset sungguhan — maker meng-escrow "lot"
  (misalnya 20 XLM) yang diterima pemenang, ditukar dengan pembayaran. Bukan pembayaran
  satu arah.
- **Directed Direct-OTC**: maker bisa mengundang **satu** counterparty saja; hanya alamat
  itu yang boleh menawar — **dipaksakan oleh kontrak**, bukan cuma disembunyikan di UI.
- **Pengungkapan selektif (selective disclosure)**: pemenang bisa membuktikan nilai
  tawarannya ke auditor/regulator, tanpa itu menjadi publik. Privat tapi bisa dibuktikan.

---

## 4. Konsep kunci — dijelaskan sederhana (biar kamu bisa menjawab)

**Sealed-bid auction (lelang tertutup):** semua menawar tanpa melihat tawaran orang lain.

**Vickrey / second-price:** pemenang adalah penawar tertinggi, tapi ia **membayar harga
tertinggi kedua**. Ini mekanisme lelang klasik yang membuat orang jujur menawar sesuai
nilai sebenarnya. *Poin penting untuk demo:* karena pemenang bayar harga kedua, **nilai
tawaran asli pemenang pun tidak ada di rantai** — menariknya, ia tetap bisa membuktikannya
lewat pengungkapan selektif.

**Zero-knowledge proof (ZK):** cara membuktikan sebuah pernyataan itu benar **tanpa
mengungkap data di baliknya**. Analogi: aku bisa meyakinkanmu bahwa aku tahu password
tanpa menyebut passwordnya. Di sini: "tawaranku valid dan aku menang" dibuktikan tanpa
menyebut angka tawaran.

**Poseidon commitment (komitmen):** "sidik jari" kriptografi dari angka tawaran. Rumusnya
`commit = Poseidon(tawaran, angka_acak, alamat)`. Sidik jari ini **mengikat** (tak bisa
diubah setelah dikirim) tapi **tidak membocorkan** angka aslinya. Poseidon adalah fungsi
hash yang "ramah ZK".

**Groth16 / BN254 / verifikasi on-chain:** Groth16 adalah jenis bukti ZK yang ringkas dan
murah diverifikasi. BN254 adalah kurva eliptik yang dipakai. **Yang langka dan penting:**
buktinya diverifikasi **di dalam smart contract Stellar** (bukan cuma di server luar),
memakai fungsi bawaan Stellar Protocol 25/26. Ini pembeda utama proyek ini.

**Nullifier:** penanda unik supaya satu identitas tak bisa menawar dua kali di RFQ yang
sama (anti spam/kecurangan), tanpa membocorkan siapa identitasnya.

**DvP (Delivery-vs-Payment):** pengiriman aset dan pembayaran terjadi **bersamaan dan
atomik** — tak ada pihak yang bisa kabur setelah menerima satu sisi.

---

## 5. Kenapa ZK-nya "load-bearing" (ATURAN UTAMA hackathon)

Hackathon menegaskan: ZK harus **benar-benar menjalankan** produk, bukan sekadar disebut
di slide. Untuk Segel:

> "Ada **dua sirkuit** Circom/Groth16. Keduanya **diverifikasi on-chain**. Hilangkan
> ZK-nya, dan produk ini **tidak bisa ada** — tak ada cara lain menyelesaikan lelang
> tertutup tanpa membocorkan tawaran atau memercayai operator."

Dua sirkuit itu:
| Sirkuit | Membuktikan (semua tanpa membuka angka tawaran) |
|---|---|
| **bidValidity** | tawaran ada dalam rentang; dananya cukup; penawar ada di daftar izin (KYC identitasnya disembunyikan); dan belum pernah menawar (nullifier segar) |
| **auctionResult** | setiap komitmen cocok; pemenang = penawar tertinggi; harga kliring = tertinggi kedua (Vickrey); tawaran kalah tak muncul di output |

**"Binding" (pengikatan) — ini inti keamanannya, sebut kalau juri teknis:** kontrak
**membangun sendiri** semua input publik verifier dari data yang ia kontrol. Jadi bukti
yang valid **tak bisa dipakai ulang** dengan tawaran, identitas, atau kumpulan tawaran
yang berbeda.

**Kesahihan dibuktikan langsung, bukan diklaim:** ada perintah `npm run test:tamper-onchain`
— bukti asli lolos di verifier yang sudah ter-deploy; ubah satu angka saja, dan bukti yang
sama **ditolak on-chain**. "Pernyataan palsu tak punya bukti yang valid."

---

## 6. Yang sudah LIVE di Stellar testnet (bukti — sebut ini)

**Kontrak yang ter-deploy (testnet):**
```
Meja OTC (utama):     CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM
bidValidity verifier: CAL5XO2NPC2ZFVQSXX7HSS6ARQOX6GL24LCR5SZVEIKENOLN2HUOK7DK
auctionResult verif.: CCEZVOKXYPUH67KAVVQ6ZZAPUUXSE7ENBO3OLTTLHCVKDMJHOLGGJEBY
```
- Aset escrow = **USDC testnet asli milik Circle** (bukan token palsu buatan sendiri).
- Oracle = **Reflector** (SEP-40), dibaca saat penyelesaian sebagai pengaman harga.
- Semua bisa dilihat di stellar.expert (explorer blockchain Stellar).

Kalimat yang kuat: *"Ini bukan mockup — kontraknya live, USDC-nya USDC Circle sungguhan,
verifier-nya nyata, dan buktinya dibuat langsung di browser."*

---

## 7. Alur demo — langkah per langkah (yang DIKLIK + yang DIUCAPKAN)

Buka **https://segel.vercel.app/app**. (Deck https://segel.vercel.app/deck slide 10 juga
memuat video demo Bahasa Indonesia sebagai cadangan kalau internet bermasalah.)

1. **Landing / desk** — *"Ini meja langsungnya. RFQ ini dibaca langsung dari kontrak
   Soroban. Rentang ukuran publik, tapi nilai tawarannya terenkripsi."*
2. **Connect** → klik **Connect** → **Embedded key** (kunci demo tanpa instalasi).
   *"Untuk demo saya pakai kunci demo; di produksi pakai dompet Freighter."*
3. **Create RFQ** → tunjukkan dua mode:
   - **Direct OTC**: *"Bisa diarahkan ke satu alamat saja — dipaksakan on-chain."*
   - **Open + lot**: *"Atau terbuka untuk semua, dengan lot pengiriman — swap dua aset
     DvP yang nyata."* Klik **Post** → *"ini transaksi on-chain sungguhan."*
4. **Audit** → klik **Run poseidon_hash** → *"Kontrak menghitung Poseidon di on-chain,
   identik dengan sirkuit. Jangan percaya antarmuka — periksa rantainya."*
5. **Bid** (di RFQ orang lain) → geser slider → **Prove & seal bid** →
   *"Browser saya membuat bukti zero-knowledge — tawaran valid, dana cukup, ada di daftar
   izin, belum pernah menawar — tanpa mengungkap angkanya. Yang tercatat cuma komitmennya."*
   (Tunggu spinner ~beberapa detik → toast sukses = transaksi on-chain nyata.)
6. **Settle** (sebagai maker) → *"Satu bukti lelang membuktikan pemenang + harga Vickrey,
   lalu pembayaran, pengiriman, dan pengembalian terjadi atomik. Nilai yang kalah? Tidak
   ada di mana pun. Hilang secara matematis."*
7. **Portfolio → Verify a disclosure** → *"Pemenang menawar 4.90 tapi bayar harga Vickrey
   4.20 — jadi 4.90 tidak ada di rantai. Tapi ia tetap bisa membuktikannya ke auditor.
   Ubah satu angka, gagal. Privat, tapi bisa dibuktikan."*

**Tips demo:** proving butuh ~3–8 detik. Kalau lama, sambil menunggu jelaskan apa yang
sedang terjadi ("browser sedang membuat bukti ZK-nya"). Kalau internet buruk, putar video
di slide 10 deck.

---

## 8. Kedalaman integrasi Stellar (kalau ditanya "seberapa dalam pakai Stellar")

| Primitif | Peran |
|---|---|
| Fungsi host BN254 (P25/26) | **Menyangga** — dua bukti Groth16 diverifikasi on-chain (paling langka) |
| Soroban | **Menyangga** — siklus penuh: RFQ, escrow, settle, refund, upgradeable |
| Poseidon on-chain | **Menyangga** — ditulis di atas operasi BN254, identik dengan circomlib |
| USDC Circle (SAC) | **Menyangga** — aset escrow & penyelesaian sungguhan |
| DvP dua aset (lot XLM) | **Menyangga** — swap sejati, bukan pembayaran satu arah |
| Directed Direct-OTC | **Menyangga** — penawar tak diundang ditolak kontrak |
| Oracle Reflector (SEP-40) | Dibaca saat `settle` sebagai pengaman harga |
| Freighter + MCP server | Tanda tangan asli; agen AI bisa membaca meja (read-only) |

Kalimat ringkas: *"Primitif Stellar-nya menyangga produk, bukan sekadar disebut."*

---

## 9. Batasan jujur (WAJIB SIAP — juri pasti menyentuh ini)

Jujur soal batasan itu **nilai plus** di hackathon ini (mereka bilang eksplisit lebih suka
"honest work-in-progress" daripada "polished mystery"). Sampaikan dengan percaya diri:

1. **Penyelesai melihat pembukaan tawaran.** Untuk menghitung hasil, pihak penyelesai
   memang harus melihat angka tawaran — ini sifat normal juru lelang. Segel menyembunyikan
   yang kalah dari **publik dan rantai**, bukan dari penyelesai. Menyembunyikan dari
   penyelesai juga butuh MPC (pekerjaan lanjutan).
2. **Pengaman oracle = pengaman salah-ketik**, bukan kendali anti-manipulasi. Buktinyalah
   pengikat harga sesungguhnya, bukan oracle.
3. **Identitas demo bukan KYC asli.** Demo tanpa dompet memainkan maker + beberapa penawar
   dengan satu kunci lewat identitas ZK berbeda; daftar izin = 16 kunci uji.
4. **Trusted setup** masih lokal (Powers-of-Tau); produksi butuh upacara multi-pihak.

Kalimat kunci: *"Tidak ada yang menyangga produk yang dipalsukan — USDC-nya asli, verifier
asli, oracle asli, bukti dibuat di browser sungguhan."*

---

## 10. Antisipasi pertanyaan juri + jawaban singkat

**Q: Kalau penyelesai lihat semua tawaran, apa gunanya ZK?**
A: ZK menyembunyikan yang kalah dari **publik, rantai, dan pesaing** — itu yang bocor di
dunia nyata dan bikin front-running. Menyembunyikan dari penyelesai adalah masalah berbeda
(MPC), dan kami sampaikan itu terus terang.

**Q: Apa bedanya dengan Confidential Tokens Stellar?**
A: Itu primitif **pembayaran** (menyembunyikan saldo/jumlah antar pihak yang dikenal).
Segel adalah **penemuan harga** rahasia — lelang di mana tawaran kalah terbukti valid tapi
tak pernah terungkap. Saling melengkapi, bukan bersaing.

**Q: Apakah buktinya benar-benar diverifikasi on-chain?**
A: Ya — dua kontrak verifier ter-deploy di testnet memakai fungsi host BN254 Stellar.
Bisa dibuktikan live: `npm run test:tamper-onchain` — bukti asli lolos, bukti diutak-atik
ditolak on-chain.

**Q: Kenapa Vickrey (harga kedua)?**
A: Mendorong orang menawar jujur sesuai nilai sebenarnya, dan membuat lelang efisien.
Bonusnya: nilai asli pemenang pun tak muncul di rantai.

**Q: Maker bisa settle lebih awal dan memotong penawar yang datang belakangan?**
A: Secara default bisa — sengaja, supaya demo bisa settle instan. Tapi kontrak sudah punya
saklar admin `set_sealed_window(true)`: kalau aktif, `settle` ditolak on-chain (`#4
NotExpired`) sampai deadline lewat. Jadi jaminan "lelang jalan sampai habis waktu" sudah
ada, tinggal dinyalakan untuk produksi.

**Q: Apakah ini jalan di mainnet?**
A: Sekarang di testnet, semua reproducible. Untuk mainnet perlu trusted-setup multi-pihak
dan integrasi KYC nyata — kami sudah petakan.

**Q: Siapa penggunanya?**
A: Fund kripto, market maker, treasury desk, broker OTC — siapa pun yang berdagang dalam
ukuran besar dan tak mau niatnya bocor ke pasar.

---

## 11. One-liner penutup (pilih satu, ucapkan mantap)

- "Tawaran tersegel. Penyelesaian terbukti. Yang kalah tak pernah terlihat."
- "Harga yang adil **dibuktikan**, bukan **dipercaya**."
- "Zero-knowledge nyata, uang nyata, pengiriman nyata — di Stellar."
- (EN) "Bids sealed, settlement proven, losers never seen — real ZK, real USDC, on Stellar."

---

## 12. Glosarium singkat

- **RFQ** — Request For Quote; permintaan penawaran yang diposting maker.
- **Maker** — pihak yang membuka lelang. **Taker/bidder** — pihak yang menawar.
- **Escrow** — dana/aset yang dititipkan di kontrak sampai penyelesaian.
- **Commitment** — sidik jari kriptografi tawaran (Poseidon).
- **Nullifier** — penanda anti-tawar-ganda.
- **Vickrey** — lelang di mana pemenang bayar harga tertinggi **kedua**.
- **DvP** — Delivery-vs-Payment; tukar aset & bayar secara atomik.
- **Soroban** — platform smart contract Stellar.
- **Groth16 / BN254 / Poseidon** — sistem bukti / kurva / fungsi hash yang dipakai.
- **Oracle (Reflector)** — sumber harga pasar on-chain.
- **MCP** — antarmuka agar agen AI bisa membaca data meja (read-only).

---

## 13. Link penting (buka tab-tab ini sebelum mulai)

- Live desk: https://segel.vercel.app/app
- Deck: https://segel.vercel.app/deck
- Repo + README (ada alamat kontrak): https://github.com/PugarHuda/segel
- Explorer kontrak utama:
  https://stellar.expert/explorer/testnet/contract/CBAJVX6XPPGCMIQRWABO6ZOGQH7PJXTF4XB3MTAC35M4SBRLSIYXBBZM

Semoga lancar presentasinya. 🚀
