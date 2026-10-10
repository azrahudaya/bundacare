// Konfigurasi landing page Bundacare.
//
// Landing di-host statis (GitHub Pages) dan memanggil API bot di domain terpisah.
// Ganti nilai di bawah ke alamat backend sungguhan setelah backend terpasang, mis.
//   window.BUNDACARE_API_BASE = "https://api.bundacare.site";
// Selama masih di localhost, biarkan kosong supaya memakai origin yang sama.
window.BUNDACARE_API_BASE = window.BUNDACARE_API_BASE || "";
