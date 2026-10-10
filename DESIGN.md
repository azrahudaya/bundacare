# Arah desain Bundacare

Status: diterapkan pada landing dan formulir lokal di `site/`, belum dipasang di bundacare.site. Acuan visual: [Peanut](https://www.peanut-app.io/), terutama keberanian warna, judul besar, dan komposisi hero. Jangan menyalin logo, foto, profil anggota, rating, atau tampilan persisnya.

## Yang ingin terasa

Hangat, berani, gampang dipakai. Ibu langsung tahu bahwa pendaftaran dilakukan di website, lalu satu pesan WhatsApp dipakai untuk verifikasi nomor. Bundacare bukan jejaring sosial, toko, atau layanan konsultasi medis.

Pembacaan desain: landing layanan pengingat ibu untuk pengguna ponsel, dengan bahasa visual editorial yang cerah. ENERGY 3 / RHYTHM 2 / MOTION 1. Focal point pertama: ajakan daftar, bukan dekorasi.

## Sistem visual

| Peran | Warna | Alasan |
| --- | --- | --- |
| Bidang hero dan CTA utama | `#C7354D` merah beri | Hangat dan terlihat jelas; bukan warna Peanut yang disalin persis. |
| Bidang pendamping | `#FFE7D7` persik muda | Menahan energi hero agar isi dan formulir tetap nyaman dibaca. |
| Teks dan garis kuat | `#24202D` arang | Kontras dan lebih ramah daripada hitam pekat. |
| Aksen terbatas | `#FFD65A` kuning | Penanda satu momen penting, misalnya tahap verifikasi; bukan taburan di seluruh halaman. |
| Bidang baca | `#FFFFFF` putih | Formulir dan teks panjang butuh latar paling tenang. |

Rasio kontras yang sudah dihitung: putih pada merah beri 5,19:1; arang pada persik 13,39:1; arang pada putih 15,91:1; arang pada kuning 11,38:1. Pasangan warna lain wajib dihitung sebelum dipakai. Pesan galat memakai teks, bukan warna saja.

Judul: Bricolage Grotesque, bobot tebal, untuk memberi karakter yang ekspresif. Font ini belum ada di repo: periksa lisensi, unduh dan host sendiri saat implementasi. Jika aset tidak bisa dipakai, pilih pengganti berlisensi yang sekarakter, jangan diam-diam memakai font sistem. Isi dan formulir: Plus Jakarta Sans yang sudah ada di `site/fonts/`, karena terbaca jelas pada ukuran kecil. Hindari huruf kapital renggang untuk label.

Komposisi: hero merah beri dengan judul besar di kiri dan demonstrasi alur di kanan. Demonstrasi memperlihatkan formulir website, langkah verifikasi, dan contoh pengingat WA; tandai sebagai ilustrasi, bukan data pasien atau tangkapan layar asli. Lapisan kertas/kartu boleh sedikit bertumpuk untuk menegaskan perpindahan dari web ke WA, bukan hiasan profil ala Peanut. Bayangan hanya pada elemen yang benar-benar berada di depan; sudut membulat secukupnya, tidak semua serba pil.

Foto manusia tidak wajib. Jika dipakai, minta persetujuan pemilik atau gunakan foto berlisensi dengan izin yang jelas. Jangan buat wajah pasien, testimoni, angka pengguna, atau logo mitra rekaan.

## Susunan halaman

1. Hero: apa yang diingatkan Bundacare, tombol `Daftar pengingat`, dan contoh alur web ke WA yang jujur.
2. Cara kerja singkat: isi data di website, kirim satu pesan verifikasi dari nomor sendiri, lalu terima pengingat. Jelaskan bahwa pendaftaran belum aktif sebelum verifikasi, dan selama pilot mungkin menunggu persetujuan pengelola.
3. Formulir: nomor WA, data minimum yang diperlukan, jam pengingat, dan persetujuan yang tidak dicentang otomatis. Formulir berada pada latar tenang, bukan teks putih di atas foto.
4. Setelah daftar: halaman status menampilkan tindakan berikutnya, masa berlaku verifikasi, gagal, kedaluwarsa, dan cara mencoba lagi.
5. Bacaan yang memang ada dan batas layanan: pengingat bukan layanan darurat atau pengganti tenaga kesehatan. Tampilkan kebijakan privasi dan cara meminta penghapusan data sebelum membuka pendaftaran umum.

Jangan menambah deretan logo, testimoni, FAQ kosong, atau tiga kartu fitur hanya untuk memenuhi pola landing page. Tautan menu hanya menuju bagian yang benar-benar tersedia. Tombol daftar baru muncul sebagai aksi aktif ketika formulir dan API sudah bekerja.

## Bahasa dan interaksi

Kalimat pendek, bahasa Indonesia wajar, tanpa jargon promosi atau janji kesehatan. Tombol menyebut tindakan nyata: `Daftar pengingat`, `Kirim pesan verifikasi`, `Ubah nomor`, `Coba lagi`. Contoh judul, bukan klaim hasil: `Daftar di sini. Pengingatnya lewat WhatsApp.` Hindari emoji dekoratif, animasi mengambang, gradasi generik, dan tombol yang tampak bisa diklik tetapi tidak berfungsi.

Gerak hanya untuk umpan balik klik, buka menu, dan pergantian status. Konten tetap terlihat bila animasi dimatikan. Hormati `prefers-reduced-motion`.

## Responsif dan aksesibilitas

Rancang dari ponsel. Hero menjadi satu kolom dengan judul, aksi, lalu contoh alur; foto atau kartu tidak boleh mendahului tindakan utama. Saat ruang cukup, hero menjadi dua kolom. Di lebar menengah, elemen tidak dipaksa ke grid desktop atau ditumpuk terlalu renggang. Breakpoint ditentukan saat isi mulai sempit, bukan mengikuti merek perangkat.

Uji pada lebar 360, 390, 768, 1024, dan 1440 piksel, lalu geser lebar di antaranya. Tidak boleh ada scroll horizontal, teks terpotong, atau input tertutup keyboard ponsel. Semua kontrol punya area sentuh minimal 44 x 44 piksel dan jarak antarkontrol. Label formulir tetap terlihat, fokus keyboard jelas, urutan Tab masuk akal, galat dijelaskan dekat bidangnya, serta halaman tetap terbaca pada zoom 200%. Status mengirim, berhasil, gagal, dan verifikasi kedaluwarsa harus punya teks dan tindakan berikutnya.

## Batas keputusan

`site/` yang sekarang belum terlacak Git dan merupakan pekerjaan yang harus dilindungi. Baca diff dan cadangkan sebelum mengganti visual. Rancangan ini menetapkan arah, bukan bukti UI sudah dibuat. Setiap komponen baru harus diuji di browser, termasuk desktop, ponsel, keyboard, dan jalur gagal.
