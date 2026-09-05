CREATE TABLE dompet (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  ikon TEXT NOT NULL DEFAULT '💰',
  warna TEXT NOT NULL DEFAULT '#3b82f6',
  saldo_awal INTEGER NOT NULL DEFAULT 0,
  urutan INTEGER NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tambah kolom dompet_id ke tabel transaksi yang sudah ada
ALTER TABLE transaksi
  ADD COLUMN IF NOT EXISTS dompet_id UUID REFERENCES dompet(id) ON DELETE SET NULL;

-- RLS untuk dompet
ALTER TABLE dompet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lihat dompet sendiri"
  ON dompet FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Buat dompet"
  ON dompet FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Edit dompet sendiri"
  ON dompet FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Hapus dompet sendiri"
  ON dompet FOR DELETE USING (auth.uid() = user_id);

-- View: saldo per dompet (otomatis dihitung dari transaksi)
CREATE OR REPLACE VIEW saldo_dompet AS
SELECT
  d.id,
  d.user_id,
  d.nama,
  d.ikon,
  d.warna,
  d.urutan,
  d.saldo_awal,
  d.saldo_awal
    + COALESCE(SUM(CASE WHEN t.tipe = 'pemasukan' THEN t.jumlah ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN t.tipe = 'pengeluaran' THEN t.jumlah ELSE 0 END), 0)
    AS saldo_saat_ini,
  COUNT(t.id) AS jumlah_transaksi
FROM dompet d
LEFT JOIN transaksi t ON t.dompet_id = d.id
WHERE d.aktif = true
GROUP BY d.id, d.user_id, d.nama, d.ikon, d.warna, d.urutan, d.saldo_awal;
