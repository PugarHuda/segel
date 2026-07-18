# Segel — Naskah Pitch (Bahasa Indonesia)

> Naskah untuk presentasi/deck (`/deck`) dan sebagai sulih suara. Nada: percaya diri,
> jujur, teknis tapi jelas. Kalimat `>` dibaca lantang dengan tempo natural. Sumber
> sulih suara video demo Bahasa Indonesia (`frontend/segel-demo-id.mp4`) ada di
> `scripts/record-demo-narrated.mjs` (jalankan `npm run demo:id`).

---

## Pitch singkat (30 detik)

> "Meja OTC itu bocor. Begitu penawaran transaksi besar terlihat, pasar langsung
> mendahului Anda. Segel adalah meja OTC lelang tertutup di Stellar: penawaran
> **disegel**, harga yang adil **dibuktikan secara zero-knowledge**, dan penawaran
> yang kalah **tak pernah terungkap** — sementara seluruh penyelesaian tetap bisa
> diverifikasi di Stellar."

---

## Pitch deck (per slide)

**Slide 1 — Judul**
> "Ini Segel: meja OTC lelang tertutup di Stellar. Penawaran disegel, penyelesaian
> dibuktikan, nilai yang kalah tak pernah terungkap. Lihat buku besarnya — komitmennya
> publik dan mengikat, tapi nilai yang kalah memang tak pernah ditulis ke rantai."

**Slide 2 — Masalah**
> "Kenapa ini penting? Meja OTC bocor. Begitu penawaran transaksi blok terlihat, pasar
> mendahului Anda. Jadi hari ini Anda hanya punya dua pilihan: mengungkap semua
> penawaran di order book publik, atau memercayai broker untuk memilih pemenang dan
> harga secara jujur. Tak ada pilihan ketiga."

**Slide 3 — Solusi**
> "Segel adalah pilihan ketiga itu. Penawaran disegel di balik komitmen Poseidon. Harga
> kliring Vickrey — harga tertinggi kedua yang adil — dibuktikan secara zero-knowledge.
> Nilai yang kalah tetap tersembunyi selamanya, dan penyelesaiannya memakai USDC Circle
> sungguhan sebagai swap dua aset delivery-versus-payment."

**Slide 4 — ZK yang menyangga (headline)**
> "Zero-knowledge di sini bukan tempelan — ia menyangga produk. Dua sirkuit Circom
> Groth16, diverifikasi on-chain oleh kontrak Soroban yang ter-deploy menggunakan fungsi
> host BN254 milik Stellar. bidValidity membuktikan penawaran ada dalam rentang, dananya
> cukup, ada di daftar izin, dan bukan duplikat — tanpa mengungkap nilainya. auctionResult
> membuktikan pemenang dan harga Vickrey. Hilangkan salah satunya, produk ini tak ada."

**Slide 5 — Kesahihan dibuktikan langsung**
> "Dan kami tak minta Anda percaya begitu saja. Satu perintah: bukti asli lolos di
> verifier yang ter-deploy. Ubah satu input saja, dan bukti yang sama ditolak on-chain.
> Pernyataan palsu tak punya bukti yang valid."

**Slide 6 — Cara kerja**
> "Alurnya empat langkah on-chain. Maker memposting RFQ. Penawar menyegel penawaran,
> dibuktikan di dalam browser mereka sendiri. Satu bukti penyelesaian hanya mengungkap
> pemenang dan harga kliring. Lalu pembayaran, pengiriman, dan pengembalian dana terjadi
> secara atomik."

**Slide 7 — Live di Stellar**
> "Sudah ter-deploy dan bisa diverifikasi di Stellar testnet sekarang — meja plus kedua
> kontrak verifier, meng-escrow USDC testnet Circle yang sungguhan, dengan pembacaan
> oracle Reflector saat penyelesaian."

**Slide 8 — Kedalaman integrasi**
> "Primitif Stellar-nya menyangga, bukan sekadar disebut: fungsi host BN254, kustodi
> escrow Soroban, Poseidon on-chain yang identik dengan sirkuit, USDC sungguhan,
> delivery-versus-payment, dan Direct-OTC terarah yang dipaksakan oleh kontrak itu sendiri."

**Slide 9 — Batasan yang jujur**
> "Dan batasannya kami sampaikan terus terang, bukan disembunyikan. Penyelesai memang
> melihat pembukaan penawaran untuk menghitung hasil, seperti juru lelang mana pun.
> Penjaga oracle adalah pengaman salah-ketik, bukan kendali anti-manipulasi. Daftar izin
> demo adalah kunci uji, bukan KYC asli. Tapi tak ada yang menyangga yang dipalsukan."

**Slide 10 — Penutup**
> "Penawaran tersegel. Penyelesaian terbukti. Yang kalah tak pernah terlihat. Sekarang
> mari lihat mejanya, berjalan langsung di Stellar."

---

## Catatan kejujuran (agar sulih suara tetap benar)
- Katakan **"dibuktikan, bukan dipercaya"** — bukan "tanpa kepercayaan": penyelesai tetap
  melihat pembukaan penawaran (sifat normal juru lelang), yang kami ungkap terbuka.
- Penjaga oracle adalah **circuit-breaker salah-ketik**, *bukan* kendali anti-manipulasi —
  bukti ZK-lah pengikat harga sesungguhnya. Jangan mengklaim lebih.
- MCP `read_settlement` **membaca** hasil terverifikasi; ia tidak menjalankan ulang bukti.
