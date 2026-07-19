# Segel · Naskah Bicara

Naskah yang diucapkan saat presentasi, nyambung dengan deck di
https://segel.vercel.app/deck (11 slide). Yang di dalam tanda kutip dibaca; yang
`[dalam kurung]` cuma aba-aba, nggak diucapkan. Total sekitar 5 sampai 6 menit.
Tiap slide ada versi Indonesia (utama) dan English (kalau presentasinya in English,
pilih salah satu, konsisten).

Tempo pelan aja, jangan buru-buru. Kalau grogi, yang wajib kesampaian cuma tiga hal:
bid-nya di-seal, harga-nya di-prove bukan dipercaya, dan yang kalah nggak pernah
kelihatan. Sisanya bonus.

Istilah teknis (sealed-bid, commitment, zero-knowledge, settlement, escrow, on-chain,
dst.) dibiarkan English aja, jangan dipaksa diterjemahin, biar terdengar natural.

---

## SLIDE 1 · Judul  (0:00-0:30)
[Deck di slide 1.]

> "Halo semua. Saya mau kenalin Segel, sebuah sealed-bid OTC desk yang jalan di Stellar.
> Coba lihat tabel di layar ini. Commitment-nya publik dan mengikat, tapi angka bid yang
> kalah itu nggak pernah ditulis ke chain sama sekali. Itu inti dari proyek ini, dan
> sebentar saya tunjukkan cara kerjanya."

> *(EN)* "Hi everyone. This is Segel, a sealed-bid OTC desk on Stellar. Look at this
> ledger. The commitments are public and binding, but the losing bid amounts were never
> written to the chain. That's the core idea, and I'll show you how it works."

---

## SLIDE 2 · Masalah  (0:30-1:05)
[Klik ke slide 2.]

> "Kenapa ini penting? Karena OTC desk itu bocor. Misalnya ada fund yang mau beli token
> senilai jutaan dolar. Begitu bid-nya kelihatan, pasar langsung front-run mereka, harga
> gerak melawan mereka sebelum transaksinya kelar. Jadi sekarang pilihannya cuma dua.
> Pertama, pasang bid di order book publik, semua orang lihat, langsung di-front-run.
> Kedua, lewat broker di ruang chat, privat, tapi kita harus percaya broker-nya milih
> pemenang dan harga dengan jujur. Belum ada opsi ketiga."

> *(EN)* "Why does this matter? OTC desks leak. Say a fund wants to buy millions in tokens.
> The moment the bids are visible, the market front-runs them, the price moves against them
> before the trade fills. So today you get two options. One, post on a public book, everyone
> sees it, you get front-run. Two, go through a broker in a chat room, private, but you have
> to trust them to pick the winner and price honestly. There's no third option."

---

## SLIDE 3 · Solusi  (1:05-1:40)
[Klik ke slide 3.]

> "Segel itu opsi ketiganya. Bid-nya di-seal pakai Poseidon commitment, jadi nggak ada yang
> bocor waktu orang nawar. Pas lelangnya tutup, satu zero-knowledge proof yang nunjukkin
> siapa pemenangnya dan berapa harga yang adil, yaitu harga Vickrey, harga tertinggi kedua.
> Bid yang kalah tetap kesimpan, nggak kebuka. Settlement-nya pakai USDC Circle beneran,
> sebagai swap dua aset."

> *(EN)* "Segel is that third option. Bids are sealed with a Poseidon commitment, so nothing
> leaks while people bid. When the auction closes, one zero-knowledge proof shows the winner
> and the fair Vickrey second price. The losing bids stay hidden. It settles in real Circle
> USDC as a two-asset swap."

---

## SLIDE 4 · ZK yang menyangga  (1:40-2:20)
[Klik ke slide 4. Ini slide paling teknis, pelan aja.]

> "Zero-knowledge di sini bukan cuma tempelan, tapi yang bikin produknya jalan. Ada dua
> circuit. Yang pertama mbuktiin sebuah bid itu valid, ada dalam range, dananya cukup,
> penawarnya terdaftar, dan belum pernah nawar, tanpa buka angkanya. Yang kedua mbuktiin
> pemenang dan harga Vickrey-nya bener. Dan yang penting, dua-duanya diverifikasi langsung
> di dalam smart contract Stellar, pakai host function BN254. Kalau ZK-nya diilangin,
> produknya nggak bisa ada."

> *(EN)* "The zero-knowledge here isn't decoration, it's what makes the product work. Two
> circuits. The first proves a bid is valid: in range, funded, allow-listed, and not a
> repeat, without revealing the amount. The second proves the winner and the Vickrey price.
> And both are verified inside a Stellar smart contract, using the BN254 host functions.
> Take the ZK out and there's no product."

---

## SLIDE 5 · Dibuktikan langsung  (2:20-2:50)
[Klik ke slide 5.]

> "Dan nggak usah percaya omongan saya. Satu command aja, proof asli lolos di verifier yang
> udah ke-deploy. Ubah satu angka di dalamnya, proof yang sama langsung ditolak on-chain.
> Statement yang salah nggak punya proof yang valid."

> *(EN)* "And you don't have to take my word for it. One command, a real proof passes on the
> deployed verifier. Change one number in it, and the same proof gets rejected on-chain. A
> false statement has no valid proof."

---

## SLIDE 6 · Cara kerja  (2:50-3:15)
[Klik ke slide 6.]

> "Alurnya empat langkah, semuanya on-chain. Maker posting request. Penawar nge-seal bid,
> di-prove di browser mereka sendiri. Satu settlement proof yang cuma nunjukkin pemenang dan
> harga. Habis itu pembayaran, pengiriman, sama refund kejadian sekaligus, atomik."

> *(EN)* "Four on-chain steps. A maker posts a request. Bidders seal a bid, proven in their
> own browser. One settlement proof reveals just the winner and the price. Then payment,
> delivery, and refunds all happen at once, atomically."

---

## SLIDE 7 · Live di Stellar  (3:15-3:40)
[Klik ke slide 7.]

> "Dan ini bukan konsep, udah ke-deploy dan jalan di Stellar testnet sekarang. Desk-nya,
> plus dua verifier contract, nge-escrow USDC testnet Circle yang beneran, sama baca oracle
> Reflector pas settlement. Semua alamat contract-nya ada di layar, bisa dicek di explorer."

> *(EN)* "And this isn't a concept, it's deployed and running on Stellar testnet now. The
> desk plus both verifier contracts, escrowing real Circle testnet USDC, reading the
> Reflector oracle at settlement. All the contract addresses are on screen, check them on
> the explorer."

---

## SLIDE 8 · Integrasi  (3:40-4:00)
[Klik ke slide 8. Boleh agak cepat, ini daftar.]

> "Dan primitif Stellar-nya kepakai beneran, bukan cuma disebut. Host function BN254,
> escrow custody di Soroban, Poseidon on-chain yang identik sama circuit, USDC beneran,
> swap dua aset, sama Direct-OTC yang dipaksain sama contract-nya sendiri."

> *(EN)* "And the Stellar primitives actually carry the product, they're not just mentioned.
> BN254 host functions, Soroban escrow custody, on-chain Poseidon identical to the circuit,
> real USDC, two-asset swaps, and directed OTC enforced by the contract itself."

---

## SLIDE 9 · Batasan jujur  (4:00-4:30)
[Klik ke slide 9. Nada biasa aja, tenang. Ini malah nambah kredibilitas.]

> "Dan batasannya kami sebut terus terang. Pihak settler emang lihat bid buat ngitung
> hasilnya, sama kayak auctioneer pada umumnya. Segel nyembunyiin yang kalah dari publik
> dan chain, bukan dari settler. Oracle guard-nya itu buat jaga-jaga salah ketik, bukan
> anti-manipulasi. Allow-list di demo pakai test key, bukan KYC beneran. Tapi nggak ada
> bagian penting yang di-mock, semuanya real."

> *(EN)* "And we're upfront about the limits. The settler does see the bids to compute the
> result, like any auctioneer. Segel hides the losers from the public and the chain, not
> from the settler. The oracle guard is a fat-finger check, not anti-manipulation. The demo
> allow-list uses test keys, not real KYC. But nothing important is mocked, it's all real."

---

## SLIDE 10 · Demo  (4:30-5:30)
[Klik ke slide 10, ada video demo di sini. Putar videonya, atau buka
https://segel.vercel.app/app di tab lain buat demo langsung. Kalau demo langsung, omongin
sambil klik:]

> "Sekarang lihat langsung. [connect demo key] Saya connect demo key. [buka Create] Siapa
> aja bisa posting lelang, mau terbuka buat semua, atau diarahin ke satu counterparty aja.
> Saya posting yang ini. [klik Post] Ini transaksi on-chain beneran.
> [buka satu RFQ, klik Bid, geser slider] Pas saya nawar, browser saya yang bikin
> zero-knowledge proof-nya, angka bid-nya nggak dikirim ke mana-mana. [klik seal, tunggu]
> Yang kecatat di chain cuma commitment-nya.
> [buka Portfolio, Verify a disclosure] Nah ini yang menarik. Pemenang nawar 4.90 tapi
> bayarnya harga Vickrey 4.20, jadi angka 4.90 nggak ada di chain. Tapi dia tetap bisa
> mbuktiinnya ke auditor. Ubah satu angka, gagal. Privat, tapi tetap bisa dibuktikan."

[Kalau internet bermasalah, cukup puter video di slide 10, naskah demo di atas dipakai
sebagai narasi.]

---

## SLIDE 11 · Penutup  (5:30-6:00)
[Klik ke slide 11.]

> "Jadi singkatnya, bid-nya di-seal, settlement-nya kebukti, yang kalah nggak pernah
> kelihatan. Zero-knowledge beneran, uang beneran, pengiriman beneran, di Stellar. Semuanya
> live, bisa dicoba sendiri di segel.vercel.app. Makasih."

> *(EN)* "So in short, bids sealed, settlement proven, losers never seen. Real
> zero-knowledge, real money, real delivery, on Stellar. It's all live at segel.vercel.app.
> Thanks."

[Selesai, lanjut ke Q&A. Buat jawaban, buka `docs/PRESENTER_BRIEF_ID.md` bagian 10.]

---

## Kalau waktunya cuma 3 menit
Skip slide 5 sama 8. Urutannya slide 1, 2, 3, 4, 10, terus 11. Enam poin inti plus demo,
udah cukup.

## Checklist sebelum maju
- [ ] Buka tab: `/deck`, `/app`, sama explorer contract utama.
- [ ] Udah connect demo key sekali, biar pas demo nggak nunggu lama.
- [ ] Cek internet. Kalau ragu, siapin video slide 10 buat cadangan.
- [ ] Baca ulang slide 9 (batasan) sama brief bagian 10 (Q&A), itu bagian yang rawan ditanya.
