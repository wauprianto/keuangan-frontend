CREATE TABLE savings_goal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  ikon TEXT NOT NULL DEFAULT '🎯',
  warna TEXT NOT NULL DEFAULT '#B8860B',
  target_nominal INTEGER NOT NULL,
  terkumpul INTEGER NOT NULL DEFAULT 0,
  dompet_id UUID REFERENCES dompet(id) ON DELETE SET NULL,
  target_tanggal DATE,
  tercapai BOOLEAN NOT NULL DEFAULT false,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Riwayat kontribusi — supaya user bisa lihat histori setoran ke tiap goal,
-- bukan cuma angka total. Terpisah dari tabel transaksi utama karena ini
-- bukan pemasukan/pengeluaran, melainkan alokasi internal.
CREATE TABLE savings_contribution (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id UUID REFERENCES savings_goal(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  jumlah INTEGER NOT NULL,
  catatan TEXT,
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE savings_goal ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_contribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lihat goal sendiri"
  ON savings_goal FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Tambah goal"
  ON savings_goal FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Edit goal sendiri"
  ON savings_goal FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Hapus goal sendiri"
  ON savings_goal FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Lihat kontribusi sendiri"
  ON savings_contribution FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Tambah kontribusi"
  ON savings_contribution FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Hapus kontribusi sendiri"
  ON savings_contribution FOR DELETE USING (auth.uid() = user_id);
