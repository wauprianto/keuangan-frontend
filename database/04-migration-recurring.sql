-- ============================================================
-- Migration 04: Tabel Recurring Transaction
-- Jalankan SETELAH migration 01-03 di Supabase SQL Editor
-- ============================================================

CREATE TABLE recurring (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tipe TEXT NOT NULL CHECK (tipe IN ('pemasukan', 'pengeluaran')),
  kategori TEXT NOT NULL,
  jumlah INTEGER NOT NULL,
  catatan TEXT,
  dompet_id UUID REFERENCES dompet(id) ON DELETE SET NULL,
  frekuensi TEXT NOT NULL CHECK (frekuensi IN ('harian', 'mingguan', 'bulanan')),
  tanggal_mulai DATE NOT NULL,
  tanggal_terakhir_dibuat DATE,  -- kapan terakhir kali transaksi otomatis dibuat dari jadwal ini
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recurring ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lihat recurring sendiri"
  ON recurring FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Tambah recurring"
  ON recurring FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Edit recurring sendiri"
  ON recurring FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Hapus recurring sendiri"
  ON recurring FOR DELETE USING (auth.uid() = user_id);
