-- ============================================================
-- Migration 01: Tabel Dasar (Transaksi)
-- Jalankan PALING PERTAMA di Supabase SQL Editor
-- ============================================================

CREATE TABLE transaksi (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tipe TEXT NOT NULL CHECK (tipe IN ('pemasukan', 'pengeluaran')),
  kategori TEXT NOT NULL,
  jumlah INTEGER NOT NULL,
  catatan TEXT,
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transaksi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lihat data sendiri"
  ON transaksi FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Tambah transaksi"
  ON transaksi FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Edit transaksi sendiri"
  ON transaksi FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Hapus transaksi sendiri"
  ON transaksi FOR DELETE USING (auth.uid() = user_id);
