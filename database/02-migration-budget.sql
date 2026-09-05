-- ============================================================
-- Migration: Tabel Budget per Kategori
-- Jalankan di Supabase SQL Editor
-- ============================================================

CREATE TABLE budget (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  kategori TEXT NOT NULL,
  limit_bulanan INTEGER NOT NULL,
  bulan INTEGER NOT NULL,        -- 1-12
  tahun INTEGER NOT NULL,        -- contoh: 2026
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, kategori, bulan, tahun)
);

-- Aktifkan keamanan per-user
ALTER TABLE budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lihat budget sendiri"
  ON budget FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Tambah budget"
  ON budget FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Edit budget sendiri"
  ON budget FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Hapus budget sendiri"
  ON budget FOR DELETE USING (auth.uid() = user_id);
